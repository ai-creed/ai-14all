import { RefreshCw, ChevronUp, Check } from "lucide-react";
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
		<div className="flex items-center h-9 px-3 gap-2 border-t border-[var(--pane-border-review)]" data-testid="review-chipbar">
			<span className="text-[10px] uppercase tracking-wider text-muted-foreground">REVIEW</span>
			<span className="text-xs font-medium text-foreground">
				{MODE_LABEL[reviewMode]}
			</span>
			{isDirty ? (
				canOpenFiles ? (
					<button
						type="button"
						className="text-xs text-destructive hover:underline"
						data-state="dirty"
						data-testid="review-chipbar-files"
						title="Open changed files"
						onClick={onOpenFiles}
					>
						{changedFileCount} changed
					</button>
				) : (
					<span className="text-xs text-muted-foreground" data-state="dirty">
						{changedFileCount} changed
					</span>
				)
			) : (
				<span className="text-xs text-muted-foreground" data-state="clean">
					<Check className="h-3 w-3 inline" aria-hidden="true" /> clean
				</span>
			)}
			{hasComments && (
				<span className="flex items-center gap-1 text-xs">
					{openCommentCount > 0 && (
						<button
							type="button"
							className="text-xs text-destructive font-medium hover:underline"
							data-testid="review-chipbar-comments"
							title="Go to first open comment"
							onClick={onOpenComments}
						>
							{openCommentCount} open
						</button>
					)}
					{addressedCommentCount > 0 && (
						<span className="text-xs text-muted-foreground">
							{openCommentCount > 0 ? " · " : ""}
							{addressedCommentCount} addressed
						</span>
					)}
				</span>
			)}
			<span className="flex-1" />
			<ReviewBarButton
				icon={<RefreshCw className="h-3.5 w-3.5" />}
				label="Refresh"
				ariaLabel="Refresh review"
				title="Refresh review"
				onClick={onRefresh}
			/>
			<ReviewBarButton
				icon={<ChevronUp className="h-3.5 w-3.5" />}
				label="Review"
				ariaLabel="Open review"
				title="Open review"
				onClick={onOpen}
			/>
		</div>
	);
}
