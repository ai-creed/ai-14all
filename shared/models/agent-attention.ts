export type AgentAttentionState =
	| "waiting"
	| "failed"
	| "ready"
	| "stale"
	| "active"
	| "idle";

export type AgentAttentionSource =
	| "mcp"
	| "terminal"
	| "lifecycle"
	| "workflow";

export type AgentAttentionReason = {
	state: AgentAttentionState;
	source: AgentAttentionSource;
	summary: string;
	nextAction: string | null;
	reportedAt: number;
};

export type AgentAttentionReasonsBySource = Partial<
	Record<AgentAttentionSource, AgentAttentionReason>
>;

export const STALE_THRESHOLD_MS = 120_000;

export const AGENT_ATTENTION_RANK: Record<AgentAttentionState, number> = {
	idle: 0,
	active: 1,
	stale: 2,
	ready: 3,
	failed: 4,
	waiting: 5,
};

export type AgentProvider = "claude" | "codex" | "ezio" | "other";
