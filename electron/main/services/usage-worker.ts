import { existsSync, readFileSync, writeFileSync, watch } from "node:fs";
import {
	UsageAggregator,
	SERIES_WINDOW_MS,
} from "../../../services/usage/aggregator.js";
import {
	listJsonlFiles,
	processJsonlFile,
	resetRecentOffsets,
	type OffsetCache,
	type OffsetEntry,
} from "../../../services/usage/scanner.js";
import { jsonlDrivers } from "../../../services/usage/providers/index.js";
import { processInBatches } from "../../../services/usage/batch.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
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

let cfg: UsageWorkerConfig | null = null;
let agg: UsageAggregator | null = null;
const offsets: OffsetCache = new Map();
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let backfilling = false;
let rescanQueued = false;

function loadOffsets(path: string): void {
	try {
		const obj = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			OffsetEntry
		>;
		for (const [k, v] of Object.entries(obj)) offsets.set(k, v);
	} catch {
		/* first run */
	}
}

function saveOffsets(): void {
	if (!cfg) return;
	try {
		writeFileSync(
			cfg.offsetCachePath,
			JSON.stringify(Object.fromEntries(offsets)),
		);
	} catch {
		/* best effort */
	}
}

function emitSnapshot(): void {
	if (!cfg || !agg) return;
	parentPort.postMessage({
		kind: "snapshot",
		snapshot: buildSnapshot({
			agg,
			known: cfg.known,
			activeWorktreeIds: cfg.activeWorktreeIds,
			nowMs: Date.now(),
			// The effective setting → drives config.includeUntracked (the UI's
			// initial toggle) and whether totals count untracked. Untracked ROWS are
			// always emitted by buildSnapshot regardless, so the renderer can toggle
			// client-side with no worker round-trip.
			includeUntracked: cfg.includeUntracked,
			range: cfg.range,
		}),
	});
}

// Throttle: coalesce many triggers into at most one emit per ~1.5s.
function scheduleEmit(): void {
	if (emitTimer) return;
	emitTimer = setTimeout(() => {
		emitTimer = null;
		emitSnapshot();
	}, 1500);
}

// Full sweep (initial backfill + safety re-sweep). Chunked + throttled via the
// shared, unit-tested processInBatches driver (services/usage/batch.ts), so a
// large historical backfill yields to the event loop between batches and never
// blocks the worker's message handling. Emits progressively after each batch.
async function sweep(): Promise<void> {
	if (!cfg || !agg) return;
	if (backfilling) {
		rescanQueued = true;
		return;
	}
	backfilling = true;
	const batch = cfg.backfillBatchSize;
	for (const driver of jsonlDrivers) {
		for (const root of driver.roots(cfg.home)) {
			const files = existsSync(root) ? listJsonlFiles(root) : [];
			await processInBatches(
				files,
				batch,
				(file) =>
					processJsonlFile(
						driver,
						file,
						offsets,
						(e) => agg!.ingest(e),
						(id, rl) => agg!.setProviderLimits(id, rl),
					),
				scheduleEmit,
			);
		}
	}
	saveOffsets();
	backfilling = false;
	if (rescanQueued) {
		rescanQueued = false;
		void sweep();
	}
}

function watchDir(dir: string): void {
	if (!existsSync(dir)) return;
	try {
		watch(dir, { recursive: true }, () => void sweep());
	} catch {
		/* watch unsupported — rely on the 60s safety interval below */
	}
}

parentPort.on("message", (e) => {
	const msg = e.data;
	if (msg.kind === "config") {
		cfg = msg.config;
		agg = new UsageAggregator(cfg.launchMs);
		loadOffsets(cfg.offsetCachePath);
		const roots = jsonlDrivers.flatMap((d) => d.roots(cfg!.home));
		// The aggregator starts empty each launch, so persisted offsets would skip
		// pre-launch usage (only workspaces active *this* session would ever get
		// rows). Drop offsets for files touched within the analytics window so the
		// backfill rebuilds every series for every tracked worktree. Use a 35-day
		// window (SERIES_WINDOW_MS), not WEEK_MS: the aggregator is rebuilt empty
		// each launch and the daily chart shows the current calendar month, so files
		// 7–35 days old must be re-read or the month series undercounts after restart.
		resetRecentOffsets(roots, offsets, Date.now(), SERIES_WINDOW_MS);
		void sweep(); // chunked backfill; emits progressively, never blocks
		for (const root of roots) watchDir(root);
		setInterval(() => void sweep(), 60_000); // safety net if watch misses an append
	} else if (msg.kind === "setKnown" && cfg) {
		cfg.known = msg.known;
		scheduleEmit();
	} else if (msg.kind === "setActive" && cfg) {
		cfg.activeWorktreeIds = msg.activeWorktreeIds;
		scheduleEmit();
	} else if (msg.kind === "setRange" && cfg) {
		cfg.range = msg.range;
		scheduleEmit();
	} else if (msg.kind === "setIncludeUntracked" && cfg) {
		cfg.includeUntracked = msg.includeUntracked;
		scheduleEmit();
	}
});
