import type {
	KnownWorktree,
	UsageRangeData,
	UsageRangeQuery,
	UsageSnapshot,
} from "../../shared/models/usage.js";

export interface UsageWorkerConfig {
	home: string;
	userDataDir: string; // for the persisted ledger path
	launchMs: number;
	known: KnownWorktree[];
	activeWorktreeIds: string[];
	chipRange: "week" | "month";
	includeUntracked: boolean;
	backfillBatchSize: number;
}

export type MainToWorker =
	| { kind: "config"; config: UsageWorkerConfig }
	| { kind: "setKnown"; known: KnownWorktree[] }
	| { kind: "setActive"; activeWorktreeIds: string[] }
	| { kind: "setChipRange"; chipRange: "week" | "month" }
	| { kind: "setIncludeUntracked"; includeUntracked: boolean }
	| { kind: "queryRange"; requestId: string; query: UsageRangeQuery };

export type WorkerToMain =
	| { kind: "snapshot"; snapshot: UsageSnapshot }
	| { kind: "rangeResult"; requestId: string; result: UsageRangeData };
