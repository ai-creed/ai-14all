import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import type {
	KnownWorktree,
	UsageSnapshot,
} from "../../../shared/models/usage.js";
import type {
	MainToWorker,
	UsageWorkerConfig,
	WorkerToMain,
} from "../../../services/usage/worker-protocol.js";

export interface UsageHostOptions {
	userDataDir: string;
	launchMs: number;
	send: (channel: string, payload: unknown) => void;
}

export const USAGE_SNAPSHOT_CHANNEL = "usage:snapshot";

export class UsageHost {
	private proc: UtilityProcess | null = null;
	private known: KnownWorktree[] = [];
	private activeWorktreeIds: string[] = [];
	private range: "week" | "month" = "week";
	private includeUntracked = false;
	private lastSnapshot: UsageSnapshot | null = null;
	private spawned = false;
	private pending: MainToWorker[] = [];

	constructor(private readonly opts: UsageHostOptions) {}

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

		const workerPath = fileURLToPath(
			new URL("./usage-worker.js", import.meta.url),
		);
		this.proc = utilityProcess.fork(workerPath, [], {
			serviceName: "ai14all-usage",
		});
		this.proc.on("message", (msg: WorkerToMain) => {
			if (msg.kind === "snapshot") {
				this.lastSnapshot = msg.snapshot;
				this.opts.send(USAGE_SNAPSHOT_CHANNEL, msg.snapshot);
			}
		});
		// utilityProcess can drop messages posted before the child has spawned, so
		// send config first on "spawn", then flush anything queued meanwhile.
		this.proc.on("spawn", () => {
			this.spawned = true;
			const config: UsageWorkerConfig = {
				home: homedir(),
				offsetCachePath: join(this.opts.userDataDir, "usage-offsets.json"),
				launchMs: this.opts.launchMs,
				known: this.known,
				activeWorktreeIds: this.activeWorktreeIds,
				range: this.range,
				includeUntracked: this.includeUntracked,
				backfillBatchSize: 8,
			};
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

	setRange(range: "week" | "month"): void {
		this.range = range;
		this.postMessage({ kind: "setRange", range });
	}

	setIncludeUntracked(includeUntracked: boolean): void {
		this.includeUntracked = includeUntracked;
		this.postMessage({ kind: "setIncludeUntracked", includeUntracked });
	}

	getLastSnapshot(): UsageSnapshot | null {
		return this.lastSnapshot;
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
