import { useEffect, useState } from "react";
import type { CreateWorktreePreview } from "../../../shared/models/worktree-lifecycle";
import { repository as repositoryClient } from "../../lib/desktop-client";

const DEBOUNCE_MS = 350;

type Options = {
	open: boolean;
	name: string;
	workspaceId: string | null;
};

export type CreateWorktreePreviewState = {
	preview: CreateWorktreePreview | null;
	loading: boolean;
	error: string | null;
	setPreview: (next: CreateWorktreePreview | null) => void;
	setError: (next: string | null) => void;
};

/**
 * Debounce-load a `CreateWorktreePreview` while the create-worktree dialog is
 * open and the user types a name. Resets cleanly when the dialog closes.
 */
export function useCreateWorktreePreview(
	options: Options,
): CreateWorktreePreviewState {
	const { open, name, workspaceId } = options;
	const [preview, setPreview] = useState<CreateWorktreePreview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !name.trim() || !workspaceId) {
			setPreview(null);
			setError(null);
			return;
		}
		let cancelled = false;
		const timeoutId = window.setTimeout(() => {
			setLoading(true);
			repositoryClient
				.previewCreateWorktree(workspaceId, name)
				.then((next) => {
					if (cancelled) return;
					setPreview(next);
					setError(null);
				})
				.catch((err) => {
					if (cancelled) return;
					setPreview(null);
					setError(err instanceof Error ? err.message : String(err));
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
		}, DEBOUNCE_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [open, name, workspaceId]);

	return { preview, loading, error, setPreview, setError };
}
