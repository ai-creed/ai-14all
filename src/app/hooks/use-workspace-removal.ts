import { useCallback, useState } from "react";
import type {
	AppWorkspacesAction,
	AppWorkspacesState,
} from "../../features/workspace/logic/app-workspaces-state";

type Options = {
	appWorkspaces: AppWorkspacesState;
	dispatchAppWorkspaces: (action: AppWorkspacesAction) => void;
	stopSession: (terminalSessionId: string) => Promise<void>;
};

export type PendingWorkspaceRemoval = {
	workspaceId: string;
	repositoryName: string;
	liveSessionCount: number;
	/** Terminal session ids that must be stopped before removing. */
	terminalSessionIds: string[];
};

/**
 * Removes a workspace from the registry. Dormant workspaces (no
 * `workspaceState`) or workspaces with no live terminals are removed inline.
 * When there are live terminals, surfaces `pendingRemoval` so the caller can
 * render a confirmation dialog; `confirmRemoval` then stops the terminals and
 * unregisters the workspace.
 */
export function useWorkspaceRemoval(options: Options): {
	handleRemoveWorkspace: (workspaceId: string) => void;
	pendingRemoval: PendingWorkspaceRemoval | null;
	confirmRemoval: () => Promise<void>;
	cancelRemoval: () => void;
} {
	const { appWorkspaces, dispatchAppWorkspaces, stopSession } = options;
	const [pendingRemoval, setPendingRemoval] =
		useState<PendingWorkspaceRemoval | null>(null);

	const handleRemoveWorkspace = useCallback(
		(workspaceId: string) => {
			const ws = appWorkspaces.workspacesById[workspaceId];
			if (!ws?.workspaceState) {
				dispatchAppWorkspaces({ type: "workspace/remove", workspaceId });
				return;
			}
			const liveSessions = Object.values(
				ws.workspaceState.processSessionsById,
			).filter((p) => p.status === "running" && p.terminalSessionId !== null);
			if (liveSessions.length === 0) {
				dispatchAppWorkspaces({ type: "workspace/remove", workspaceId });
				return;
			}
			setPendingRemoval({
				workspaceId,
				repositoryName: ws.repository.name,
				liveSessionCount: liveSessions.length,
				terminalSessionIds: liveSessions
					.map((p) => p.terminalSessionId)
					.filter((id): id is string => id !== null),
			});
		},
		[appWorkspaces, dispatchAppWorkspaces],
	);

	const confirmRemoval = useCallback(async () => {
		const pending = pendingRemoval;
		if (!pending) return;
		await Promise.all(pending.terminalSessionIds.map((id) => stopSession(id)));
		dispatchAppWorkspaces({
			type: "workspace/remove",
			workspaceId: pending.workspaceId,
		});
		setPendingRemoval(null);
	}, [pendingRemoval, stopSession, dispatchAppWorkspaces]);

	const cancelRemoval = useCallback(() => {
		setPendingRemoval(null);
	}, []);

	return {
		handleRemoveWorkspace,
		pendingRemoval,
		confirmRemoval,
		cancelRemoval,
	};
}
