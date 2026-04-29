import { useEffect, useState } from "react";
import type { RemoveWorktreePreview } from "../../../shared/models/worktree-lifecycle";
import { repository as repositoryClient } from "../../lib/desktop-client";

type Options = {
	open: boolean;
	worktreeId: string | null;
	workspaceId: string | null;
};

export type RemoveWorktreePreviewState = {
	preview: RemoveWorktreePreview | null;
	error: string | null;
	setPreview: (next: RemoveWorktreePreview | null) => void;
	setError: (next: string | null) => void;
};

/**
 * Load a `RemoveWorktreePreview` while the remove-worktree dialog is open
 * and a target worktree is selected. Resets cleanly when the dialog closes.
 */
export function useRemoveWorktreePreview(
	options: Options,
): RemoveWorktreePreviewState {
	const { open, worktreeId, workspaceId } = options;
	const [preview, setPreview] = useState<RemoveWorktreePreview | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !worktreeId || !workspaceId) {
			setPreview(null);
			setError(null);
			return;
		}
		let cancelled = false;
		repositoryClient
			.previewRemoveWorktree(workspaceId, worktreeId)
			.then((next) => {
				if (cancelled) return;
				setPreview(next);
				setError(null);
			})
			.catch((err) => {
				if (cancelled) return;
				setPreview(null);
				setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [open, worktreeId, workspaceId]);

	return { preview, error, setPreview, setError };
}
