import type { ReviewComment } from "../../../../shared/models/review-comment";

type Props = {
	comment: ReviewComment;
	onScrollTo: (range: { startLine: number; endLine: number }) => void;
	onToggleAddressed: (commentId: string) => void;
	onDelete: (commentId: string) => void;
};

export function ReviewCommentCard({
	comment,
	onScrollTo,
	onToggleAddressed,
	onDelete,
}: Props) {
	const range = `L${comment.startLine}–${comment.endLine}`;
	return (
		<article className="shell-review-comment-card" data-status={comment.status}>
			<header className="shell-review-comment-card__header">
				<button
					type="button"
					className="shell-review-comment-card__range"
					onClick={() =>
						onScrollTo({
							startLine: comment.startLine,
							endLine: comment.endLine,
						})
					}
				>
					{range}
				</button>
				<span className="shell-review-comment-card__status">
					{comment.status}
				</span>
				<div className="shell-review-comment-card__actions">
					<button
						type="button"
						className="shell-review-comment-card__action"
						aria-label={comment.status === "open" ? "mark addressed" : "reopen"}
						title={
							comment.status === "open" ? "Mark as addressed" : "Reopen comment"
						}
						onClick={() => onToggleAddressed(comment.id)}
					>
						{comment.status === "open" ? "✓" : "↺"}
					</button>
					<button
						type="button"
						className="shell-review-comment-card__action"
						aria-label="delete comment"
						title="Delete comment"
						onClick={() => onDelete(comment.id)}
					>
						✕
					</button>
				</div>
			</header>
			<p className="shell-review-comment-card__body">{comment.body}</p>
		</article>
	);
}
