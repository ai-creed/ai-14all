import { useEffect, useState } from "react";
import type { GitChange } from "../../../shared/models/git-change";
import type { GitDiff } from "../../../shared/models/git-diff";
import { git } from "../../lib/desktop-client";
import type { ReviewLoadState } from "./review-load-state";

type Options = {
	workspaceId: string | null;
	worktreeId: string | null | undefined;
	selectedChangedFilePath: string | null | undefined;
	changes: GitChange[];
};

/**
 * Load the git diff for the currently selected changed file, preserving the
 * last successful result on transient failures so the renderer can keep the
 * previous diff visible.
 */
export function useDiffLoader(options: Options): ReviewLoadState<GitDiff> {
	const { workspaceId, worktreeId, selectedChangedFilePath, changes } = options;
	const [diffState, setDiffState] = useState<ReviewLoadState<GitDiff>>({
		data: null,
		stale: false,
		message: null,
	});

	useEffect(() => {
		if (!worktreeId || !workspaceId || !selectedChangedFilePath) {
			setDiffState({ data: null, stale: false, message: null });
			return;
		}
		if (!changes.some((change) => change.path === selectedChangedFilePath)) {
			setDiffState({ data: null, stale: false, message: null });
			return;
		}
		let cancelled = false;
		setDiffState((prev) => ({ ...prev, message: null }));
		git
			.readDiff(workspaceId, worktreeId, selectedChangedFilePath)
			.then((result) => {
				if (!cancelled) {
					setDiffState({ data: result, stale: false, message: null });
				}
			})
			.catch(() => {
				if (cancelled) return;
				const requestedPath = selectedChangedFilePath;
				setDiffState((prev) => {
					const canPreserve =
						prev.data !== null && prev.data.path === requestedPath;
					return {
						data: canPreserve ? prev.data : null,
						stale: canPreserve,
						message: canPreserve
							? "Couldn't refresh diff. Showing last successful result."
							: "Couldn't load diff.",
					};
				});
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, worktreeId, selectedChangedFilePath, changes]);

	return diffState;
}
