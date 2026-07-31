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
	| { kind: "rangeResult"; requestId: string; result: UsageRangeData }
	// Sent ONCE, only after the initial sweep AND its atomic persist have both
	// completed. This is the host's re-fork budget signal, and it is deliberately
	// NOT any-message: `snapshot` is emitted progressively DURING the initial
	// sweep (scheduleEmit is the sweep's onProgress) and `rangeResult` is
	// answered straight off the in-memory ledger regardless of sweep state, so
	// treating either as "healthy" would let a worker that always dies mid-sweep
	// reset the budget before every exit and re-fork forever.
	| { kind: "ready" };
