import { useEffect, useState } from "react";
import type { GitCommitHistory } from "../../../shared/models/git-commit-review";
import { git } from "../../lib/desktop-client";
import type { ReviewLoadState } from "./review-load-state";

type Options = {
	workspaceId: string | null;
	worktreeId: string | null | undefined;
	refreshKey: number;
	selectedCommitSha: string | null | undefined;
	onClearStaleSelectedCommit: () => void;
};

/**
 * Load the recent commit history for the active worktree, preserving the
 * last successful result on transient failures and notifying the caller
 * when a previously-selected commit is no longer in the refreshed history.
 */
export function useCommitHistoryLoader(
	options: Options,
): ReviewLoadState<GitCommitHistory> {
	const {
		workspaceId,
		worktreeId,
		refreshKey,
		selectedCommitSha,
		onClearStaleSelectedCommit,
	} = options;

	const [state, setState] = useState<ReviewLoadState<GitCommitHistory>>({
		data: null,
		stale: false,
		message: null,
	});

	useEffect(() => {
		if (!worktreeId || !workspaceId) {
			setState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setState((prev) => ({ ...prev, message: null }));
		git
			.readCommitHistory(workspaceId, worktreeId)
			.then((history) => {
				if (cancelled) return;
				if (
					selectedCommitSha &&
					!history.entries.some((e) => e.sha === selectedCommitSha)
				) {
					onClearStaleSelectedCommit();
				}
				setState({ data: history, stale: false, message: null });
			})
			.catch(() => {
				if (cancelled) return;
				setState((prev) => ({
					...prev,
					stale: prev.data !== null,
					message:
						prev.data === null
							? "Couldn't load commit history."
							: "Couldn't refresh commit history. Showing last successful result.",
				}));
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
		// not depending on selectedCommitSha or onClearStaleSelectedCommit;
		// they are read at fetch-time only and should not retrigger the effect.
	}, [workspaceId, worktreeId, refreshKey]);

	return state;
}
