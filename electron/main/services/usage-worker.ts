import { join } from "node:path";
import { existsSync, watch } from "node:fs";
import { jsonlDrivers } from "../../../services/usage/providers/index.js";
import { buildRangeResult } from "../../../services/usage/range.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import { saveState } from "../../../services/usage/ledger-store.js";
import {
	type SweepState,
	createSweepState,
	loadPersistedState,
	recoverCodexLimits,
	sweepFiles,
} from "../../../services/usage/sweep.js";
import { createSweepRunner } from "../../../services/usage/sweep-runner.js";
import type {
	MainToWorker,
	UsageWorkerConfig,
	WorkerToMain,
} from "../../../services/usage/worker-protocol.js";

// utilityProcess child <-> parent channel. Typed via a cast so we don't depend
// on Electron's ambient process augmentation in the node typecheck project.
const parentPort = (
	process as unknown as {
		parentPort: {
			on(event: "message", cb: (e: { data: MainToWorker }) => void): void;
			postMessage(message: WorkerToMain): void;
		};
	}
).parentPort;

// --- module state ---
let cfg: UsageWorkerConfig | null = null;
let state: SweepState = createSweepState();
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let backfilling = false;
let rescanQueued = false;

// Single combined state file (ledger + offset cache), persisted atomically.
const LEDGER_FILE = "usage-ledger.json";
// Active horizon: files untouched longer than this are "sealed" (contribution
// dropped to bound the cache). ~35 days matches the daily-series window.
const ACTIVE_HORIZON_MS = 35 * 86_400_000;

const ledgerPath = (): string => join(cfg!.userDataDir, LEDGER_FILE);

function persist(): void {
	if (!cfg) return;
	// Seal stale entries: drop their contribution detail (totals stay in the ledger).
	const now = Date.now();
	for (const entry of state.offsets.values()) {
		if (entry.contribution && now - entry.mtime > ACTIVE_HORIZON_MS) {
			entry.contribution = undefined;
		}
	}
	// Write ledger + offsets together as one atomic state file — a crash can never
	// leave a torn pair that would double-count on the next sweep (spec §4.3).
	saveState(ledgerPath(), state.ledger, state.offsets, state.codexLimits);
}

// Failure recovery (reload-on-failure, per-file quarantine, and the honest
// success signal the `ready` message depends on) lives in the electron-free
// runner so it is directly unit-tested; this shell only supplies the effects.
const runner = createSweepRunner({
	getState: () => state,
	setState: (s) => {
		state = s;
	},
	runSweep: (s, skipFile, onFileDone) =>
		// All scan + idempotency + sealed-truncation-rebuild logic lives in
		// sweepFiles (electron-free + unit-tested in tests/unit/usage/sweep.test.ts).
		sweepFiles(
			s,
			jsonlDrivers,
			cfg!.home,
			cfg!.launchMs,
			cfg!.backfillBatchSize,
			scheduleEmit,
			skipFile,
			onFileDone,
		).then(() => undefined),
	persist: () => persist(),
	reload: () => loadPersistedState(ledgerPath()),
	onQuarantine: (file, n) =>
		console.error(
			`[usage] quarantining ${file} after ${n} consecutive failures; its usage data will be missing until the next launch`,
		),
	onError: (err) =>
		console.error("[usage] sweep failed; reloading last persisted state", err),
});

async function sweep(): Promise<boolean> {
	if (!cfg) return false;
	if (backfilling) {
		rescanQueued = true;
		return false;
	}
	backfilling = true;
	let ok: boolean;
	try {
		ok = await runner.run();
	} finally {
		// Always released: a throw used to strand this `true`, which silently
		// turned every later sweep into a no-op.
		backfilling = false;
	}
	if (rescanQueued) {
		rescanQueued = false;
		void sweep().catch((err: unknown) => {
			console.error("[usage] queued rescan failed", err);
		});
	}
	return ok;
}

function emitSnapshot(): void {
	if (!cfg) return;
	const msg: WorkerToMain = {
		kind: "snapshot",
		snapshot: buildSnapshot({
			ledger: state.ledger,
			session: state.session,
			known: cfg.known,
			activeWorktreeIds: cfg.activeWorktreeIds,
			nowMs: Date.now(),
			includeUntracked: cfg.includeUntracked,
			chipRange: cfg.chipRange,
			providersWithData: state.providersWithData,
			codexLimits: state.codexLimits,
		}),
	};
	parentPort.postMessage(msg);
}

// Throttle: coalesce many triggers into at most one emit per ~1.5s.
function scheduleEmit(): void {
	if (emitTimer) return;
	emitTimer = setTimeout(() => {
		emitTimer = null;
		emitSnapshot();
	}, 1500);
}

function watchDir(dir: string): void {
	if (!existsSync(dir)) return;
	try {
		watch(dir, { recursive: true }, () => {
			void sweep().catch((err: unknown) => {
				console.error("[usage] watch-triggered sweep failed", err);
			});
		});
	} catch {
		/* watch unsupported — rely on the 60s safety interval below */
	}
}

// E2E seam only: hold the worker unresponsive for N ms after `config`, so a
// test can observe the read-timeout error state a user sees while a
// replacement worker is still coming up — and then observe Retry recovering
// once it answers. Never set in production.
const SLOW_START_MS = Number(process.env.AI14ALL_E2E_USAGE_SLOW_START_MS ?? 0);
const slowStartUntil =
	Number.isFinite(SLOW_START_MS) && SLOW_START_MS > 0
		? Date.now() + SLOW_START_MS
		: 0;
const holdingStart = (): boolean =>
	slowStartUntil > 0 && Date.now() < slowStartUntil;

parentPort.on("message", (e: { data: MainToWorker }) => {
	const msg = e.data;
	// Drop reads while held: the host sees no `rangeResult` and settles the read
	// as `timeout`, which is exactly what a still-starting worker produces.
	if (msg.kind === "queryRange" && holdingStart()) return;
	if (msg.kind === "config") {
		cfg = msg.config;
		state = loadPersistedState(ledgerPath());
		// The Codex-limits gauge reflects the latest codex rate-limit, which the
		// incremental sweep won't re-read after a restart (it's behind the saved
		// offset). Recover it straight from the logs so the gauge shows on launch;
		// onLimits keeps it live as new codex turns arrive.
		const recovered = recoverCodexLimits(cfg.home);
		if (
			recovered &&
			(!state.codexLimits ||
				recovered.capturedAtMs > state.codexLimits.capturedAtMs)
		) {
			state.codexLimits = recovered;
		}
		const roots = jsonlDrivers.flatMap((d) => d.roots(cfg!.home));
		// Readiness (design §3.4): announced ONLY when the first sweep and its
		// persist both actually succeeded, which is what the host's re-fork
		// budget keys off. `sweep()` recovers from its own failures, so it
		// resolves either way — reporting ready on a recovered failure would let
		// a worker that can never persist re-arm the budget on every attempt and
		// re-fork without bound.
		void sweep()
			.then((ok) => {
				if (ok) parentPort.postMessage({ kind: "ready" });
				else
					console.error(
						"[usage] initial sweep did not complete cleanly; not reporting ready",
					);
			})
			.catch((err: unknown) => {
				console.error("[usage] initial sweep failed", err);
			});
		for (const root of roots) watchDir(root);
		setInterval(() => {
			void sweep().catch((err: unknown) => {
				console.error("[usage] periodic sweep failed", err);
			});
		}, 60_000);
	} else if (msg.kind === "setKnown" && cfg) {
		cfg.known = msg.known;
		scheduleEmit();
	} else if (msg.kind === "setActive" && cfg) {
		cfg.activeWorktreeIds = msg.activeWorktreeIds;
		scheduleEmit();
	} else if (msg.kind === "setChipRange" && cfg) {
		cfg.chipRange = msg.chipRange;
		scheduleEmit();
	} else if (msg.kind === "setIncludeUntracked" && cfg) {
		cfg.includeUntracked = msg.includeUntracked;
		scheduleEmit();
	} else if (msg.kind === "queryRange" && cfg) {
		parentPort.postMessage({
			kind: "rangeResult",
			requestId: msg.requestId,
			result: buildRangeResult(
				state.ledger,
				cfg.known,
				cfg.activeWorktreeIds,
				msg.query,
			),
		});
	}
});
