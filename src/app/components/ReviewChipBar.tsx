import type { ReviewMode } from "../../../shared/models/worktree-session";
import { ReviewBarButton } from "../../features/review/components/ReviewBarButton";

type Props = {
	isDirty: boolean;
	changedFileCount: number;
	reviewMode: ReviewMode;
	openCommentCount: number;
	addressedCommentCount: number;
	/** True only when the worktree is dirty AND a non-deleted change exists. */
	canOpenFiles: boolean;
	onRefresh: () => void;
	onOpen: () => void;
	onOpenFiles: () => void;
	onOpenComments: () => void;
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
	canOpenFiles,
	onRefresh,
	onOpen,
	onOpenFiles,
	onOpenComments,
}: Props): React.ReactElement {
	const hasComments = openCommentCount > 0 || addressedCommentCount > 0;
	return (
		<div className="shell-review-chipbar" data-testid="review-chipbar">
			<span className="shell-review-chipbar__label">REVIEW</span>
			<span className="shell-review-chipbar__mode">
				{MODE_LABEL[reviewMode]}
			</span>
			{isDirty ? (
				canOpenFiles ? (
					<button
						type="button"
						className="shell-review-chipbar__status shell-review-chipbar__status--action"
						data-state="dirty"
						data-testid="review-chipbar-files"
						title="Open changed files"
						onClick={onOpenFiles}
					>
						{changedFileCount} changed
					</button>
				) : (
					<span className="shell-review-chipbar__status" data-state="dirty">
						{changedFileCount} changed
					</span>
				)
			) : (
				<span className="shell-review-chipbar__status" data-state="clean">
					✓ clean
				</span>
			)}
			{hasComments && (
				<span className="shell-review-chipbar__comments">
					{openCommentCount > 0 && (
						<button
							type="button"
							className="shell-review-chipbar__open shell-review-chipbar__open--action"
							data-testid="review-chipbar-comments"
							title="Go to first open comment"
							onClick={onOpenComments}
						>
							{openCommentCount} open
						</button>
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
			<ReviewBarButton
				icon="↻"
				label="Refresh"
				ariaLabel="Refresh review"
				title="Refresh review"
				onClick={onRefresh}
			/>
			<ReviewBarButton
				icon="⬆"
				label="Review"
				ariaLabel="Open review"
				title="Open review"
				onClick={onOpen}
			/>
		</div>
	);
}
