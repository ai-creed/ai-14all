import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PersistedWorktreeSession } from "../../../shared/models/persisted-workspace-state";
import type { Worktree } from "../../../shared/models/worktree";
import type {
	WorkspaceAction,
	WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import type { AppWorkspacesState } from "../../features/workspace/logic/app-workspaces-state";
import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";
import { logBindingChange } from "../logging/log-binding-change";

type TargetContext = {
	workspaceId: string;
	worktrees: Worktree[];
	workspaceState: WorkspaceState;
};

type Options = {
	activeWorkspaceId: string | null;
	worktrees: Worktree[];
	workspaceState: WorkspaceState;
	appWorkspacesRef: MutableRefObject<AppWorkspacesState>;
	activeWorkspaceStateRef: MutableRefObject<WorkspaceState>;
	pendingRestoreSessions: Record<string, PersistedWorktreeSession>;
	setPendingRestoreSessions: Dispatch<
		SetStateAction<Record<string, PersistedWorktreeSession>>
	>;
	dispatch: (action: WorkspaceAction) => void;
	activateWorkspace: (workspaceId: string) => Promise<TargetContext | null>;
	recreatePersistedProcesses: (
		worktree: Worktree,
		sessionSnapshot: PersistedWorktreeSession,
		targetWorkspaceId: string,
	) => Promise<void>;
};

export type UseWorktreeSelection = {
	handleSelectWorktree: (
		worktreeId: string,
		targetContext?: TargetContext,
	) => Promise<void>;
	handleSelectSidebarWorktree: (
		workspaceId: string,
		worktreeId: string,
	) => Promise<void>;
};

/**
 * Worktree-selection handlers. Two entry points:
 *
 * - `handleSelectWorktree` switches the selected worktree within a (possibly
 *   non-active) workspace, applying any pending session restore and emitting
 *   binding-change telemetry.
 * - `handleSelectSidebarWorktree` is the sidebar wrapper that first activates
 *   the target workspace if the user crossed a workspace boundary, then
 *   delegates to `handleSelectWorktree`.
 */
export function useWorktreeSelection(options: Options): UseWorktreeSelection {
	const {
		activeWorkspaceId,
		worktrees,
		workspaceState,
		appWorkspacesRef,
		activeWorkspaceStateRef,
		pendingRestoreSessions,
		setPendingRestoreSessions,
		dispatch,
		activateWorkspace,
		recreatePersistedProcesses,
	} = options;

	const handleSelectWorktree = useCallback(
		async (worktreeId: string, targetContext?: TargetContext) => {
			const targetWorkspaceId = targetContext?.workspaceId ?? activeWorkspaceId;
			if (!targetWorkspaceId) return;
			const targetWorktrees = targetContext?.worktrees ?? worktrees;
			const targetWorkspaceState =
				targetContext?.workspaceState ?? workspaceState;

			void logRendererShellEvent({
				event: "worktree-select",
				windowId: null,
				reasonKind: "user_action",
				reason: "worktree_switch",
				data: {
					activeWorkspaceId: targetWorkspaceId,
					previousWorktreeId:
						activeWorkspaceStateRef.current.selectedWorktreeId,
					nextWorktreeId: worktreeId,
				},
			});
			void logBindingChange({
				reasonKind: "user_action",
				reason: "worktree_switch",
				isExpected: true,
				expectedBecause: "user_explicit_worktree_select",
				previousBinding: {
					workspaceId: targetWorkspaceId,
					worktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
				},
				nextBinding: { workspaceId: targetWorkspaceId, worktreeId },
			});

			const pending = pendingRestoreSessions[worktreeId];
			if (pending) {
				dispatch({
					type: "session/restoreSnapshot",
					workspaceId: targetWorkspaceId,
					snapshot: pending,
				});
				setPendingRestoreSessions((prev) => {
					const next = { ...prev };
					delete next[worktreeId];
					return next;
				});
			}

			dispatch({ type: "session/selectWorktree", worktreeId });
			if (pending?.activeProcessSessionId) {
				dispatch({
					type: "session/markProcessViewed",
					worktreeId,
					processId: pending.activeProcessSessionId,
				});
				dispatch({
					type: "session/clearProcessAgentAttention",
					worktreeId,
					processId: pending.activeProcessSessionId,
					sticky: false,
					clearedAt: Date.now(),
				});
			} else {
				// workspaceState is the pre-dispatch snapshot from this render's
				// closure; reading activeProcessSessionId from it is correct here
				// because the preceding session/selectWorktree dispatch is batched
				// by React and has not yet been applied to workspaceState. For
				// non-pending sessions the data we need already existed before the
				// dispatch, so the stale read is safe.
				const session = targetWorkspaceState.sessionsByWorktreeId[worktreeId];
				if (session?.activeProcessSessionId) {
					dispatch({
						type: "session/markProcessViewed",
						worktreeId,
						processId: session.activeProcessSessionId,
					});
					dispatch({
						type: "session/clearProcessAgentAttention",
						worktreeId,
						processId: session.activeProcessSessionId,
						sticky: false,
						clearedAt: Date.now(),
					});
				}
				// clear session-level mcp attention if present
				const sessionReasons =
					targetWorkspaceState.sessionsByWorktreeId[worktreeId]?.agentAttentionReasons ?? {};
				if (sessionReasons.mcp != null) {
					dispatch({
						type: "session/clearSessionAgentAttention",
						worktreeId,
					});
				}
			}

			if (pending) {
				const worktree = targetWorktrees.find(
					(entry) => entry.id === worktreeId,
				);
				if (worktree) {
					await recreatePersistedProcesses(
						worktree,
						pending,
						targetWorkspaceId,
					);
				}
			}
		},
		[
			activeWorkspaceId,
			worktrees,
			workspaceState,
			activeWorkspaceStateRef,
			pendingRestoreSessions,
			setPendingRestoreSessions,
			dispatch,
			recreatePersistedProcesses,
		],
	);

	const handleSelectSidebarWorktree = useCallback(
		async (workspaceId: string, worktreeId: string) => {
			const isCrossWorkspace =
				workspaceId !== appWorkspacesRef.current.activeWorkspaceId;
			if (isCrossWorkspace) {
				void logRendererShellEvent({
					event: "workspace-select",
					windowId: null,
					reasonKind: "user_action",
					reason: "workspace_switch",
					data: {
						activeWorkspaceId: appWorkspacesRef.current.activeWorkspaceId,
						nextWorkspaceId: workspaceId,
					},
				});
				void logBindingChange({
					reasonKind: "user_action",
					reason: "workspace_switch",
					isExpected: true,
					expectedBecause: "user_explicit_workspace_select",
					previousBinding: {
						workspaceId: appWorkspacesRef.current.activeWorkspaceId,
						worktreeId: activeWorkspaceStateRef.current.selectedWorktreeId,
					},
					nextBinding: { workspaceId, worktreeId },
				});
			}
			const targetContext =
				workspaceId === appWorkspacesRef.current.activeWorkspaceId
					? {
							workspaceId,
							worktrees,
							workspaceState,
						}
					: await activateWorkspace(workspaceId);
			if (!targetContext) return;
			await handleSelectWorktree(worktreeId, targetContext);
		},
		[
			appWorkspacesRef,
			activeWorkspaceStateRef,
			worktrees,
			workspaceState,
			activateWorkspace,
			handleSelectWorktree,
		],
	);

	return { handleSelectWorktree, handleSelectSidebarWorktree };
}
