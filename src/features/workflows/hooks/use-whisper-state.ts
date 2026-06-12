import { useEffect, useRef, useState } from "react";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";
import type { WorkspaceAction } from "../../workspace/logic/workspace-state";
import { diffWorkflowAttention } from "../logic/workflow-lens";

/**
 * Only the two session-level attention actions the lens ever dispatches. Routed
 * by `worktreeId` to the workspace that owns it (see App.tsx wiring). Narrowed
 * from the full `WorkspaceAction` union so callers can pass a per-worktree
 * router without widening their own type surface.
 */
export type WhisperAttentionDispatch = (
	action: Extract<
		WorkspaceAction,
		{
			type:
				| "session/reportAgentAttention"
				| "session/clearSessionAgentAttention";
		}
	>,
) => void;

/**
 * Renderer-side mirror of the whisper driver's per-worktree state pushes.
 *
 * Keeps the latest snapshot map for the lens to render and, on each push, diffs
 * the previous vs. next snapshot for every worktree into at most one attention
 * effect, dispatching it as a `workflow`-source session reason. Worktrees that
 * vanish from a push (or whose workflow finishes) get their workflow reason
 * cleared.
 *
 * Stale-data marker: when a worktree's reads transiently fail mid-daemon
 * (previously had a workflow, the new snapshot has `workflow: null` while
 * `daemonAlive` is still true), the last-known entry is retained with a
 * `stale: true` flag instead of blanking the lens — the next poll quietly
 * retries. The attention diff is NOT suppressed for this case: a genuine
 * workflow-finished also looks like `workflow: null`, and the diff handles both
 * correctly (the daemon-alive guard only governs what we render, not whether we
 * report).
 */
export function useWhisperState(options: {
	onWhisperStateChanged: (
		cb: (states: WhisperWorktreeState[]) => void,
	) => () => void;
	dispatch: WhisperAttentionDispatch;
	now?: () => number;
}): Map<string, WhisperWorktreeState & { stale?: boolean }> {
	const [states, setStates] = useState(
		() => new Map<string, WhisperWorktreeState & { stale?: boolean }>(),
	);
	const previous = useRef(new Map<string, WhisperWorktreeState>());
	useEffect(() => {
		const now = options.now ?? (() => Date.now());
		return options.onWhisperStateChanged((pushed) => {
			const next = new Map(pushed.map((s) => [s.worktreeId, s]));
			for (const [worktreeId, state] of next) {
				const effect = diffWorkflowAttention(
					previous.current.get(worktreeId),
					state,
					now(),
				);
				if (effect?.kind === "report") {
					options.dispatch({
						type: "session/reportAgentAttention",
						worktreeId,
						reason: effect.reason,
					});
				} else if (effect?.kind === "clear") {
					options.dispatch({
						type: "session/clearSessionAgentAttention",
						worktreeId,
						source: "workflow",
					});
				}
			}
			// Worktrees that vanished from the push: clear their workflow reason.
			for (const [worktreeId] of previous.current) {
				if (!next.has(worktreeId)) {
					options.dispatch({
						type: "session/clearSessionAgentAttention",
						worktreeId,
						source: "workflow",
					});
				}
			}
			// Build the rendered map, retaining a stale last-known row when reads
			// transiently failed (workflow went null while the daemon is still up).
			const rendered = new Map<
				string,
				WhisperWorktreeState & { stale?: boolean }
			>(next);
			for (const [worktreeId, state] of next) {
				const prior = previous.current.get(worktreeId);
				if (
					state.workflow === null &&
					state.daemonAlive &&
					prior &&
					prior.workflow !== null
				) {
					rendered.set(worktreeId, { ...prior, stale: true });
				}
			}
			previous.current = next;
			setStates(rendered);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return states;
}
