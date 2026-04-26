import type { ReviewComment } from "../../../shared/models/review-comment";
import { ReviewCommentCard } from "./ReviewCommentCard";
import { ReviewCommentForm } from "./ReviewCommentForm";

export type NewCommentDraft = {
	filePath: string;
	startLine: number;
	endLine: number;
	snippet: string;
};

type Props = {
	filePath: string | null;
	comments: ReviewComment[];
	addingForFile: NewCommentDraft | null;
	onScrollTo: (range: { startLine: number; endLine: number }) => void;
	onToggleAddressed: (commentId: string) => void;
	onDelete: (commentId: string) => void;
	onSubmitNew: (draft: NewCommentDraft, body: string) => void;
	onCancelNew: () => void;
};

export function ReviewCommentSidebar({
	filePath,
	comments,
	addingForFile,
	onScrollTo,
	onToggleAddressed,
	onDelete,
	onSubmitNew,
	onCancelNew,
}: Props) {
	const fileComments = filePath
		? comments
				.filter((c) => c.filePath === filePath)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		: [];
	const openCount = fileComments.filter((c) => c.status === "open").length;

	return (
		<aside className="shell-review-comment-sidebar" data-testid="review-comment-sidebar">
			<header className="shell-review-comment-sidebar__header">
				<span className="shell-label">
					Comments — {filePath ?? "—"} ({openCount})
				</span>
			</header>
			<div className="shell-review-comment-sidebar__list">
				{addingForFile && addingForFile.filePath === filePath && (
					<ReviewCommentForm
						onSave={(body) => onSubmitNew(addingForFile, body)}
						onCancel={onCancelNew}
					/>
				)}
				{fileComments.length === 0 && !addingForFile ? (
					<p className="shell-empty-state">
						No review comments. Hover a line in the diff to add one.
					</p>
				) : (
					fileComments.map((c) => (
						<ReviewCommentCard
							key={c.id}
							comment={c}
							onScrollTo={onScrollTo}
							onToggleAddressed={onToggleAddressed}
							onDelete={onDelete}
						/>
					))
				)}
			</div>
		</aside>
	);
}
