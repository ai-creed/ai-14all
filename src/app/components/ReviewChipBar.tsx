import type { ReviewMode } from "../../../shared/models/worktree-session";
import { ReviewBarButton } from "../../features/review/components/ReviewBarButton";
import { Icon } from "@/components/ui/icon";

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
}: Props): React.ReactElement {
	const hasComments = openCommentCount > 0 || addressedCommentCount > 0;
	return (
		<div
			className="shell-review-chipbar"
			data-testid="review-chipbar"
			data-tour="review-bar"
		>
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
					<Icon name="check" /> clean
				</span>
			)}
			{hasComments && (
				<span
					className="shell-review-chip__comments"
					data-testid="review-chipbar-comments"
					title={`${openCommentCount} unresolved of ${openCommentCount + addressedCommentCount} comments`}
					aria-label={`${openCommentCount} unresolved of ${openCommentCount + addressedCommentCount} comments`}
				>
					{openCommentCount}/{openCommentCount + addressedCommentCount}
				</span>
			)}
			<span className="shell-review-chipbar__spacer" />
			<ReviewBarButton
				icon="refresh"
				label="Refresh"
				ariaLabel="Refresh review"
				title="Refresh review"
				onClick={onRefresh}
			/>
			<ReviewBarButton
				icon="arrow-up"
				iconFallback="⬆"
				label="Review"
				ariaLabel="Open review"
				title="Open review"
				onClick={onOpen}
			/>
		</div>
	);
}
