import type { AgentProviderId } from "./agent-provider.js";

// Widened from "claude" | "codex": telemetry is now generic over the agent
// registry. Kept as a named alias so existing code keeps compiling.
export type UsageProvider = AgentProviderId;

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

export interface ProviderRateLimits {
	capturedAtMs: number;
	planType: string;
	primary: RateLimitWindow | null; // 5-hour
	secondary: RateLimitWindow | null; // weekly
}
/** @deprecated transitional alias — removed in cleanup task. */
export type CodexRateLimits = ProviderRateLimits;

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
	fiveHourBudget?: number; // deprecated — removed in cleanup task
	weeklyBudget?: number; // deprecated
	weeklyResetDay?: number; // deprecated
	weeklyResetHour?: number; // deprecated
	range?: "week" | "month"; // chart default
	includeUntracked?: boolean; // breakdown default
}

export type StoreKind = "jsonl-tree" | "sqlite-dir" | "none";
export type TimeSource = "per-event" | "file-mtime" | "none";
export type CwdSource = "in-line" | "dir-slug" | "none";

export interface ProviderTelemetryCapabilities {
	tokenLog: boolean; // emits parseable per-turn token usage on disk
	storeKind: StoreKind;
	timeSource: TimeSource; // ezio = "file-mtime"; inert = "none"
	cwdSource: CwdSource; // ezio = "dir-slug"; inert = "none"
	nativeLimits: boolean; // codex = true
}

export interface ProviderTelemetryInfo {
	id: AgentProviderId;
	label: string;
	brand: string; // identity from providerDef()
	capabilities: ProviderTelemetryCapabilities;
	hasData: boolean; // produced >= 1 event this run
}

export interface CostSnapshot {
	perProvider: Partial<Record<AgentProviderId, number>>; // priced notional $ (absent => "—")
	total: number; // sum of priced $; excludes unpriced tokens
	currency: "USD";
	notional: true;
	unpricedTokens: number; // billable tokens whose (provider, model) had no rate
}

export interface DailyPoint {
	dayStartMs: number;
	tokens: Partial<Record<AgentProviderId, number>>; // per-provider billable
}

export interface LifetimeSnapshot {
	inApp: { tokens: number; costUsd: number | null };
	allTime?: { tokens: number; costUsd: number | null };
}

export interface UsageSnapshot {
	generatedAtMs: number;
	limits: LimitGauge[]; // deprecated — removed in cleanup task
	rows: UsageRow[];
	totals: TokenTotals;
	config: UsageConfig;
	// New analytics surface (optional during migration):
	providers?: ProviderTelemetryInfo[];
	series?: DailyPoint[];
	cost?: CostSnapshot | null;
	codexLimits?: LimitGauge | null;
	lifetime?: LifetimeSnapshot;
}
