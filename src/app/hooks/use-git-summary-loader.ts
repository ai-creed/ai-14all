import { useEffect } from "react";
import type { Dispatch } from "react";
import { git } from "../../lib/desktop-client";
import type { WorkspaceAction } from "../../features/workspace/logic/workspace-state";

type Options = {
	workspaceId: string | null;
	worktreeId: string | null | undefined;
	refreshKey: number;
	dispatch: Dispatch<WorkspaceAction>;
};

/**
 * Refresh the git summary cache for the active worktree whenever the worktree
 * changes or the explicit `refreshKey` advances. Reports outcomes through
 * dispatched workspace actions; the underlying state lives on the active
 * session.
 */
export function useGitSummaryLoader(options: Options): void {
	const { workspaceId, worktreeId, refreshKey, dispatch } = options;

	useEffect(() => {
		if (!worktreeId || !workspaceId) return;
		let cancelled = false;

		dispatch({
			type: "session/startGitSummaryRefresh",
			worktreeId,
		});

		git
			.readSummary(workspaceId, worktreeId)
			.then((summary) => {
				if (cancelled) return;
				dispatch({
					type: "session/cacheGitSummarySuccess",
					worktreeId,
					gitSummary: summary,
				});
			})
			.catch((err) => {
				if (cancelled) return;
				dispatch({
					type: "session/cacheGitSummaryFailure",
					worktreeId,
					message: err instanceof Error ? err.message : String(err),
				});
			});

		return () => {
			cancelled = true;
		};
	}, [workspaceId, worktreeId, refreshKey, dispatch]);
}
