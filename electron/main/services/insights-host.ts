import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
	InsightsWorkerConfig,
	MainToInsightsWorker,
	InsightsWorkerToMain,
} from "../../../services/insights/worker-protocol.js";

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
export const INSIGHTS_QUERY_RESULT_CHANNEL = "insights:queryResult";

// How long to wait for the worker to acknowledge a closeStore before proceeding
// with the delete anyway — a wedged worker must never hang delete-all.
const CLOSE_STORE_TIMEOUT_MS = 2000;

export class InsightsHost {
	private proc: UtilityProcess | null = null;
	private spawned = false;
	private pending: MainToInsightsWorker[] = [];
	private pendingClose: (() => void) | null = null;
	// At-most-once delivery PER worker session; reset on stop() so an UNACKNOWLEDGED
	// notice re-delivers when the next worker starts.
	private sessionNoticeSent = false;
	// In-process ack, INDEPENDENT of the worker lifecycle; never reset on stop() so a
	// disable→re-enable right after ack cannot re-fire before the persist has flushed.
	private acknowledged = false;

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
			if (msg.status.firstCaptureAt != null) this.maybeDeliverNotice();
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
			this.opts.send(INSIGHTS_QUERY_RESULT_CHANNEL, msg);
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

	private post(msg: MainToInsightsWorker): void {
		if (!this.proc) return;
		// Queue until the child has spawned (config is seeded first on "spawn").
		if (!this.spawned) {
			this.pending.push(msg);
			return;
		}
		this.proc.postMessage(msg);
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
