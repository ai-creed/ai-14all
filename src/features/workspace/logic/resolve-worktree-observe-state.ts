// src/features/workspace/logic/resolve-worktree-observe-state.ts
import {
	AGENT_ATTENTION_RANK,
	type AgentAttentionReason,
	type AgentAttentionReasonsBySource,
	type AgentAttentionSource,
	type AgentAttentionState,
	type AgentProvider,
} from "../../../../shared/models/agent-attention";
import type { ProcessSession } from "../../../../shared/models/process-session";
import type { WorktreeSession } from "../../../../shared/models/worktree-session";

export type ResolvedObserveState = {
	attention: AgentAttentionState;
	summary: string;
	nextAction: string | null;
	source: AgentAttentionSource;
	provider: AgentProvider | null;
	updatedAt: number;
};

function pickTopReason(
	reasons: AgentAttentionReasonsBySource,
): AgentAttentionReason | null {
	let best: AgentAttentionReason | null = null;
	for (const reason of Object.values(reasons)) {
		if (!reason) continue;
		if (
			best === null ||
			AGENT_ATTENTION_RANK[reason.state] > AGENT_ATTENTION_RANK[best.state]
		)
			best = reason;
	}
	return best;
}

export function resolveWorktreeObserveState(
	session: WorktreeSession,
	processSessionsById: Record<string, ProcessSession>,
): ResolvedObserveState {
	const activeProcess = session.activeProcessSessionId
		? processSessionsById[session.activeProcessSessionId]
		: undefined;
	// Process reasons first; session reasons win on equal rank (session is the
	// agent's own MCP/workflow report).
	const merged: AgentAttentionReasonsBySource = {
		...activeProcess?.agentAttentionReasons,
		...session.agentAttentionReasons,
	};
	const top = pickTopReason(merged);
	return {
		attention: top?.state ?? "idle",
		summary: top?.summary ?? "",
		nextAction: top?.nextAction ?? null,
		source: top?.source ?? "terminal",
		provider: activeProcess?.provider ?? null,
		updatedAt: top?.reportedAt ?? 0,
	};
}
