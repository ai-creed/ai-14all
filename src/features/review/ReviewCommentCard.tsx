import type { ReviewComment } from "../../../shared/models/review-comment";

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
		<article
			className="shell-review-comment-card"
			data-status={comment.status}
		>
			<header className="shell-review-comment-card__header">
				<button
					type="button"
					className="shell-review-comment-card__range"
					onClick={() =>
						onScrollTo({ startLine: comment.startLine, endLine: comment.endLine })
					}
				>
					{range}
				</button>
				<span className="shell-review-comment-card__status">
					{comment.status}
				</span>
			</header>
			<p className="shell-review-comment-card__body">{comment.body}</p>
			<footer className="shell-review-comment-card__footer">
				<button
					type="button"
					aria-label={
						comment.status === "open" ? "mark addressed" : "reopen"
					}
					onClick={() => onToggleAddressed(comment.id)}
				>
					{comment.status === "open" ? "✓" : "↺"}
				</button>
				<button
					type="button"
					aria-label="delete comment"
					onClick={() => onDelete(comment.id)}
				>
					⋯
				</button>
			</footer>
		</article>
	);
}
