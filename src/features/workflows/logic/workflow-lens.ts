import type { AgentAttentionReason } from "../../../../shared/models/agent-attention";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";

export type WorkflowRow = {
	worktreeId: string;
	workflowId: string;
	workflowType: string;
	phaseName: string | null;
	roundLabel: string | null;
	status: string;
	daemonAlive: boolean;
	liveFeed: "socket" | "polling";
};

export function toWorkflowRow(state: WhisperWorktreeState): WorkflowRow | null {
	if (state.workflow === null) return null;
	const wf = state.workflow;
	return {
		worktreeId: state.worktreeId,
		workflowId: wf.workflowId,
		workflowType: wf.workflowType,
		phaseName: wf.phaseName,
		roundLabel: wf.round ? `${wf.round.current}/${wf.round.max}` : null,
		status: wf.status,
		daemonAlive: state.daemonAlive,
		liveFeed: state.liveFeed,
	};
}

export type WorkflowAttentionEffect =
	| { kind: "report"; reason: AgentAttentionReason }
	| { kind: "clear" };

function attentionFor(
	state: WhisperWorktreeState,
	reportedAt: number,
): AgentAttentionReason | null {
	if (state.escalation !== null) {
		return {
			state: "waiting",
			source: "workflow",
			summary: state.escalation.reason,
			nextAction: "open workflow details",
			reportedAt,
		};
	}
	const wf = state.workflow;
	if (wf === null) return null;
	if (wf.status === "halted") {
		return {
			state: "waiting",
			source: "workflow",
			summary: wf.haltReason ?? "workflow halted",
			nextAction: "open workflow details",
			reportedAt,
		};
	}
	if (wf.status === "done") {
		return {
			state: "ready",
			source: "workflow",
			summary: "workflow done",
			nextAction: null,
			reportedAt,
		};
	}
	return null;
}

/**
 * Diffs consecutive snapshots for one worktree into at most one attention
 * effect. Keyed on the *content* of the would-be reason so polling (which
 * re-emits identical snapshots every few seconds) never spams the reducer.
 */
export function diffWorkflowAttention(
	previous: WhisperWorktreeState | undefined,
	next: WhisperWorktreeState,
	reportedAt: number,
): WorkflowAttentionEffect | null {
	const prevReason = previous ? attentionFor(previous, 0) : null;
	const nextReason = attentionFor(next, reportedAt);
	if (nextReason === null) {
		return prevReason === null ? null : { kind: "clear" };
	}
	if (
		prevReason !== null &&
		prevReason.state === nextReason.state &&
		prevReason.summary === nextReason.summary &&
		// A NEW escalation chain must re-report even when its reason text
		// matches the previous chain's — chainId is part of the identity.
		(previous?.escalation?.chainId ?? null) ===
			(next.escalation?.chainId ?? null)
	) {
		return null;
	}
	return { kind: "report", reason: nextReason };
}
