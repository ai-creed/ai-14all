import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
	InsightsWorkerConfig,
	MainToInsightsWorker,
	InsightsWorkerToMain,
} from "../../../services/insights/worker-protocol.js";
import type {
	Completeness,
	WhisperRunRow,
} from "../../../services/insights/store/views.js";

/** The typed read-contract result (spec §10.4): the runs in a range plus a
 *  coverage completeness flag. Mirrors the worker's `queryResult` payload. */
export type InsightsQueryResult = {
	runs: WhisperRunRow[];
	completeness: Completeness;
};

export interface InsightsHostOptions {
	userDataDir: string;
	whisperDbPath: string | null;
	pollIntervalMs: number;
	send: (channel: string, payload: unknown) => void;
	loadNoticeShown: () => boolean;
	persistNoticeShown: (v: boolean) => void;
	// Injectable for tests; defaults to a real utilityProcess.fork below.
	forkWorker?: () => UtilityProcess;
}

export const INSIGHTS_NOTICE_CHANNEL = "insights:notice";

// How long to wait for the worker to acknowledge a closeStore before proceeding
// with the delete anyway — a wedged worker must never hang delete-all.
const CLOSE_STORE_TIMEOUT_MS = 2000;

// How long to wait for a queryResult before falling back to an empty result, so
// a wedged worker can never hang a read (mirrors CLOSE_STORE_TIMEOUT_MS).
const QUERY_TIMEOUT_MS = 2000;

// The result returned to callers when there is no worker (capture disabled) or
// the worker never answers within QUERY_TIMEOUT_MS. Built fresh per call so a
// caller can never mutate a shared instance.
function emptyQueryResult(): InsightsQueryResult {
	return { runs: [], completeness: "unknown" };
}

export class InsightsHost {
	private proc: UtilityProcess | null = null;
	private spawned = false;
	private pending: MainToInsightsWorker[] = [];
	private pendingClose: (() => void) | null = null;
	// Monotonic per-host request-id source for queries — deterministic (no
	// Math.random/Date.now) so correlation is testable.
	private querySeq = 0;
	// In-flight queries keyed by requestId, so concurrent reads each resolve with
	// their OWN matching queryResult. The stored resolver clears its timeout and
	// removes itself from the map, so it settles at most once.
	private pendingQueries = new Map<
		string,
		(result: InsightsQueryResult) => void
	>();
	// At-most-once delivery PER worker session; reset on stop() so an UNACKNOWLEDGED
	// notice re-delivers when the next worker starts.
	private sessionNoticeSent = false;
	// In-process ack, INDEPENDENT of the worker lifecycle; never reset on stop() so a
	// disable→re-enable right after ack cannot re-fire before the persist has flushed.
	private acknowledged = false;
	// Set once a `status` carrying firstCaptureAt != null has been observed this
	// process lifetime — i.e. capture has actually started. Drives the
	// pull-on-mount recovery path (isNoticePending); it is NOT reset on stop(),
	// so a renderer that mounts long after the boot-time push can still recover
	// the notice. Independent of the per-worker push guard (sessionNoticeSent).
	private firstCaptureSeen = false;

	constructor(private readonly opts: InsightsHostOptions) {}

	private get insightsDir(): string {
		return join(this.opts.userDataDir, "insights");
	}

	private buildConfig(): InsightsWorkerConfig {
		return {
			userDataDir: this.opts.userDataDir,
			whisperDbPath: this.opts.whisperDbPath,
			pollIntervalMs: this.opts.pollIntervalMs,
		};
	}

	private defaultFork(): UtilityProcess {
		const workerPath = fileURLToPath(
			new URL("./insights-worker.js", import.meta.url),
		);
		return utilityProcess.fork(workerPath, [], {
			serviceName: "ai14all-insights",
		});
	}

	setEnabled(enabled: boolean): void {
		if (enabled) this.start();
		else this.stop();
	}

	// Gated: only fork when enabled. When disabled, no worker => zero cost (master kill).
	private start(): void {
		if (this.proc) return;
		this.proc = (this.opts.forkWorker ?? (() => this.defaultFork()))();
		this.proc.on("message", (msg: InsightsWorkerToMain) => this.onMessage(msg));
		// utilityProcess can drop messages posted before the child has spawned, so
		// seed config first on "spawn", then flush anything queued meanwhile.
		this.proc.on("spawn", () => {
			this.spawned = true;
			this.proc?.postMessage({ kind: "config", config: this.buildConfig() });
			for (const m of this.pending) this.proc?.postMessage(m);
			this.pending = [];
		});
	}

	private stop(): void {
		this.spawned = false;
		this.pending = [];
		// Per-worker-lifecycle guard: an UNACKNOWLEDGED notice must re-deliver on the
		// next start. (`acknowledged` is intentionally NOT reset here.)
		this.sessionNoticeSent = false;
		// A pending delete-all close-wait must not dangle across a stop().
		this.pendingClose = null;
		this.proc?.kill();
		this.proc = null;
	}

	// Deliver at most once per worker session, and never once acknowledged. The in-process
	// `acknowledged` flag suppresses re-delivery even if `persistNoticeShown` has not flushed yet,
	// so a disable→re-enable right after ack cannot re-fire on a stale `loadNoticeShown() === false`.
	private maybeDeliverNotice(): void {
		if (
			this.sessionNoticeSent ||
			this.acknowledged ||
			this.opts.loadNoticeShown()
		)
			return;
		this.sessionNoticeSent = true;
		this.opts.send(INSIGHTS_NOTICE_CHANNEL, {});
	}

	private onMessage(msg: InsightsWorkerToMain): void {
		if (msg.kind === "status") {
			if (msg.status.firstCaptureAt != null) {
				this.firstCaptureSeen = true;
				this.maybeDeliverNotice();
			}
			return;
		}
		if (msg.kind === "firstCapture") {
			this.maybeDeliverNotice();
			return;
		}
		if (msg.kind === "storeClosed") {
			this.pendingClose?.();
			this.pendingClose = null;
			return;
		}
		if (msg.kind === "queryResult") {
			// Correlate by requestId: resolve the matching in-flight query (the
			// resolver removes itself from the map and clears its timeout). A result
			// for an unknown/already-settled id (e.g. one that already timed out) is
			// ignored.
			this.pendingQueries.get(msg.requestId)?.(msg.result);
			return;
		}
	}

	/** Renderer ack (insights:noticeAck). Sets the in-process `acknowledged` guard synchronously — so
	 *  re-delivery stops at once regardless of when the async persist flushes — and persists
	 *  `noticeShown` durably for the next app launch. */
	ackNotice(): void {
		this.acknowledged = true;
		this.sessionNoticeSent = true;
		this.opts.persistNoticeShown(true);
	}

	/** Pull-on-mount recovery for the one-time first-capture notice (§14.5, D4).
	 *  The push (`insights:notice`) fires on the worker's FIRST tick at app boot —
	 *  when the renderer is still on the setup/restore screen and InsightsNotice is
	 *  NOT yet mounted — so the fire-and-forget push reaches no listener and is
	 *  lost. When the loaded shell later mounts, the renderer invokes this (via
	 *  insights:noticePending) to recover the notice it missed. Suppression matches
	 *  the push exactly: a first capture must have occurred, and neither the
	 *  in-process ack nor the durable `noticeShown` marker may be set. */
	isNoticePending(): boolean {
		return (
			this.firstCaptureSeen &&
			!this.acknowledged &&
			!this.opts.loadNoticeShown()
		);
	}

	private post(msg: MainToInsightsWorker): void {
		if (!this.proc) return;
		// Queue until the child has spawned (config is seeded first on "spawn").
		if (!this.spawned) {
			this.pending.push(msg);
			return;
		}
		this.proc.postMessage(msg);
	}

	// Typed read contract (spec §10.4 getWhisperRuns): post a correlated `query`
	// to the worker and resolve with the matching `queryResult`. The app may call
	// this even when capture is OFF, so with no worker we resolve an empty result
	// rather than rejecting. A timeout guards against a wedged worker that never
	// answers (mirrors deleteAll's close-wait fallback).
	query(range: { fromMs: number; toMs: number }): Promise<InsightsQueryResult> {
		if (!this.proc) return Promise.resolve(emptyQueryResult());
		const requestId = `q-${++this.querySeq}`;
		return new Promise<InsightsQueryResult>((resolve) => {
			const settle = (result: InsightsQueryResult): void => {
				// The map entry is the "still pending" guard: settle at most once.
				// (settle is only ever invoked asynchronously — from onMessage's map
				// lookup or the timeout below — so `timer` is always assigned by then.)
				if (!this.pendingQueries.delete(requestId)) return;
				clearTimeout(timer);
				resolve(result);
			};
			this.pendingQueries.set(requestId, settle);
			const timer = setTimeout(
				() => settle(emptyQueryResult()),
				QUERY_TIMEOUT_MS,
			);
			this.post({
				kind: "query",
				requestId,
				query: { name: "whisperRuns", range },
			});
		});
	}

	// Host-owned delete-all (§7.4): works whether or not the worker runs. If it runs,
	// ask the worker to close its SQLite handle first (awaiting `storeClosed`, with a
	// timeout fallback so a wedged worker can't hang), then stop it; then remove the
	// directory. Idempotent + safe when the store is absent (rm force:true).
	async deleteAll(): Promise<void> {
		if (this.proc) {
			await new Promise<void>((resolve) => {
				let done = false;
				const finish = (): void => {
					if (done) return;
					done = true;
					resolve();
				};
				this.pendingClose = finish;
				this.post({ kind: "closeStore", requestId: "delete-all" });
				// Don't hang if the worker never answers.
				setTimeout(() => {
					this.pendingClose = null;
					finish();
				}, CLOSE_STORE_TIMEOUT_MS);
			});
			this.stop();
		}
		await rm(this.insightsDir, { recursive: true, force: true });
	}
}
