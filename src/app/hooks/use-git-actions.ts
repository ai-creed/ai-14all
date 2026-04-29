import { useCallback } from "react";
import { git } from "../../lib/desktop-client";

type Options = {
	workspaceId: string | null;
	worktreeId: string | null | undefined;
	discardPath: string | null;
	refreshWorktreeInventory: () => Promise<void>;
	bumpRefreshKey: () => void;
};

export type UseGitActions = {
	handleRefreshChanges: () => Promise<void>;
	handleDiscardChange: () => Promise<void>;
	handlePushBranch: (force: boolean) => Promise<void>;
};

/**
 * Bundle of git-related action handlers wired against the active worktree.
 * Each handler bumps the refresh key on success so loaders re-run.
 */
export function useGitActions(options: Options): UseGitActions {
	const {
		workspaceId,
		worktreeId,
		discardPath,
		refreshWorktreeInventory,
		bumpRefreshKey,
	} = options;

	const handleRefreshChanges = useCallback(async () => {
		await refreshWorktreeInventory();
		bumpRefreshKey();
	}, [refreshWorktreeInventory, bumpRefreshKey]);

	const handleDiscardChange = useCallback(async () => {
		if (!worktreeId || !workspaceId || !discardPath) return;
		await git.discardChange(workspaceId, worktreeId, discardPath);
		bumpRefreshKey();
	}, [workspaceId, worktreeId, discardPath, bumpRefreshKey]);

	const handlePushBranch = useCallback(
		async (force: boolean) => {
			if (!worktreeId || !workspaceId) return;
			await git.pushBranch(workspaceId, worktreeId, force);
			bumpRefreshKey();
		},
		[workspaceId, worktreeId, bumpRefreshKey],
	);

	return { handleRefreshChanges, handleDiscardChange, handlePushBranch };
}
