import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { AgentResumeBridgeRequest } from "../../../shared/contracts/agent-resume-bridge";
import type { AppWorkspacesState } from "../../features/workspace/logic/app-workspaces-state";
import type { Ai14AllDesktopApi } from "../../../shared/contracts/commands";

type ResumeCommandAction = {
	type: "session/setResumeCommand";
	terminalSessionId: string;
	resumeCommand: string;
};

type Options = {
	appWorkspacesRef: MutableRefObject<AppWorkspacesState>;
	dispatchToWorkspace: (
		workspaceId: string,
		action: ResumeCommandAction,
	) => void;
};

/**
 * Renderer side of the agent conversation-resume bridge. When the main process
 * forwards a `register_agent_session` registration, find the workspace whose
 * `processSessionsById` owns the reported `terminalSessionId` (across ALL
 * workspaces, active or not), persist the resume command into that workspace,
 * and ack. Reply `no_terminal` when no process is bound to the terminal.
 *
 * Ready/goodbye are announced exactly like the agent-attention renderer bridge:
 * `sendAgentResumeReady` on mount, `sendAgentResumeGoodbye` on teardown, so the
 * main-process bridge only forwards while a renderer is listening.
 */
export function useAgentResumeBridge({
	appWorkspacesRef,
	dispatchToWorkspace,
}: Options): void {
	useEffect(() => {
		const events = (window.ai14all as Ai14AllDesktopApi | undefined)?.events;
		if (!events?.onAgentResumeRequest) return;
		const dispose = events.onAgentResumeRequest(
			(req: AgentResumeBridgeRequest) => {
				const state = appWorkspacesRef.current;
				for (const wsId of state.workspaceOrder) {
					const ws = state.workspacesById[wsId];
					const match = ws?.workspaceState
						? Object.values(ws.workspaceState.processSessionsById).find(
								(p) => p.terminalSessionId === req.terminalSessionId,
							)
						: undefined;
					if (match) {
						dispatchToWorkspace(wsId, {
							type: "session/setResumeCommand",
							terminalSessionId: req.terminalSessionId,
							resumeCommand: req.resumeCommand,
						});
						events.sendAgentResumeReply?.({ id: req.id, ok: true });
						return;
					}
				}
				events.sendAgentResumeReply?.({
					id: req.id,
					ok: false,
					error: "no_terminal",
					message: `no process session bound to terminal ${req.terminalSessionId}`,
				});
			},
		);
		events.sendAgentResumeReady?.();
		return () => {
			events.sendAgentResumeGoodbye?.();
			dispose();
		};
	}, [appWorkspacesRef, dispatchToWorkspace]);
}
