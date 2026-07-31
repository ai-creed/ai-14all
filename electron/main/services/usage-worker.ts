import { join } from "node:path";
import { existsSync, watch } from "node:fs";
import { jsonlDrivers } from "../../../services/usage/providers/index.js";
import { buildRangeResult } from "../../../services/usage/range.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import { saveState } from "../../../services/usage/ledger-store.js";
import {
	type SweepState,
	SweepFileError,
	createSweepState,
	loadPersistedState,
	recoverCodexLimits,
	sweepFiles,
} from "../../../services/usage/sweep.js";
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

// Consecutive failures per file, and the set quarantined once they exceed the
// budget. Cleared for a file as soon as it sweeps cleanly.
const fileFailures = new Map<string, number>();
const quarantined = new Set<string>();
const MAX_FILE_FAILURES = 3;

async function sweep(): Promise<void> {
	if (!cfg) return;
	if (backfilling) {
		rescanQueued = true;
		return;
	}
	backfilling = true;
	try {
		// All scan + idempotency + sealed-truncation-rebuild logic lives in sweepFiles
		// (electron-free + unit-tested in tests/unit/usage/sweep.test.ts).
		await sweepFiles(
			state,
			jsonlDrivers,
			cfg.home,
			cfg.launchMs,
			cfg.backfillBatchSize,
			scheduleEmit,
			(file) => quarantined.has(file),
		);
		persist();
		// A clean pass clears the failure counters: only CONSECUTIVE failures
		// should ever quarantine a file.
		fileFailures.clear();
	} catch (err) {
		// Recovery (design §3.2): discard in-memory state and reload the last
		// atomically persisted ledger+offset pair. A failure can land after some
		// events reached the ledger but before the offset was committed; keeping
		// that half-applied state would make the next sweep re-read the same
		// bytes and inflate the totals without bound. The persisted file is
		// written as ONE atomic unit, so reloading restores a consistent pair by
		// construction, and anything discarded is re-derived by the next sweep
		// (which is idempotent against those offsets).
		const file = err instanceof SweepFileError ? err.file : null;
		if (file) {
			const n = (fileFailures.get(file) ?? 0) + 1;
			fileFailures.set(file, n);
			if (n >= MAX_FILE_FAILURES) {
				quarantined.add(file);
				console.error(
					`[usage] quarantining ${file} after ${n} consecutive failures; its usage data will be missing until the next launch`,
				);
			}
		}
		console.error("[usage] sweep failed; reloading last persisted state", err);
		state = loadPersistedState(ledgerPath());
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

parentPort.on("message", (e: { data: MainToWorker }) => {
	const msg = e.data;
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
		// Readiness (design §3.4): announced only once the FIRST sweep and its
		// persist have both completed, which is what the host's re-fork budget
		// keys off. `sweep()` already contains its own failure recovery, so a
		// worker that survives a bad first pass still reports ready; one that
		// dies outright never does, and the budget correctly counts it.
		void sweep()
			.then(() => parentPort.postMessage({ kind: "ready" }))
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
