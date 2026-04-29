import { useCallback } from "react";
import type {
	AppWorkspacesAction,
	AppWorkspacesState,
} from "../../features/workspace/logic/app-workspaces-state";

type Options = {
	appWorkspaces: AppWorkspacesState;
	dispatchAppWorkspaces: (action: AppWorkspacesAction) => void;
	stopSession: (terminalSessionId: string) => Promise<void>;
};

/**
 * Removes a workspace from the registry. If the workspace has live terminal
 * sessions, asks the user to confirm and stops them before unregistering.
 * Dormant workspaces (no `workspaceState`) are removed without confirmation
 * because they own no live processes.
 */
export function useWorkspaceRemoval(options: Options): {
	handleRemoveWorkspace: (workspaceId: string) => Promise<void>;
} {
	const { appWorkspaces, dispatchAppWorkspaces, stopSession } = options;

	const handleRemoveWorkspace = useCallback(
		async (workspaceId: string) => {
			const ws = appWorkspaces.workspacesById[workspaceId];
			if (!ws?.workspaceState) {
				dispatchAppWorkspaces({ type: "workspace/remove", workspaceId });
				return;
			}
			const liveSessions = Object.values(
				ws.workspaceState.processSessionsById,
			).filter((p) => p.status === "running" && p.terminalSessionId !== null);
			if (liveSessions.length > 0) {
				const confirmed = window.confirm(
					`"${ws.repository.name}" has ${liveSessions.length} active terminal(s). Remove it and stop all running terminals?`,
				);
				if (!confirmed) return;
				await Promise.all(
					liveSessions.flatMap((p) =>
						p.terminalSessionId ? [stopSession(p.terminalSessionId)] : [],
					),
				);
			}
			dispatchAppWorkspaces({ type: "workspace/remove", workspaceId });
		},
		[appWorkspaces, dispatchAppWorkspaces, stopSession],
	);

	return { handleRemoveWorkspace };
}
