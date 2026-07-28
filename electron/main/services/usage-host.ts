import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
	KnownWorktree,
	UsageRangeQuery,
	UsageRangeResult,
	UsageSnapshot,
} from "../../../shared/models/usage.js";
import type {
	MainToWorker,
	UsageWorkerConfig,
	WorkerToMain,
} from "../../../services/usage/worker-protocol.js";
import type { UsageTelemetrySettings } from "../../../shared/models/persisted-workspace-state.js";

export interface UsageHostOptions {
	userDataDir: string;
	launchMs: number;
	send: (channel: string, payload: unknown) => void;
	loadSettings: () => UsageTelemetrySettings;
	persistSettings: (patch: Partial<UsageTelemetrySettings>) => void;
	// Injectable for tests; defaults to a real utilityProcess.fork below (mirrors
	// InsightsHost's forkWorker seam). Needed because the default fork path
	// resolves its worker path via `fileURLToPath(new URL(literal,
	// import.meta.url))` — under vitest's jsdom test environment, Vite's import
	// analysis specially rewrites that exact literal `new URL(x, import.meta.url)`
	// idiom into a dev-server-relative URL, so fileURLToPath throws
	// ERR_INVALID_URL_SCHEME long before utilityProcess.fork is ever reached.
	// Injecting the fork call sidesteps that path entirely in tests.
	forkWorker?: () => UtilityProcess;
}

export const USAGE_SNAPSHOT_CHANNEL = "usage:snapshot";

// How long to wait for a `rangeResult` before giving up on a wedged worker (or
// one that never gets the chance to answer at all — see the comment near the
// timer in `queryRange`). Mirrors InsightsHost's QUERY_TIMEOUT_MS.
const RANGE_TIMEOUT_MS = 2000;

export class UsageHost {
	private proc: UtilityProcess | null = null;
	private known: KnownWorktree[] = [];
	private activeWorktreeIds: string[] = [];
	private chipRange: "week" | "month";
	private includeUntracked: boolean;
	private lastSnapshot: UsageSnapshot | null = null;
	private spawned = false;
	private pending: MainToWorker[] = [];
	// Monotonic per-host request-id source for queryRange, deterministic so
	// correlation is testable (mirrors InsightsHost's querySeq).
	private rangeSeq = 0;
	// In-flight queryRange calls keyed by requestId; each stored resolver clears
	// its own timeout and removes itself from the map, so it settles at most
	// once (mirrors InsightsHost's pendingQueries).
	private pendingRanges = new Map<string, (r: UsageRangeResult) => void>();

	constructor(private readonly opts: UsageHostOptions) {
		const s = opts.loadSettings();
		this.chipRange = s.chipRange;
		this.includeUntracked = s.includeUntracked;
	}

	buildConfig(): UsageWorkerConfig {
		return {
			home: homedir(),
			userDataDir: this.opts.userDataDir,
			launchMs: this.opts.launchMs,
			known: this.known,
			activeWorktreeIds: this.activeWorktreeIds,
			chipRange: this.chipRange,
			includeUntracked: this.includeUntracked,
			backfillBatchSize: 8,
		};
	}

	private defaultFork(): UtilityProcess {
		const workerPath = fileURLToPath(
			new URL("./usage-worker.js", import.meta.url),
		);
		return utilityProcess.fork(workerPath, [], {
			serviceName: "ai14all-usage",
		});
	}

	// Gated: only start when enabled. When disabled, no worker, no watchers => zero cost.
	start(): void {
		if (this.proc) return;

		// E2E seam: when a fixture snapshot is provided, emit it and skip forking a
		// real worker (mirrors the AI14ALL_E2E_UPDATE_* pattern in update-notifier).
		const forced = process.env.AI14ALL_E2E_USAGE_SNAPSHOT;
		if (forced) {
			try {
				const snapshot = JSON.parse(forced) as UsageSnapshot;
				this.lastSnapshot = snapshot;
				this.opts.send(USAGE_SNAPSHOT_CHANNEL, snapshot);
			} catch {
				/* ignore malformed fixture */
			}
			return;
		}

		this.proc = (this.opts.forkWorker ?? (() => this.defaultFork()))();
		this.proc.on("message", (msg: WorkerToMain) => {
			if (msg.kind === "snapshot") {
				this.lastSnapshot = msg.snapshot;
				this.opts.send(USAGE_SNAPSHOT_CHANNEL, msg.snapshot);
				return;
			}
			if (msg.kind === "rangeResult") {
				// Correlate by requestId: resolve the matching in-flight call (the
				// resolver removes itself from the map and clears its timeout). A
				// result for an unknown/already-settled id (e.g. one that already
				// timed out) is ignored.
				this.pendingRanges.get(msg.requestId)?.({ ok: true, ...msg.result });
				return;
			}
		});
		// utilityProcess can drop messages posted before the child has spawned, so
		// send config first on "spawn", then flush anything queued meanwhile.
		this.proc.on("spawn", () => {
			this.spawned = true;
			const config = this.buildConfig();
			this.proc?.postMessage({ kind: "config", config });
			for (const msg of this.pending) this.proc?.postMessage(msg);
			this.pending = [];
		});
	}

	stop(): void {
		this.spawned = false;
		this.pending = [];
		this.proc?.kill();
		this.proc = null;
	}

	setEnabled(enabled: boolean): void {
		if (enabled) this.start();
		else this.stop();
	}

	setKnownWorktrees(known: KnownWorktree[]): void {
		this.known = known;
		this.postMessage({ kind: "setKnown", known });
	}

	setActiveWorktrees(activeWorktreeIds: string[]): void {
		this.activeWorktreeIds = activeWorktreeIds;
		this.postMessage({ kind: "setActive", activeWorktreeIds });
	}

	// Non-persisting appliers: update the live worker (and the config it seeds on
	// respawn) without writing settings back. Invoked from the settings:write IPC
	// handler, which has ALREADY persisted the merged value via SettingsService —
	// persisting again here would double-write settings.json and desync the
	// usage-settings-bridge snapshot.
	applyChipRange(range: "week" | "month"): void {
		this.chipRange = range;
		this.postMessage({ kind: "setChipRange", chipRange: range });
	}

	applyIncludeUntracked(includeUntracked: boolean): void {
		this.includeUntracked = includeUntracked;
		this.postMessage({ kind: "setIncludeUntracked", includeUntracked });
	}

	// Persisting setters: used by the usage popover's own IPC handlers
	// (usage:setChipRange / usage:setIncludeUntracked), which are the sole writer
	// for those toggles and therefore must persist through the bridge.
	setChipRange(range: "week" | "month"): void {
		this.opts.persistSettings({ chipRange: range });
		this.applyChipRange(range);
	}

	setIncludeUntracked(includeUntracked: boolean): void {
		this.opts.persistSettings({ includeUntracked });
		this.applyIncludeUntracked(includeUntracked);
	}

	getLastSnapshot(): UsageSnapshot | null {
		return this.lastSnapshot;
	}

	// Correlated cross-scope range read: any renderer window may call this
	// directly, independent of the pushed usage:snapshot scopes. The wire
	// message carries ONLY the caller-supplied range — chipRange/includeUntracked
	// never ride along — so those popover config knobs can never affect this
	// result (decision 14).
	queryRange(query: UsageRangeQuery): Promise<UsageRangeResult> {
		// Caller bug (degenerate or absurdly wide range): resolve WITHOUT ever
		// forwarding to the worker. `timeout` is the caller-visible signal here —
		// no dedicated wire-contract reason exists for "bad request" and adding
		// one is out of scope for this task.
		if (
			!Number.isFinite(query.fromMs) ||
			!Number.isFinite(query.toMs) ||
			query.toMs <= query.fromMs ||
			query.toMs - query.fromMs > 10 * 366 * 86_400_000
		) {
			return Promise.resolve({ ok: false, reason: "timeout" });
		}
		// No worker: telemetry disabled, OR the E2E fixture-snapshot seam (start()
		// returns early there too, so `this.proc` is never set) — same no-worker
		// state as every other gated host method.
		if (!this.proc) return Promise.resolve({ ok: false, reason: "disabled" });
		const requestId = `r-${++this.rangeSeq}`;
		return new Promise<UsageRangeResult>((resolve) => {
			const settle = (result: UsageRangeResult): void => {
				// The map entry IS the "still pending" guard: settle at most once.
				if (!this.pendingRanges.delete(requestId)) return;
				clearTimeout(timer);
				resolve(result);
			};
			this.pendingRanges.set(requestId, settle);
			// Also covers a ledger carry-note from Task 7: a queryRange posted
			// before the worker's `config` message has seeded is dropped by the
			// worker rather than acked, so this timeout is what rescues that
			// request from hanging forever — not only a wedged/slow worker.
			const timer = setTimeout(
				() => settle({ ok: false, reason: "timeout" }),
				RANGE_TIMEOUT_MS,
			);
			this.postMessage({ kind: "queryRange", requestId, query });
		});
	}

	private postMessage(msg: MainToWorker): void {
		if (!this.proc) return;
		// Queue until the child has spawned (config is sent first on "spawn").
		if (!this.spawned) {
			this.pending.push(msg);
			return;
		}
		this.proc.postMessage(msg);
	}
}
