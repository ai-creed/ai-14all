import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PersistedWorktreeSession } from "../../../shared/models/persisted-workspace-state";
import type { Worktree } from "../../../shared/models/worktree";
import type { PendingRestoreEntry } from "../../features/workspace/logic/workspace-persistence";
import type {
	WorkspaceAction,
	WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import type { AppWorkspacesState } from "../../features/workspace/logic/app-workspaces-state";
import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";
import {
	hasInlineEditorsRegistered,
	runInlineEditorDirtyGate,
} from "../../features/viewer/inline-editor-registry";
import { logBindingChange } from "../logging/log-binding-change";
import type { AgentResumeMode } from "../../../shared/models/persisted-settings";

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
	pendingRestoreSessions: Record<string, PendingRestoreEntry>;
	setPendingRestoreSessions: Dispatch<
		SetStateAction<Record<string, PendingRestoreEntry>>
	>;
	dispatch: (action: WorkspaceAction) => void;
	activateWorkspace: (workspaceId: string) => Promise<TargetContext | null>;
	recreatePersistedProcesses: (
		worktree: Worktree,
		sessionSnapshot: PersistedWorktreeSession,
		targetWorkspaceId: string,
		agentResume: AgentResumeMode,
	) => Promise<void>;
	// Task 13: threaded from useSettings().settings.agentResume, the same value
	// passed at every recreatePersistedProcesses call site (see
	// use-workspace-lifecycle.ts's Options for the other three sites).
	agentResume: AgentResumeMode;
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
		agentResume,
	} = options;

	const handleSelectWorktree = useCallback(
		async (worktreeId: string, targetContext?: TargetContext) => {
			const targetWorkspaceId = targetContext?.workspaceId ?? activeWorkspaceId;
			if (!targetWorkspaceId) return;
			const targetWorktrees = targetContext?.worktrees ?? worktrees;
			const targetWorkspaceState =
				targetContext?.workspaceState ?? workspaceState;

			// Dirty inline editors must be resolved before unmounting them. The
			// gate drives the per-editor Save/Discard/Cancel dialog and short-
			// circuits the switch when the user cancels. Only await when an
			// editor is actually mounted — otherwise an unconditional await
			// would break React's synchronous event-handler batching and cause
			// dependent effects (poll-on-worktree-change) to fire an extra time.
			if (hasInlineEditorsRegistered()) {
				const gate = await runInlineEditorDirtyGate();
				if (gate === "cancel") return;
			}

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

			// The pending map value is tagged with its owning workspace id, but the
			// fire path always dispatches through the GLOBAL `dispatch`, which routes
			// to the active workspace. That is correct because visiting a worktree in
			// a non-active (e.g. background-hydrated inactiveLive) workspace always
			// goes through handleSelectSidebarWorktree, which calls activateWorkspace
			// FIRST (making the target active) before delegating here — so by the time
			// a pending session fires, its owning workspace IS the active one.
			const pending = pendingRestoreSessions[worktreeId]?.session;
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
			}
			// clear session-level mcp attention if present — runs regardless of
			// whether there was a pending restore
			if (
				targetWorkspaceState.sessionsByWorktreeId[worktreeId]
					?.agentAttentionReasons?.mcp != null
			) {
				dispatch({
					type: "session/clearSessionAgentAttention",
					worktreeId,
				});
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
						agentResume,
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
			agentResume,
		],
	);

	const handleSelectSidebarWorktree = useCallback(
		async (workspaceId: string, worktreeId: string) => {
			const isCrossWorkspace =
				workspaceId !== appWorkspacesRef.current.activeWorkspaceId;
			// Run the dirty gate BEFORE activateWorkspace so a dirty editor in
			// the outgoing workspace cannot be unmounted (and thus unregistered)
			// before the user has confirmed Save/Discard/Cancel. Same-workspace
			// switches still hit handleSelectWorktree's gate below; this is the
			// extra cross-workspace guard.
			if (isCrossWorkspace && hasInlineEditorsRegistered()) {
				const gate = await runInlineEditorDirtyGate();
				if (gate === "cancel") return;
			}
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
