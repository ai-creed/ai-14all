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

// Ceiling on the automatic crash re-fork, mirroring InsightsHost's. The budget
// is restored by the worker's `ready` message — NOT by `spawn` and NOT by any
// message: a worker that dies during its own initial sweep spawns happily every
// time and emits progress snapshots on the way down, so keying off either would
// re-arm the loop forever.
const MAX_CONSECUTIVE_REFORKS = 5;

export class UsageHost {
	private proc: UtilityProcess | null = null;
	private known: KnownWorktree[] = [];
	private activeWorktreeIds: string[] = [];
	private chipRange: "week" | "month";
	private includeUntracked: boolean;
	private lastSnapshot: UsageSnapshot | null = null;
	private spawned = false;
	private pending: MainToWorker[] = [];
	// Set before a deliberate kill so the `exit` handler can tell an intentional
	// stop from a crash; cleared when a new worker is forked.
	private intentionalStop = false;
	// Crash re-forks since the last worker that reported ready.
	private consecutiveReforks = 0;
	// True once the re-fork budget is spent: reads then report `disabled` (there
	// really is no worker) rather than burning 2s on a timeout each time.
	private gaveUp = false;
	// Last consent value seen by setEnabled, so a repeated `setEnabled(true)`
	// from an unrelated settings patch is not mistaken for a re-enable.
	private enabled: boolean;
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
		this.enabled = s.enabled;
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

		this.intentionalStop = false;
		// Bind the handle LOCALLY and identity-guard every handler: a worker we
		// have already replaced can emit a delayed exit long after the fact, and
		// without this guard that stale event would null out the CURRENT worker's
		// handle and trigger a spurious extra fork.
		const proc = (this.opts.forkWorker ?? (() => this.defaultFork()))();
		this.proc = proc;
		proc.on("message", (msg: WorkerToMain) => {
			if (this.proc !== proc) return;
			if (msg.kind === "ready") {
				// The worker completed an initial sweep AND persisted it, so it is
				// genuinely healthy: restore the crash budget.
				this.consecutiveReforks = 0;
				return;
			}
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
		proc.on("spawn", () => {
			if (this.proc !== proc) return; // stale worker: it owns nothing now
			this.spawned = true;
			const config = this.buildConfig();
			proc.postMessage({ kind: "config", config });
			for (const msg of this.pending) proc.postMessage(msg);
			this.pending = [];
		});
		// An unexpected exit is a crash. Without this handler the host kept a
		// stale non-null `proc`, so every later queryRange posted into a dead pipe
		// and could only settle via its 2s timeout — which the insights dashboard
		// renders as "the local insights database could not be read", permanently,
		// because retry re-runs the same dead read.
		proc.on("exit", (code?: number) => {
			if (this.proc !== proc) return; // already replaced — ignore entirely
			this.spawned = false;
			this.proc = null;
			// Don't make callers wait out a timeout for a worker that is already
			// gone: settle every in-flight read now.
			this.failPendingRanges("disabled");
			if (this.intentionalStop) return;
			if (this.consecutiveReforks >= MAX_CONSECUTIVE_REFORKS) {
				this.gaveUp = true;
				console.error(
					`[usage] worker exited ${this.consecutiveReforks} times in a row without ever reporting ready (a boot failure: corrupt state, disk full, EACCES); giving up on the automatic re-fork. Usage capture stays off until telemetry is toggled or the app restarts.`,
				);
				return;
			}
			this.consecutiveReforks += 1;
			console.error(
				`[usage] worker exited unexpectedly (code ${String(code)}); re-forking (attempt ${this.consecutiveReforks}/${MAX_CONSECUTIVE_REFORKS})`,
			);
			this.start();
		});
	}

	// Settle every in-flight range read at once, so a dead worker cannot leave
	// callers hanging until their individual timers fire.
	private failPendingRanges(reason: "disabled" | "timeout"): void {
		for (const settle of [...this.pendingRanges.values()])
			settle({ ok: false, reason });
	}

	stop(): void {
		this.intentionalStop = true; // cleared when a new worker is forked
		this.spawned = false;
		this.pending = [];
		this.proc?.kill();
		this.proc = null;
		this.failPendingRanges("disabled");
	}

	setEnabled(enabled: boolean): void {
		// `settings:write` calls this for EVERY usage-telemetry patch — chip
		// range, include-untracked, even an insights-only change — so `enabled`
		// is usually unchanged. Only a real disable -> enable TRANSITION counts
		// as the user asking for another go; clearing the budget on every patch
		// would be a second way to re-arm a crash loop with no healthy worker,
		// which is exactly what the readiness-only reset rule exists to prevent.
		const wasEnabled = this.enabled;
		this.enabled = enabled;
		if (!enabled) {
			this.stop();
			return;
		}
		if (!wasEnabled) {
			this.consecutiveReforks = 0;
			this.gaveUp = false;
		} else if (this.gaveUp) {
			// Already enabled AND already abandoned: an unrelated settings patch
			// must not quietly resurrect the worker either, or the budget is
			// bypassed rather than merely re-armed.
			return;
		}
		this.start();
	}

	/** True once repeated crashes exhausted the re-fork budget (diagnostics). */
	get hasGivenUp(): boolean {
		return this.gaveUp;
	}

	/**
	 * E2E seam only: kill the worker WITHOUT marking the stop intentional, so
	 * the real `exit` handler runs — settling in-flight reads and re-forking.
	 * Lets an e2e exercise dashboard recovery through the production path rather
	 * than only unit-testing the host.
	 */
	crashWorkerForTest(): void {
		this.spawned = false;
		this.proc?.kill();
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
		// No worker: telemetry disabled, OR the E2E fixture-snapshot seam (start()
		// returns early there too, so `this.proc` is never set) — same no-worker
		// state as every other gated host method. Checked FIRST, ahead of the
		// caller-bug guard below: telemetry-off must never present as a
		// retryable `timeout` error just because the caller also happened to
		// pass a degenerate range.
		if (!this.proc) return Promise.resolve({ ok: false, reason: "disabled" });
		// Degenerate-input defense ONLY (non-finite bounds, or toMs <= fromMs):
		// resolve WITHOUT ever forwarding to the worker. `timeout` is the
		// caller-visible signal here — no dedicated wire-contract reason exists
		// for "bad request" and adding one is out of scope for this task. Span
		// SIZE is deliberately NOT checked here (there used to be a `> 10 years`
		// rejection, and after that a worker-side walk clamp meant to replace
		// it — both were misplaced policy — §4.7/AC3 require `all` to start at
		// the real min(earliestDayMs, anchors) with no exception, so a
		// legitimately deep ledger must never be rejected OR silently
		// truncated). There is no span-size defense anywhere in this path
		// anymore: services/usage/range.ts emits `days` SPARSELY (one point
		// per ledger day with data, not one per calendar day), so its cost is
		// bounded by the ledger's own real size, not by how wide a window the
		// caller asks for — an absurd `toMs` costs nothing extra and needs no
		// clamp.
		if (
			!Number.isFinite(query.fromMs) ||
			!Number.isFinite(query.toMs) ||
			query.toMs <= query.fromMs
		) {
			return Promise.resolve({ ok: false, reason: "timeout" });
		}
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
