import type { ReactNode, RefObject } from "react";
import type { MutableRefObject } from "react";
import type { GitSummary } from "../../../shared/models/git-summary";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type {
	WorkspaceAction,
} from "../../features/workspace/logic/workspace-state";
import type { ReviewComment } from "../../../shared/models/review-comment";
import { ReviewDrawer } from "../../features/review/components/ReviewDrawer";
import {
	ReviewExpandedPortal,
	type ReviewExpandedPortalHandle,
} from "../../features/review/components/ReviewExpandedPortal";
import type { useReviewDrawerAutoExpand } from "../../features/review/hooks/use-review-drawer-auto-expand";

type AutoExpand = ReturnType<typeof useReviewDrawerAutoExpand>;

type Props = {
	activeWorktree: Worktree | null;
	activeSession: WorktreeSession | null;
	activeSummary: GitSummary | null;
	changedFileCount: number;
	reviewState: { comments: ReviewComment[] };
	reviewPanelHeight: number;
	onResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void;
	reviewExpanded: boolean;
	setReviewExpanded: (next: boolean) => void;
	collapseReviewExpanded: () => void;
	expandedPortalRef: RefObject<ReviewExpandedPortalHandle | null>;
	mainColRef: MutableRefObject<HTMLElement | null>;
	chipBarRef: MutableRefObject<HTMLDivElement | null>;
	commentSidebarOpen: boolean;
	setCommentSidebarOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
	autoExpand: AutoExpand;
	dispatch: (action: WorkspaceAction) => void;
	handleRefreshChanges: () => Promise<void>;
	children: ReactNode;
};

/**
 * Drawer + expanded-portal wrapper around the review tab content. Manages
 * the toggle/expand UI; the inner tab content (files/changes/commits + diff
 * viewer) is supplied via `children` so this component stays focused on the
 * drawer/portal lifecycle.
 */
export function ReviewDrawerSection(props: Props): React.ReactElement | null {
	const {
		activeWorktree,
		activeSession,
		activeSummary,
		changedFileCount,
		reviewState,
		reviewPanelHeight,
		onResizeStart,
		reviewExpanded,
		setReviewExpanded,
		collapseReviewExpanded,
		expandedPortalRef,
		mainColRef,
		chipBarRef,
		commentSidebarOpen,
		setCommentSidebarOpen,
		autoExpand,
		dispatch,
		handleRefreshChanges,
		children,
	} = props;

	if (!activeWorktree) return null;

	const currentReviewFilePath =
		activeSession?.reviewMode === "commits"
			? (activeSession.selectedCommitFilePath ?? null)
			: activeSession?.reviewMode === "changes"
				? (activeSession.selectedChangedFilePath ?? null)
				: null;

	const openCommentCount = currentReviewFilePath
		? reviewState.comments.filter(
				(c) => c.filePath === currentReviewFilePath && c.status === "open",
			).length
		: null;

	const toggleCommentSidebar = () => setCommentSidebarOpen((o) => !o);

	return (
		<>
			<ReviewDrawer
				open={activeSession?.reviewDrawerOpen ?? false}
				isDirty={activeSummary?.isDirty ?? false}
				changedFileCount={changedFileCount}
				panelHeight={reviewPanelHeight}
				onToggle={() => {
					const next = !(activeSession?.reviewDrawerOpen ?? false);
					if (!next && (activeSummary?.isDirty ?? false)) {
						autoExpand.noteUserCollapse(activeWorktree.id);
					} else if (next) {
						autoExpand.noteUserExpand(activeWorktree.id);
					}
					dispatch({
						type: "session/setReviewDrawerOpen",
						worktreeId: activeWorktree.id,
						open: next,
					});
				}}
				onRefresh={handleRefreshChanges}
				onResizeStart={(e) =>
					onResizeStart(e as React.MouseEvent<HTMLDivElement>)
				}
				expanded={reviewExpanded}
				onExpand={() => setReviewExpanded(true)}
				onCollapse={collapseReviewExpanded}
				commentSidebarOpen={commentSidebarOpen}
				onToggleCommentSidebar={toggleCommentSidebar}
				openCommentCount={openCommentCount}
			>
				{!reviewExpanded ? children : null}
			</ReviewDrawer>
			{reviewExpanded && (
				<ReviewExpandedPortal
					ref={expandedPortalRef}
					mainColRef={mainColRef}
					chipBarRef={chipBarRef}
					onCollapse={() => setReviewExpanded(false)}
					onRefresh={handleRefreshChanges}
					isDirty={activeSummary?.isDirty ?? false}
					changedFileCount={changedFileCount}
					commentSidebarOpen={commentSidebarOpen}
					onToggleCommentSidebar={toggleCommentSidebar}
					openCommentCount={openCommentCount}
				>
					{children}
				</ReviewExpandedPortal>
			)}
		</>
	);
}
