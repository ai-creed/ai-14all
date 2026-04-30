import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type {
	CreateWorktreePreview,
	RemoveWorktreePreview,
} from "../../../shared/models/worktree-lifecycle";
import { repository as repositoryClient } from "../../lib/desktop-client";
import type {
	WorkspaceAction,
	WorkspaceState,
} from "../../features/workspace/logic/workspace-state";

type Options = {
	workspaceId: string | null;
	workspaceStateRef: MutableRefObject<WorkspaceState>;

	// Create-worktree state + setters
	createPreview: CreateWorktreePreview | null;
	createName: string;
	createSessionTitle: string;
	setCreateBusy: (busy: boolean) => void;
	setCreateDialogOpen: (open: boolean) => void;
	setCreateName: (next: string) => void;
	setCreateSessionTitle: (next: string) => void;
	setCreatePreview: (next: CreateWorktreePreview | null) => void;
	setCreateError: (next: string | null) => void;

	// Remove-worktree state + setters
	removePreview: RemoveWorktreePreview | null;
	setRemoveBusy: (busy: boolean) => void;
	setRemoveDialogOpen: (open: boolean) => void;
	setRemoveTargetId: (id: string | null) => void;
	setRemovePreview: (next: RemoveWorktreePreview | null) => void;
	setRemoveError: (next: string | null) => void;

	// Dependencies on other action surfaces
	dispatch: (action: WorkspaceAction) => void;
	stopSession: (sessionId: string) => Promise<void>;
	removeSession: (sessionId: string) => void;
	forgetDefaultShellEnsuredForWorktree: (worktreeId: string) => void;
	refreshWorktreeInventory: (options?: {
		preferredSelectedWorktreeId?: string | null;
		skipRuntimeCleanupWorktreeIds?: string[];
	}) => Promise<void>;
};

export type UseWorktreeActions = {
	handleConfirmCreateWorktree: () => Promise<void>;
	handleConfirmRemoveWorktree: () => Promise<void>;
	closeProcessesForWorktree: (worktreeId: string) => Promise<void>;
};

/**
 * Bundle of worktree-lifecycle handlers (create + remove + child-process
 * cleanup). Drives both dialogs end-to-end including state reset on success.
 */
export function useWorktreeActions(options: Options): UseWorktreeActions {
	const {
		workspaceId,
		workspaceStateRef,
		createPreview,
		createName,
		createSessionTitle,
		setCreateBusy,
		setCreateDialogOpen,
		setCreateName,
		setCreateSessionTitle,
		setCreatePreview,
		setCreateError,
		removePreview,
		setRemoveBusy,
		setRemoveDialogOpen,
		setRemoveTargetId,
		setRemovePreview,
		setRemoveError,
		dispatch,
		stopSession,
		removeSession,
		forgetDefaultShellEnsuredForWorktree,
		refreshWorktreeInventory,
	} = options;

	const closeProcessesForWorktree = useCallback(
		async (worktreeId: string) => {
			const session =
				workspaceStateRef.current.sessionsByWorktreeId[worktreeId];
			if (!session) return;
			for (const processId of session.processSessionIds) {
				const process =
					workspaceStateRef.current.processSessionsById[processId];
				if (process?.terminalSessionId) {
					try {
						await stopSession(process.terminalSessionId);
					} catch {
						// Removal is already confirmed; continue clearing renderer state.
					}
					removeSession(process.terminalSessionId);
				}
				dispatch({ type: "session/closeProcess", worktreeId, processId });
			}
			// Clear the guard so a future worktree reusing the same id (same path)
			// gets a fresh default shell instead of being skipped because the id
			// is still in the Set from the removed worktree's first visit.
			forgetDefaultShellEnsuredForWorktree(worktreeId);
		},
		[
			workspaceStateRef,
			dispatch,
			stopSession,
			removeSession,
			forgetDefaultShellEnsuredForWorktree,
		],
	);

	const handleConfirmCreateWorktree = useCallback(async () => {
		if (!createPreview || !workspaceId) return;
		setCreateBusy(true);
		try {
			const created = await repositoryClient.createWorktree(
				workspaceId,
				createName,
			);
			if (createSessionTitle.trim()) {
				dispatch({
					type: "session/setTitle",
					worktreeId: created.id,
					title: createSessionTitle,
				});
			}
			await refreshWorktreeInventory({
				preferredSelectedWorktreeId: created.id,
			});
			setCreateDialogOpen(false);
			setCreateName("");
			setCreateSessionTitle("");
			setCreatePreview(null);
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : String(err));
			await refreshWorktreeInventory();
		} finally {
			setCreateBusy(false);
		}
	}, [
		createPreview,
		workspaceId,
		createName,
		createSessionTitle,
		dispatch,
		refreshWorktreeInventory,
		setCreateBusy,
		setCreateDialogOpen,
		setCreateName,
		setCreateSessionTitle,
		setCreatePreview,
		setCreateError,
	]);

	const handleConfirmRemoveWorktree = useCallback(async () => {
		if (!removePreview || !workspaceId) return;
		setRemoveBusy(true);
		try {
			await closeProcessesForWorktree(removePreview.worktreeId);
			await repositoryClient.removeWorktree(
				workspaceId,
				removePreview.worktreeId,
			);
			await refreshWorktreeInventory({
				skipRuntimeCleanupWorktreeIds: [removePreview.worktreeId],
			});
			setRemoveDialogOpen(false);
			setRemoveTargetId(null);
			setRemovePreview(null);
		} catch (err) {
			setRemoveError(err instanceof Error ? err.message : String(err));
			await refreshWorktreeInventory();
		} finally {
			setRemoveBusy(false);
		}
	}, [
		removePreview,
		workspaceId,
		closeProcessesForWorktree,
		refreshWorktreeInventory,
		setRemoveBusy,
		setRemoveDialogOpen,
		setRemoveTargetId,
		setRemovePreview,
		setRemoveError,
	]);

	return {
		handleConfirmCreateWorktree,
		handleConfirmRemoveWorktree,
		closeProcessesForWorktree,
	};
}
