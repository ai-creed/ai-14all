export type UsageProvider = "claude" | "codex";

export interface TokenTotals {
	input: number; // prompt-side: input + cache_creation (what you send)
	output: number; // what the model generates
	billable: number; // input + output (excludes cache reads)
	raw: number; // billable + cache reads
}

export interface UsageEvent {
	provider: UsageProvider;
	timestampMs: number;
	cwd: string;
	sessionId: string;
	model: string;
	input: number;
	output: number;
	billable: number;
	raw: number;
}

export interface RateLimitWindow {
	usedPercent: number;
	windowMinutes: number;
	resetsAtMs: number;
}

export interface CodexRateLimits {
	capturedAtMs: number;
	planType: string;
	primary: RateLimitWindow | null; // 5-hour
	secondary: RateLimitWindow | null; // weekly
}

export interface KnownWorktree {
	worktreeId: string;
	workspaceId: string;
	title: string;
	path: string;
}

export interface UsageRow {
	workspaceId: string | null; // null => untracked
	worktreeId: string | null;
	// Absolute worktree path — the stable cross-process identity. Worktree ids are
	// regenerated per listing (randomUUID), so the renderer matches rows by path.
	worktreePath: string | null;
	worktreeTitle: string;
	provider: UsageProvider;
	active: boolean; // true => worktree currently open in the app (scope = Active)
	sinceLaunch: TokenTotals;
	thisWeek: TokenTotals;
}

export interface LimitGauge {
	provider: UsageProvider;
	real: boolean; // true = Codex real %, false = Claude budget proxy
	fiveHour: { percent: number; resetsAtMs: number | null };
	weekly: {
		percent: number;
		resetsAtMs: number | null;
		used: number | null;
		budget: number | null;
	};
}

export interface UsageConfig {
	fiveHourBudget: number;
	weeklyBudget: number;
	weeklyResetDay: number; // 0=Sun..6=Sat (local)
	weeklyResetHour: number; // 0..23 (local)
}

export interface UsageSnapshot {
	generatedAtMs: number;
	limits: LimitGauge[];
	rows: UsageRow[];
	totals: TokenTotals;
	config: UsageConfig; // effective values, for the budget editor to prefill
}
