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
import { Outbox, type OutboxEvent } from "../../../services/insights/outbox.js";
import type { AppSpan } from "../../../services/insights/app-focus/focus-core.js";
import { spanToObservation } from "../../../services/insights/app-focus/span-observation.js";
import type {
	AppTimeResult,
	AppTimeSeriesResult,
	CoverageAnchorsResult,
} from "../../../services/insights/worker-protocol.js";
import type { InsightsReadResult } from "../../../shared/contracts/commands.js";

/** The typed read-contract result (spec §10.4): the runs in a range plus a
 *  coverage completeness flag. Mirrors the worker's `queryResult` payload. */
export type InsightsQueryResult = {
	runs: WhisperRunRow[];
	completeness: Completeness;
};

/**
 * The main-process collector the host arms and disarms in lockstep with consent.
 * `stop()` drops open engagement spans WITHOUT emitting them and returns the
 * finalizing `app.uptime` span(s) to deliver (spec §4/§6).
 */
export interface InsightsCollector {
	start(): void;
	stop(): AppSpan[];
}

export interface InsightsHostOptions {
	userDataDir: string;
	whisperDbPath: string | null;
	pollIntervalMs: number;
	send: (channel: string, payload: unknown) => void;
	loadNoticeShown: () => boolean;
	persistNoticeShown: (v: boolean) => void;
	// Injectable for tests; defaults to a real utilityProcess.fork below.
	forkWorker?: () => UtilityProcess;
	collector?: InsightsCollector;
}

export const INSIGHTS_NOTICE_CHANNEL = "insights:notice";

// How long to wait for the worker to acknowledge a closeStore before proceeding
// with the delete anyway — a wedged worker must never hang delete-all.
const CLOSE_STORE_TIMEOUT_MS = 2000;

// How long to wait for a queryResult before falling back to an empty result, so
// a wedged worker can never hang a read (mirrors CLOSE_STORE_TIMEOUT_MS).
const QUERY_TIMEOUT_MS = 2000;

// Ceiling on the automatic crash re-fork. A worker that dies on every start
// (corrupt store, disk full, EACCES) would otherwise be re-forked forever at
// process-spawn rate; after this many consecutive failures the host gives up and
// says why. The budget is restored by the first MESSAGE a worker sends, not by
// `spawn`: the child boots its store when the `config` message arrives, i.e.
// AFTER it has spawned, so a persistent boot failure spawns happily every time
// and only then dies. Resetting on `spawn` would re-arm the loop forever; a
// message back proves the worker actually got as far as running.
const MAX_CONSECUTIVE_REFORKS = 5;

// The result returned to callers when there is no worker (capture disabled).
// Built fresh per call so a caller can never mutate a shared instance. A
// no-worker read is a legitimate "capture is off" state, not a failure, so it
// is always `{ ok: true, data: … }` — never an envelope error.
function emptyQueryResult(): InsightsQueryResult {
	return { runs: [], completeness: "unknown" };
}

function emptyAppTime(): AppTimeResult {
	return { focusedMs: 0, engagedMs: 0, completeness: "unknown" };
}

// No-worker series data is zero-filled from the (already-validated) bucket
// edges rather than an empty array, so a caller always gets one entry per
// edge-derived bucket regardless of whether capture is on.
function emptySeries(edges: number[]): AppTimeSeriesResult {
	return {
		buckets: edges
			.slice(0, -1)
			.map((startMs) => ({ startMs, focusedMs: 0, engagedMs: 0 })),
		completeness: "unknown",
	};
}

function emptyAnchors(): CoverageAnchorsResult {
	return {
		firstCaptureAt: null,
		appRetainedSinceMs: null,
		runsRetainedSinceMs: null,
	};
}

// Series validation (spec §4.3): array, finite numbers, strictly ascending,
// 2..9001 entries. Invalid input fails WITHOUT ever posting to the worker.
function isValidBucketEdges(edges: unknown): edges is number[] {
	return (
		Array.isArray(edges) &&
		edges.length >= 2 &&
		edges.length <= 9001 &&
		edges.every((v) => typeof v === "number" && Number.isFinite(v)) &&
		edges.every((v, i) => i === 0 || v > edges[i - 1])
	);
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
	// removes itself from the map, so it settles at most once. Settlers take the
	// full read-result envelope (spec §4/§10.4) so a `queryError` or timeout can
	// settle them with a typed failure reason rather than a fabricated empty.
	private pendingQueries = new Map<
		string,
		(result: InsightsReadResult<InsightsQueryResult>) => void
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
	private readonly outbox = new Outbox(undefined, (total, eventId) => {
		// Never a silent truncation (spec §6).
		console.warn(
			`[insights] outbox overflow: dropped oldest event ${eventId} (${total} dropped total)`,
		);
	});
	// Effective consent, flipped synchronously at the head of every transition.
	// The `exit` handler and delete-all's restart both consult it.
	private enabled = false;
	// Set before a deliberate kill so the `exit` handler can tell an intentional
	// stop from a crash; cleared when a new worker is forked.
	private intentionalStop = false;
	// Crash re-forks since the last worker that reported in. Bounds the automatic
	// restart loop (see MAX_CONSECUTIVE_REFORKS).
	private consecutiveReforks = 0;
	// Set once a disable drain has run `closeStore`: the worker's store is closed,
	// so the next enable must replace that worker rather than reuse it.
	private storeDrained = false;
	// E2E seam only: one-shot, fires immediately before the next producer post.
	private killBeforeNextProduce = false;
	// True for the duration of a delete-all wipe. Spec §6 requires the wipe steps
	// to be mutually exclusive with `produce`/`query`: nothing may be written into
	// or read from a half-deleted store, and no span captured during the wipe may
	// survive it.
	private wiping = false;
	// Lifecycle serialization + generation guard (spec §6).
	private busy = false;
	private readonly queue: Array<() => void> = [];
	private idleWaiters: Array<() => void> = [];
	private generation = 0;
	private appTimeSeq = 0;
	private pendingAppTime = new Map<
		string,
		(r: InsightsReadResult<AppTimeResult>) => void
	>();
	// Series (`s-`) and anchors (`c-`) share ONE request-id sequence — both are
	// carried on `this.querySeq`, the same counter `query()` uses for `q-`, so no
	// third/fourth field is needed; uniqueness is all that matters, not density.
	private pendingSeries = new Map<
		string,
		(r: InsightsReadResult<AppTimeSeriesResult>) => void
	>();
	private pendingAnchors = new Map<
		string,
		(r: InsightsReadResult<CoverageAnchorsResult>) => void
	>();
	// Held as a field, not read from opts, because the collector is constructed
	// AFTER the host in electron/main/index.ts (it needs the BrowserWindow).
	private collector: InsightsCollector | null = null;
	/** Opaque per-launch id the collector owns; used to map finalizing spans. */
	private appRunId = "";

	constructor(private readonly opts: InsightsHostOptions) {
		this.collector = opts.collector ?? null;
	}

	setCollector(collector: InsightsCollector): void {
		this.collector = collector;
	}

	setAppRunId(id: string): void {
		this.appRunId = id;
	}

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

	/**
	 * Serialize lifecycle transitions (spec §6). A transition with no awaits runs
	 * SYNCHRONOUSLY when the host is idle — so `setEnabled(true)` forks before the
	 * caller returns, preserving the existing contract — while one that awaits
	 * (disable's drain, delete-all's wipe) marks the host busy and defers any
	 * later transition until it settles. The generation is assigned at ENQUEUE
	 * time (spec §6), so a later-requested transition immediately supersedes any
	 * in-flight one: the superseded transition then abandons its remaining
	 * state-mutating steps rather than clobbering the newer request.
	 *
	 * A failing transition PROPAGATES to its caller's promise — `deleteAll` is
	 * privacy-facing and must never report success on a wipe that did not happen —
	 * while the queue is released identically on both outcomes (`busy` clears and
	 * `afterJob` runs), so a rejection can never wedge the serializer.
	 */
	private transition(fn: (gen: number) => void | Promise<void>): Promise<void> {
		const gen = ++this.generation;
		return new Promise<void>((resolve, reject) => {
			const job = (): void => {
				let r: void | Promise<void>;
				try {
					r = fn(gen);
				} catch (err) {
					reject(err);
					this.afterJob();
					return;
				}
				if (!r) {
					resolve();
					this.afterJob();
					return;
				}
				this.busy = true;
				// Only the caller-facing settlement differs between the two outcomes;
				// the queue hand-off is the same either way.
				const release = (settleCaller: () => void): void => {
					this.busy = false;
					settleCaller();
					this.afterJob();
				};
				void Promise.resolve(r).then(
					() => release(resolve),
					(err: unknown) => release(() => reject(err)),
				);
			};
			if (this.busy) this.queue.push(job);
			else job();
		});
	}

	private afterJob(): void {
		if (this.busy) return;
		const next = this.queue.shift();
		if (next) {
			next();
			return;
		}
		for (const w of this.idleWaiters.splice(0)) w();
	}

	/** Defense-in-depth: a superseded transition skips restart/re-arm steps. */
	private superseded(gen: number): boolean {
		return gen !== this.generation;
	}

	/**
	 * E2E seam only: ARM a one-shot crash that fires immediately BEFORE the next
	 * producer post (see `produce`). That makes the next span deterministically
	 * unacked — the worker is dead before the message could be delivered — so it
	 * can reach the store ONLY via the real `exit` handler's consent-gated
	 * re-fork and outbox replay. The stop is never marked intentional, so the
	 * production recovery path runs; nothing is suppressed and no manual restart
	 * is involved.
	 */
	crashWorkerForTest(): void {
		this.killBeforeNextProduce = true;
	}

	/** Resolves when no lifecycle transition is in flight (tests + shutdown). */
	whenIdle(): Promise<void> {
		if (!this.busy && this.queue.length === 0) return Promise.resolve();
		return new Promise<void>((res) => this.idleWaiters.push(res));
	}

	get outboxSize(): number {
		return this.outbox.size;
	}

	setEnabled(enabled: boolean): void {
		const done = this.transition((gen) => {
			// Capture-time consent: the flag flips FIRST, synchronously, so no
			// engagement can be produced at or after this instant (spec §6/AC5).
			this.enabled = enabled;
			if (enabled) {
				// A prior drain closed that worker's store, so it can never write
				// again: replace it. This teardown belongs to the ENABLE — the
				// superseded disable itself performed none (spec §6/§11).
				if (this.storeDrained && this.proc) this.stopWorker();
				this.start();
				this.collector?.start();
				return;
			}
			return this.disable(gen);
		});
		// Fire-and-forget by contract, but transitions now propagate their failures,
		// so this one has to be consumed here or it surfaces as an unhandled
		// rejection. Consent itself already flipped synchronously above.
		void done.catch((err: unknown) => {
			console.error("[insights] consent transition failed", err);
		});
	}

	// Gated: only fork when enabled. When disabled, no worker => zero cost (master kill).
	private start(): void {
		if (this.proc) return;
		this.intentionalStop = false;
		// Bind the handle LOCALLY and identity-guard every handler. A worker we
		// have already replaced can emit a delayed `exit` (or `spawn`) long after
		// the fact; without this guard that stale event would null out the CURRENT
		// worker's handle and trigger a spurious extra fork, breaking the stable
		// final state the rapid-toggle contract requires (spec §11).
		const proc = (this.opts.forkWorker ?? (() => this.defaultFork()))();
		this.proc = proc;
		proc.on("message", (msg: InsightsWorkerToMain) => {
			if (this.proc !== proc) return;
			// This worker got far enough to talk to us, so it booted its store: the
			// crash budget is restored. Deliberately keyed on a message rather than
			// on `spawn` — see MAX_CONSECUTIVE_REFORKS.
			this.consecutiveReforks = 0;
			this.onMessage(msg);
		});
		// utilityProcess can drop messages posted before the child has spawned, so
		// seed config first on "spawn", then replay every still-unacked producer
		// event (crash recovery, spec §6), and only then flush the queued control
		// messages. Replay MUST precede `pending`: a disable that began before the
		// child spawned has its `closeStore` sitting in `pending`, and delivering
		// that first would close the worker's store before the replayed finalizing
		// `app.uptime` row could be inserted — the insert would throw, nothing
		// would be acked, and the drain's `outbox.clear()` would lose the row.
		proc.on("spawn", () => {
			if (this.proc !== proc) return; // stale worker: it owns nothing now
			this.spawned = true;
			proc.postMessage({ kind: "config", config: this.buildConfig() });
			for (const ev of this.outbox.pending())
				proc.postMessage({
					kind: "producerEvent",
					eventId: ev.eventId,
					observation: ev.observation,
				});
			for (const m of this.pending) proc.postMessage(m);
			this.pending = [];
		});
		// Unexpected exit = crash. Clear the stale handle and re-fork ONLY while
		// consent is still on; a deliberate stop must never resurrect a worker,
		// and a replaced worker's late exit must not touch the live one.
		proc.on("exit", () => {
			if (this.proc !== proc) return; // already replaced — ignore entirely
			this.spawned = false;
			this.proc = null;
			if (this.intentionalStop || !this.enabled) return;
			// A worker that dies on every start would otherwise be re-forked forever
			// at process-spawn rate. Bound it, and never silently.
			if (this.consecutiveReforks >= MAX_CONSECUTIVE_REFORKS) {
				console.error(
					`[insights] worker exited ${this.consecutiveReforks} times in a row without ever reporting in (a boot failure: corrupt store, disk full, EACCES); giving up on the automatic re-fork. Capture stays off until consent is toggled or the app restarts.`,
				);
				return;
			}
			this.consecutiveReforks += 1;
			this.start();
		});
	}

	private stopWorker(): void {
		this.intentionalStop = true; // cleared when a new worker is forked
		this.storeDrained = false; // the drained worker is gone
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

	/**
	 * Consent-off (spec §6): engagement is already blocked by `enabled = false`.
	 * Drop the collector's open engagement spans, deliver ONLY the finalizing
	 * uptime interval, drain it with the `closeStore` → `storeClosed` handshake
	 * (FIFO-ordered after the uptime `producerEvent`, so the worker inserts that
	 * row before closing its DB), then tear down — unless a later transition
	 * superseded this one meanwhile.
	 */
	private disable(gen: number): void | Promise<void> {
		const finalizing = (this.collector?.stop() ?? []).filter(
			(s) => s.kind === "app.uptime",
		);
		for (const span of finalizing) this.produceSpan(span);
		if (this.proc && finalizing.length > 0) return this.drainThenStop(gen);
		this.stopWorker();
		this.outbox.clear();
	}

	private async drainThenStop(gen: number): Promise<void> {
		await new Promise<void>((resolve) => {
			let done = false;
			const finish = (): void => {
				if (done) return;
				done = true;
				resolve();
			};
			this.pendingClose = finish;
			this.post({ kind: "closeStore", requestId: "disable-drain" });
			setTimeout(() => {
				this.pendingClose = null;
				finish();
			}, CLOSE_STORE_TIMEOUT_MS);
		});
		// The handshake closed the worker's store: that worker can no longer write,
		// so whoever starts capture next must REPLACE it.
		this.storeDrained = true;
		// Superseded by a later transition (spec §6): abandon the remaining
		// state-mutating steps — do NOT stop the worker, do NOT clear the buffer.
		if (this.superseded(gen)) return;
		this.stopWorker();
		this.outbox.clear();
	}

	private produceSpan(span: AppSpan): void {
		const observation = spanToObservation(span, this.appRunId);
		this.produce({ eventId: observation.eventId, observation });
	}

	/**
	 * Accept a closed span for delivery. Capture-time consent (spec §6/AC5):
	 * engagement is refused at or after the disable instant; `app.uptime` is
	 * exempt because it is the consent-on window metadata finalized BY the
	 * disable itself.
	 */
	produce(event: OutboxEvent): void {
		// A wipe is in progress (spec §6): drop the span outright. Buffering it
		// would let a pre-wipe capture replay into the freshly created store.
		if (this.wiping) return;
		if (!this.enabled && event.observation.kind !== "app.uptime") return;
		if (this.killBeforeNextProduce) {
			// E2E seam (armed by crashWorkerForTest): die BEFORE this event can be
			// delivered. `spawned = false` stops the post below, and `this.proc` is
			// deliberately left set so the identity-guarded `exit` handler still
			// recognises this worker and runs the real re-fork + replay.
			this.killBeforeNextProduce = false;
			this.spawned = false;
			this.proc?.kill();
		}
		this.outbox.add(event);
		// Not yet spawned? The spawn handler's replay delivers it — posting here
		// too would duplicate the message.
		if (this.proc && this.spawned)
			this.proc.postMessage({
				kind: "producerEvent",
				eventId: event.eventId,
				observation: event.observation,
			});
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
		if (msg.kind === "ack") {
			this.outbox.ack(msg.eventId);
			return;
		}
		if (msg.kind === "appTimeResult") {
			this.pendingAppTime.get(msg.requestId)?.({ ok: true, data: msg.result });
			return;
		}
		if (msg.kind === "queryResult") {
			// Correlate by requestId: resolve the matching in-flight query (the
			// resolver removes itself from the map and clears its timeout). A result
			// for an unknown/already-settled id (e.g. one that already timed out) is
			// ignored.
			this.pendingQueries.get(msg.requestId)?.({ ok: true, data: msg.result });
			return;
		}
		if (msg.kind === "seriesResult") {
			this.pendingSeries.get(msg.requestId)?.({ ok: true, data: msg.result });
			return;
		}
		if (msg.kind === "anchorsResult") {
			this.pendingAnchors.get(msg.requestId)?.({ ok: true, data: msg.result });
			return;
		}
		if (msg.kind === "queryError") {
			// A correlated query failure (spec §4.1): try each pending map — the
			// requestId prefix already picks out at most one, and every settler
			// self-removes on first fire, so this can never double-settle.
			const failure: InsightsReadResult<never> = {
				ok: false,
				reason: "query-failed",
			};
			this.pendingQueries.get(msg.requestId)?.(failure);
			this.pendingAppTime.get(msg.requestId)?.(failure);
			this.pendingSeries.get(msg.requestId)?.(failure);
			this.pendingAnchors.get(msg.requestId)?.(failure);
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
	// this even when capture is OFF, so with no worker we resolve `{ ok: true,
	// data: <empty> }` rather than an envelope error — capture-off is not a
	// failure. A timeout guards against a wedged worker that never answers
	// (mirrors deleteAll's close-wait fallback), and a mid-wipe call is refused
	// as `busy` rather than reading a half-deleted store (spec §6).
	query(range: {
		fromMs: number;
		toMs: number;
	}): Promise<InsightsReadResult<InsightsQueryResult>> {
		if (this.wiping) return Promise.resolve({ ok: false, reason: "busy" });
		if (!this.proc)
			return Promise.resolve({ ok: true, data: emptyQueryResult() });
		const requestId = `q-${++this.querySeq}`;
		return new Promise<InsightsReadResult<InsightsQueryResult>>((resolve) => {
			const settle = (
				result: InsightsReadResult<InsightsQueryResult>,
			): void => {
				// The map entry is the "still pending" guard: settle at most once.
				// (settle is only ever invoked asynchronously — from onMessage's map
				// lookup or the timeout below — so `timer` is always assigned by then.)
				if (!this.pendingQueries.delete(requestId)) return;
				clearTimeout(timer);
				resolve(result);
			};
			this.pendingQueries.set(requestId, settle);
			const timer = setTimeout(
				() => settle({ ok: false, reason: "timeout" }),
				QUERY_TIMEOUT_MS,
			);
			this.post({
				kind: "query",
				requestId,
				query: { name: "whisperRuns", range },
			});
		});
	}

	// Correlated app-time read (spec §7). Mirrors `query`'s envelope, timeout,
	// no-worker, and busy handling so a wedged worker (or capture being off, or
	// a mid-wipe call) can never hang or corrupt a read.
	queryAppTime(range: {
		fromMs: number;
		toMs: number;
	}): Promise<InsightsReadResult<AppTimeResult>> {
		if (this.wiping) return Promise.resolve({ ok: false, reason: "busy" });
		if (!this.proc) return Promise.resolve({ ok: true, data: emptyAppTime() });
		const requestId = `a-${++this.appTimeSeq}`;
		return new Promise<InsightsReadResult<AppTimeResult>>((resolve) => {
			const settle = (result: InsightsReadResult<AppTimeResult>): void => {
				if (!this.pendingAppTime.delete(requestId)) return;
				clearTimeout(timer);
				resolve(result);
			};
			this.pendingAppTime.set(requestId, settle);
			const timer = setTimeout(
				() => settle({ ok: false, reason: "timeout" }),
				QUERY_TIMEOUT_MS,
			);
			this.post({
				kind: "query",
				requestId,
				query: { name: "appTime", range },
			});
		});
	}

	// Correlated bucketed app-time series read (spec §4.3). Validation runs
	// FIRST and never posts to the worker on failure — a bad request is a caller
	// bug, not something a wedged/absent worker should ever see. Shares its
	// request-id sequence with `query()` (both use `this.querySeq`; see the
	// `pendingSeries` field comment).
	queryAppTimeSeries(
		bucketEdgesMs: number[],
	): Promise<InsightsReadResult<AppTimeSeriesResult>> {
		if (!isValidBucketEdges(bucketEdgesMs))
			return Promise.resolve({ ok: false, reason: "bad-request" });
		if (this.wiping) return Promise.resolve({ ok: false, reason: "busy" });
		if (!this.proc)
			return Promise.resolve({ ok: true, data: emptySeries(bucketEdgesMs) });
		const requestId = `s-${++this.querySeq}`;
		return new Promise<InsightsReadResult<AppTimeSeriesResult>>((resolve) => {
			const settle = (
				result: InsightsReadResult<AppTimeSeriesResult>,
			): void => {
				if (!this.pendingSeries.delete(requestId)) return;
				clearTimeout(timer);
				resolve(result);
			};
			this.pendingSeries.set(requestId, settle);
			const timer = setTimeout(
				() => settle({ ok: false, reason: "timeout" }),
				QUERY_TIMEOUT_MS,
			);
			this.post({
				kind: "query",
				requestId,
				query: { name: "appTimeSeries", bucketEdgesMs },
			});
		});
	}

	// Correlated retention/coverage-anchors read (spec §4.5). Mirrors `query`'s
	// envelope, timeout, no-worker, and busy handling. Shares its request-id
	// sequence with `query()`/`queryAppTimeSeries()` (see `pendingSeries`).
	coverageAnchors(): Promise<InsightsReadResult<CoverageAnchorsResult>> {
		if (this.wiping) return Promise.resolve({ ok: false, reason: "busy" });
		if (!this.proc) return Promise.resolve({ ok: true, data: emptyAnchors() });
		const requestId = `c-${++this.querySeq}`;
		return new Promise<InsightsReadResult<CoverageAnchorsResult>>((resolve) => {
			const settle = (
				result: InsightsReadResult<CoverageAnchorsResult>,
			): void => {
				if (!this.pendingAnchors.delete(requestId)) return;
				clearTimeout(timer);
				resolve(result);
			};
			this.pendingAnchors.set(requestId, settle);
			const timer = setTimeout(
				() => settle({ ok: false, reason: "timeout" }),
				QUERY_TIMEOUT_MS,
			);
			this.post({
				kind: "query",
				requestId,
				query: { name: "coverageAnchors" },
			});
		});
	}

	/**
	 * Host-owned delete-all (spec §6/§7.4), serialized with every other
	 * transition: pause capture → discard the outbox → wipe → restart iff consent
	 * is still on. Works whether or not the worker runs; when it does, the worker
	 * is asked to close its SQLite handle first (awaiting `storeClosed`, with a
	 * timeout fallback so a wedged worker can't hang). Idempotent + safe when the
	 * store is absent (rm force:true). The public delete does NOT change consent,
	 * so capture must resume by itself.
	 *
	 * A failure REJECTS: this is privacy-facing, so the caller must never be told
	 * the data is gone when it is still on disk. The restart runs regardless (it
	 * lives in the `finally`), so a failed wipe cannot strand `enabled === true`
	 * with no worker — which would leave capture dead while `produce` silently
	 * filled the outbox to its cap.
	 */
	deleteAll(): Promise<void> {
		return this.transition(async (gen) => {
			// Steps 1-3 run under the wipe gate, so `produce`/`query` cannot touch a
			// half-deleted store and no span captured meanwhile survives (spec §6).
			this.wiping = true;
			try {
				this.collector?.stop(); // (1) pause: spans are dropped — the store is about to go
				this.outbox.clear(); // (2) discard: nothing pre-wipe may replay
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
					this.stopWorker();
				}
				await rm(this.insightsDir, { recursive: true, force: true }); // (3) wipe
			} catch (err) {
				console.error(
					"[insights] delete-all failed; the store may still be on disk. Capture is restarted anyway.",
					err,
				);
				throw err; // the caller must learn the wipe did not happen
			} finally {
				// Lift the gate BEFORE the restart so the re-armed collector's spans
				// are accepted. Both live in the `finally` so a failed wipe can never
				// wedge capture off: the worker was already killed above, so skipping
				// the restart would leave consent on with no worker at all.
				this.wiping = false;
				if (!this.superseded(gen) && this.enabled) {
					this.start(); // (4) restart: migrate() recreates a fresh v1 store
					this.collector?.start();
				}
			}
		});
	}
}
