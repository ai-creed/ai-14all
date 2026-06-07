import { existsSync, readFileSync, writeFileSync, watch } from "node:fs";
import { UsageAggregator } from "../../../services/usage/aggregator.js";
import { readClaudeTier } from "../../../services/usage/credentials.js";
import {
	listJsonlFiles,
	processClaudeFile,
	processCodexFile,
	resetRecentOffsets,
	type OffsetCache,
} from "../../../services/usage/scanner.js";
import { WEEK_MS } from "../../../services/usage/aggregator.js";
import { processInBatches } from "../../../services/usage/batch.js";
import { buildSnapshot } from "../../../services/usage/snapshot.js";
import {
	seedFiveHourBudget,
	seedWeeklyBudget,
} from "../../../services/usage/budget.js";
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
			{ offset: number; mtime: number }
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
	const tier = readClaudeTier(cfg.credentialsPath);
	parentPort.postMessage({
		kind: "snapshot",
		snapshot: buildSnapshot({
			agg,
			known: cfg.known,
			activeWorktreeIds: cfg.activeWorktreeIds,
			nowMs: Date.now(),
			// Always emit untracked rows so the renderer can toggle scope/untracked
			// instantly (no worker round-trip). cfg.includeUntracked is the persisted
			// UI default the renderer seeds from; it does not gate row emission.
			includeUntracked: true,
			claudeTier: tier,
			fiveHourBudget: cfg.fiveHourBudget ?? seedFiveHourBudget(tier),
			weeklyBudget: cfg.weeklyBudget ?? seedWeeklyBudget(tier),
			weeklyResetDay: cfg.weeklyResetDay,
			weeklyResetHour: cfg.weeklyResetHour,
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
	const claudeFiles = existsSync(cfg.claudeRoot)
		? listJsonlFiles(cfg.claudeRoot)
		: [];
	const codexFiles = existsSync(cfg.codexRoot)
		? listJsonlFiles(cfg.codexRoot)
		: [];
	await processInBatches(
		claudeFiles,
		batch,
		(file) => processClaudeFile(file, offsets, (e) => agg!.ingest(e)),
		scheduleEmit,
	);
	await processInBatches(
		codexFiles,
		batch,
		(file) => {
			const rl = processCodexFile(file, offsets, (e) => agg!.ingest(e));
			if (rl) agg!.setCodexLimits(rl);
		},
		scheduleEmit,
	);
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
		// The aggregator starts empty each launch, so persisted offsets would skip
		// this week's pre-launch usage (only workspaces active *this* session would
		// ever get rows). Drop offsets for files touched within the rolling window
		// so the backfill rebuilds the full week for every tracked worktree.
		resetRecentOffsets(
			[cfg.claudeRoot, cfg.codexRoot],
			offsets,
			Date.now(),
			WEEK_MS,
		);
		void sweep(); // chunked backfill; emits progressively, never blocks
		watchDir(cfg.claudeRoot);
		watchDir(cfg.codexRoot);
		setInterval(() => void sweep(), 60_000); // safety net if watch misses an append
	} else if (msg.kind === "setKnown" && cfg) {
		cfg.known = msg.known;
		scheduleEmit();
	} else if (msg.kind === "setActive" && cfg) {
		cfg.activeWorktreeIds = msg.activeWorktreeIds;
		scheduleEmit();
	} else if (msg.kind === "setBudgets" && cfg) {
		cfg.fiveHourBudget = msg.fiveHourBudget;
		cfg.weeklyBudget = msg.weeklyBudget;
		scheduleEmit();
	} else if (msg.kind === "setWeeklyReset" && cfg) {
		cfg.weeklyResetDay = msg.weeklyResetDay;
		cfg.weeklyResetHour = msg.weeklyResetHour;
		scheduleEmit();
	} else if (msg.kind === "setIncludeUntracked" && cfg) {
		cfg.includeUntracked = msg.includeUntracked;
		scheduleEmit();
	}
});
