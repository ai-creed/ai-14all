import type { WhisperAgentBinding } from "../../../../shared/models/ecosystem-plugin";

/** Matches whisper's 5-minute attach-claim expiry. */
export const START_COLLAB_TIMEOUT_MS = 5 * 60_000;

export type StartCollabPhase =
	| { kind: "idle" }
	| { kind: "waiting"; startedAt: number }
	| { kind: "ready" }
	| { kind: "timed-out" };

export function advanceStartCollab(
	phase: StartCollabPhase,
	bindings: WhisperAgentBinding[],
	now: number,
): StartCollabPhase {
	if (phase.kind !== "waiting") return phase;
	const boundCount = bindings.filter((b) => b.bindingState === "bound").length;
	if (boundCount >= 2) return { kind: "ready" };
	if (now - phase.startedAt > START_COLLAB_TIMEOUT_MS)
		return { kind: "timed-out" };
	return phase;
}
