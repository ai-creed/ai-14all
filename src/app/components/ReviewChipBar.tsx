import type { ReviewMode } from "../../../shared/models/worktree-session";

type Props = {
	isDirty: boolean;
	changedFileCount: number;
	reviewMode: ReviewMode;
	openCommentCount: number;
	addressedCommentCount: number;
	onRefresh: () => void;
	onOpen: () => void;
};

const MODE_LABEL: Record<ReviewMode, string> = {
	files: "Files",
	changes: "Changes",
	commits: "Commits",
};

export function ReviewChipBar({
	isDirty,
	changedFileCount,
	reviewMode,
	openCommentCount,
	addressedCommentCount,
	onRefresh,
	onOpen,
}: Props): React.ReactElement {
	const hasComments = openCommentCount > 0 || addressedCommentCount > 0;
	return (
		<div className="shell-review-chipbar" data-testid="review-chipbar">
			<span className="shell-review-chipbar__label">REVIEW</span>
			<span className="shell-review-chipbar__mode">{MODE_LABEL[reviewMode]}</span>
			{isDirty ? (
				<span className="shell-review-chipbar__status" data-state="dirty">
					{changedFileCount} changed
				</span>
			) : (
				<span className="shell-review-chipbar__status" data-state="clean">
					✓ clean
				</span>
			)}
			{hasComments && (
				<span className="shell-review-chipbar__comments">
					{openCommentCount > 0 && (
						<span className="shell-review-chipbar__open">{openCommentCount} open</span>
					)}
					{addressedCommentCount > 0 && (
						<span className="shell-review-chipbar__addressed">
							{openCommentCount > 0 ? " · " : ""}
							{addressedCommentCount} addressed
						</span>
					)}
				</span>
			)}
			<span className="shell-review-chipbar__spacer" />
			<button
				type="button"
				className="shell-button shell-button--compact shell-button--icon shell-button--round"
				aria-label="Refresh review"
				title="Refresh review"
				onClick={onRefresh}
			>
				<span aria-hidden="true">↻</span>
			</button>
			<button
				type="button"
				className="shell-review-chipbar__open-btn"
				aria-label="Open review"
				title="Open review"
				onClick={onOpen}
			>
				<span aria-hidden="true">⬆</span>
				<span>Review</span>
			</button>
		</div>
	);
}
