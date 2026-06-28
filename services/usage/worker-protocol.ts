import type {
	KnownWorktree,
	UsageSnapshot,
} from "../../shared/models/usage.js";

export interface UsageWorkerConfig {
	home: string; // os.homedir(); drivers derive their roots from this
	offsetCachePath: string; // userData/usage-offsets.json
	launchMs: number;
	known: KnownWorktree[];
	activeWorktreeIds: string[];
	range: "week" | "month"; // chart default
	includeUntracked: boolean;
	backfillBatchSize: number; // files processed per setImmediate tick
}

export type MainToWorker =
	| { kind: "config"; config: UsageWorkerConfig }
	| { kind: "setKnown"; known: KnownWorktree[] }
	| { kind: "setActive"; activeWorktreeIds: string[] }
	| { kind: "setRange"; range: "week" | "month" }
	| { kind: "setIncludeUntracked"; includeUntracked: boolean };

export type WorkerToMain = { kind: "snapshot"; snapshot: UsageSnapshot };
