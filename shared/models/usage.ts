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
	active: boolean; // true => worktree currently open in the app
	tokens: TokenTotals; // billable in THIS scope
	costUsd: number | null; // notional; null only if the provider has no rate at all
}

export interface LimitGauge {
	provider: UsageProvider;
	fiveHour: { percent: number; resetsAtMs: number | null };
	weekly: {
		percent: number;
		resetsAtMs: number | null;
		used: number | null;
		budget: number | null;
	};
}

export interface UsageConfig {
	chipRange: "week" | "month"; // persisted chip glance preference
	includeUntracked: boolean;
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

export type UsageScope = "session" | "week" | "month" | "all-time";

export interface ScopeRollupRow {
	provider: AgentProviderId;
	tokens: number; // billable in this scope
	costUsd: number | null; // notional; null only if the provider has no rate at all
}

export interface ScopeData {
	scope: UsageScope;
	totalTokens: number; // billable across the scope
	byProvider: ScopeRollupRow[]; // provider roll-up, sorted desc by tokens
	rows: UsageRow[]; // workspace/worktree breakdown for THIS scope
	cost: CostSnapshot; // priced for THIS scope
}

export interface HourlyPoint {
	hourStartMs: number;
	tokens: Partial<Record<AgentProviderId, number>>;
}

export interface UsageSnapshot {
	generatedAtMs: number;
	providers: ProviderTelemetryInfo[]; // identity + capabilities + hasData
	scopes: Record<UsageScope, ScopeData>;
	seriesDaily: DailyPoint[]; // by provider, ~35d -> Week/Month chart
	seriesHourly: HourlyPoint[]; // by provider, this run -> Session chart
	codexLimits: LimitGauge | null;
	config: UsageConfig;
}
