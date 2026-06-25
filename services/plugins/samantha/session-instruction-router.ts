import type { AgentAttentionState } from "../../../shared/models/agent-attention";
import type { SamanthaSessionSlice } from "../../../shared/contracts/plugins";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";

export type AgentTarget = "claude" | "codex" | "ezio";

const AGENT_TARGETS: readonly AgentTarget[] = ["claude", "codex", "ezio"];

export type TargetSessionState =
	| {
			kind: "managed";
			workflowStatus: string;
			escalated: boolean;
			workflowId: string;
			target: AgentTarget | null;
	  }
	| { kind: "unmanaged"; attention: AgentAttentionState; sessionId: string }
	| { kind: "absent" };

export type RouteDecision =
	| { kind: "collab-tell"; target: AgentTarget; instruction: string }
	| { kind: "workflow-resume"; workflowId: string; message: string }
	| { kind: "send-input"; sessionId: string; data: string }
	| { kind: "reject"; code: "no-live-agent" | "session-busy"; reason: string };

function isAgentTarget(value: string | null): value is AgentTarget {
	return value !== null && (AGENT_TARGETS as readonly string[]).includes(value);
}

/**
 * Pick the collab-tell target for a managed worktree: prefer the session
 * slice's provider, else the first bound agent binding. `null` when neither
 * resolves to a real agent (claude/codex/ezio).
 */
function deriveTarget(
	whisper: WhisperWorktreeState,
	slice: SamanthaSessionSlice | null,
): AgentTarget | null {
	const provider = slice?.worktrees.find(
		(w) => w.worktreeId === whisper.worktreeId,
	)?.provider;
	if (isAgentTarget(provider ?? null)) return provider as AgentTarget;
	const bound = whisper.bindings.find(
		(b) => b.bindingState === "bound" && isAgentTarget(b.agentType),
	);
	return bound ? (bound.agentType as AgentTarget) : null;
}

export function buildTargetSessionState(
	worktreeId: string,
	whisperStates: WhisperWorktreeState[],
	session: SamanthaSessionSlice | null,
): TargetSessionState {
	const whisper = whisperStates.find((w) => w.worktreeId === worktreeId);
	if (whisper && whisper.daemonAlive && whisper.workflow !== null) {
		return {
			kind: "managed",
			workflowStatus: whisper.workflow.status,
			escalated: whisper.escalation !== null,
			workflowId: whisper.workflow.workflowId,
			target: deriveTarget(whisper, session),
		};
	}
	const slice = session?.worktrees.find((w) => w.worktreeId === worktreeId);
	const sessionId: string | null = slice?.sessionId ?? null;
	if (slice && sessionId !== null)
		return { kind: "unmanaged", attention: slice.attention, sessionId };
	return { kind: "absent" };
}

const SAFE_UNMANAGED: ReadonlySet<AgentAttentionState> = new Set([
	"idle",
	"waiting",
	"ready",
]);

export function routeInstruction(input: {
	instruction: string;
	state: TargetSessionState;
}): RouteDecision {
	const { instruction, state } = input;
	if (state.kind === "absent")
		return {
			kind: "reject",
			code: "no-live-agent",
			reason: "no live session to instruct",
		};

	if (state.kind === "unmanaged") {
		if (SAFE_UNMANAGED.has(state.attention))
			return {
				kind: "send-input",
				sessionId: state.sessionId,
				data: instruction,
			};
		return {
			kind: "reject",
			code: "session-busy",
			reason: `agent is ${state.attention}`,
		};
	}

	// managed: only a paused or escalated workflow is at a safe input point.
	if (state.workflowStatus === "paused")
		return {
			kind: "workflow-resume",
			workflowId: state.workflowId,
			message: instruction,
		};
	if (state.escalated) {
		if (state.target === null)
			return {
				kind: "reject",
				code: "session-busy",
				reason: "cannot determine target agent",
			};
		return { kind: "collab-tell", target: state.target, instruction };
	}
	return {
		kind: "reject",
		code: "session-busy",
		reason: `workflow is ${state.workflowStatus}; not awaiting input`,
	};
}
