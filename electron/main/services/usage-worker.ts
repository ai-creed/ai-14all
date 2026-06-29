import { join } from "node:path";
import { existsSync, watch } from "node:fs";
import { jsonlDrivers } from "../../../services/usage/providers/index.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import { saveState } from "../../../services/usage/ledger-store.js";
import {
	type SweepState,
	createSweepState,
	loadPersistedState,
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
	saveState(ledgerPath(), state.ledger, state.offsets);
}

async function sweep(): Promise<void> {
	if (!cfg) return;
	if (backfilling) {
		rescanQueued = true;
		return;
	}
	backfilling = true;
	// All scan + idempotency + sealed-truncation-rebuild logic lives in sweepFiles
	// (electron-free + unit-tested in tests/unit/usage/sweep.test.ts).
	await sweepFiles(state, jsonlDrivers, cfg.home, cfg.launchMs, cfg.backfillBatchSize, scheduleEmit);
	persist();
	backfilling = false;
	if (rescanQueued) {
		rescanQueued = false;
		void sweep();
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
		watch(dir, { recursive: true }, () => void sweep());
	} catch {
		/* watch unsupported — rely on the 60s safety interval below */
	}
}

parentPort.on("message", (e: { data: MainToWorker }) => {
	const msg = e.data;
	if (msg.kind === "config") {
		cfg = msg.config;
		state = loadPersistedState(ledgerPath());
		const roots = jsonlDrivers.flatMap((d) => d.roots(cfg!.home));
		void sweep();
		for (const root of roots) watchDir(root);
		setInterval(() => void sweep(), 60_000);
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
	}
});
