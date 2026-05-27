import type {
	KnownWorktree,
	UsageSnapshot,
} from "../../shared/models/usage.js";

export interface UsageWorkerConfig {
	claudeRoot: string; // ~/.claude/projects
	codexRoot: string; // ~/.codex/sessions
	credentialsPath: string; // ~/.claude/.credentials.json
	offsetCachePath: string; // userData/usage-offsets.json
	launchMs: number;
	known: KnownWorktree[]; // all tracked worktrees
	activeWorktreeIds: string[]; // currently open in the app
	fiveHourBudget: number | null;
	weeklyBudget: number | null;
	weeklyResetDay: number; // 0=Sun..6=Sat (local)
	weeklyResetHour: number; // 0..23 (local)
	includeUntracked: boolean;
	backfillBatchSize: number; // files processed per setImmediate tick
}

export type MainToWorker =
	| { kind: "config"; config: UsageWorkerConfig }
	| { kind: "setKnown"; known: KnownWorktree[] }
	| { kind: "setActive"; activeWorktreeIds: string[] }
	| {
			kind: "setBudgets";
			fiveHourBudget: number | null;
			weeklyBudget: number | null;
	  }
	| { kind: "setWeeklyReset"; weeklyResetDay: number; weeklyResetHour: number }
	| { kind: "setIncludeUntracked"; includeUntracked: boolean };

export type WorkerToMain = { kind: "snapshot"; snapshot: UsageSnapshot };
