import type { AgentAttentionReason } from "../../../../shared/models/agent-attention";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";

export type WorkflowRow = {
	worktreeId: string;
	workflowId: string;
	workflowType: string;
	/** Friendly short label for the workflow type (SDD/Ralph/Bugfix). */
	typeLabel: string;
	/** Basename of the workflow's spec/artifact, or null when none is set. */
	artifact: string | null;
	phaseName: string | null;
	roundLabel: string | null;
	status: string;
	/** The collab's relay chain has escalated to a human (separate from status). */
	escalated: boolean;
	daemonAlive: boolean;
	liveFeed: "socket" | "polling";
};

/** Friendly short labels for whisper's known workflow_type values. */
const WORKFLOW_TYPE_LABELS: Record<string, string> = {
	"spec-driven-development": "SDD",
	"ralph-loop": "Ralph",
	"complex-bug-fixing": "Bugfix",
};

/** Map a raw workflow_type to a short label; unknown types pass through. */
export function workflowTypeLabel(type: string): string {
	return WORKFLOW_TYPE_LABELS[type] ?? type;
}

/**
 * Human-readable status word for the sidebar lens. `done` reads as "completed"
 * (the friendlier terminal word); every other status — `halted`, `escalated`,
 * `running`, `paused`, `canceled`, or an unknown value — passes through as-is.
 */
export function workflowStatusLabel(statusKey: string): string {
	return statusKey === "done" ? "completed" : statusKey;
}

/**
 * The artifact's display name: the spec path's basename, or null when empty.
 * Tolerates missing data (null/undefined) — IPC snapshots are untyped at
 * runtime, so a version skew or older snapshot must degrade to "no artifact"
 * rather than crash the render.
 */
export function artifactLabel(
	specPath: string | null | undefined,
): string | null {
	const base = (specPath ?? "").trim().split("/").filter(Boolean).pop();
	return base ?? null;
}

export function toWorkflowRow(state: WhisperWorktreeState): WorkflowRow | null {
	if (state.workflow === null) return null;
	const wf = state.workflow;
	return {
		worktreeId: state.worktreeId,
		workflowId: wf.workflowId,
		workflowType: wf.workflowType,
		typeLabel: workflowTypeLabel(wf.workflowType),
		artifact: artifactLabel(wf.specPath),
		phaseName: wf.phaseName,
		roundLabel: wf.round ? `${wf.round.current}/${wf.round.max}` : null,
		status: wf.status,
		escalated: state.escalation !== null,
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
