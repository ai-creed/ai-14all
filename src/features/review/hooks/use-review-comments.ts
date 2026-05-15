import { useCallback, useEffect, useState } from "react";
import { reviewComments } from "../../../lib/desktop-client";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import type { ReviewCreateRequest } from "../../../../shared/contracts/review-comments";

export function useReviewComments(worktreeId: string | null) {
	const [comments, setComments] = useState<ReviewComment[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!worktreeId) {
			setComments([]);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const { comments } = await reviewComments.list(worktreeId);
			setComments(comments);
		} catch (e) {
			setError((e as Error).message ?? "failed to load review comments");
		} finally {
			setLoading(false);
		}
	}, [worktreeId]);

	useEffect(() => {
		void refresh();
		const off = reviewComments.onChanged(() => {
			void refresh();
		});
		return off;
	}, [refresh]);

	const create = useCallback(
		(input: Omit<ReviewCreateRequest, "worktreeId">) => {
			if (!worktreeId) throw new Error("no worktree selected");
			return reviewComments.create({ ...input, worktreeId });
		},
		[worktreeId],
	);

	const markAddressed = useCallback(
		(commentId: string) => reviewComments.markAddressed(commentId),
		[],
	);
	const reopen = useCallback(
		(commentId: string) => reviewComments.reopen(commentId),
		[],
	);
	const remove = useCallback(
		(commentId: string) => reviewComments.delete(commentId),
		[],
	);

	const update = useCallback(
		(commentId: string, body: string) => reviewComments.update(commentId, body),
		[],
	);

	const clearAddressed = useCallback(() => {
		if (!worktreeId) return Promise.resolve({ ok: true as const, removed: 0 });
		const ids = comments
			.filter((c) => c.status === "addressed")
			.map((c) => c.id);
		return reviewComments.bulkRemoveAddressed(worktreeId, ids);
	}, [worktreeId, comments]);

	return {
		comments,
		loading,
		error,
		refresh,
		create,
		markAddressed,
		reopen,
		remove,
		update,
		clearAddressed,
	};
}
