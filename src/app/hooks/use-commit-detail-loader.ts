import { useEffect, useState } from "react";
import type { GitCommitDetail } from "../../../shared/models/git-commit-review";
import { git } from "../../lib/desktop-client";
import type { ReviewLoadState } from "./review-load-state";

type Options = {
	workspaceId: string | null;
	worktreeId: string | null | undefined;
	selectedCommitSha: string | null | undefined;
};

/**
 * Load detail for the currently selected commit, preserving the last
 * successful result for the same SHA on transient failures.
 */
export function useCommitDetailLoader(
	options: Options,
): ReviewLoadState<GitCommitDetail> {
	const { workspaceId, worktreeId, selectedCommitSha } = options;
	const [state, setState] = useState<ReviewLoadState<GitCommitDetail>>({
		data: null,
		stale: false,
		message: null,
	});

	useEffect(() => {
		if (!worktreeId || !workspaceId || !selectedCommitSha) {
			setState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setState((prev) => ({ ...prev, message: null }));
		git
			.readCommitDetail(workspaceId, worktreeId, selectedCommitSha)
			.then((detail) => {
				if (!cancelled) {
					setState({ data: detail, stale: false, message: null });
				}
			})
			.catch(() => {
				if (cancelled) return;
				const requestedSha = selectedCommitSha;
				setState((prev) => {
					const canPreserve =
						prev.data !== null && prev.data.sha === requestedSha;
					return {
						data: canPreserve ? prev.data : null,
						stale: canPreserve,
						message: canPreserve
							? "Couldn't refresh commit detail. Showing last successful result."
							: "Couldn't load commit detail.",
					};
				});
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, worktreeId, selectedCommitSha]);

	return state;
}
