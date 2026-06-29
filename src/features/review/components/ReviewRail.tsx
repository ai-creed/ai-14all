import { ScrollArea } from "@/components/ui/scroll-area";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommitList } from "../../git/components/CommitList";
import { ChangesList } from "../../git/components/ChangesList";
import { FilesPane } from "../../../app/components/FilesPane";
import { MarkdownPreviewModal } from "../../viewer/components/MarkdownPreviewModal";
import type { GitChange } from "../../../../shared/models/git-change";
import type { Worktree } from "../../../../shared/models/worktree";
import type { WorktreeSession } from "../../../../shared/models/worktree-session";
import type {
	GitCommitDetail,
	GitCommitHistory,
} from "../../../../shared/models/git-commit-review";
import type { RemoteStatus } from "../../../../shared/models/git-remote-status";
import type { ReviewLoadState } from "../../../app/hooks/review-load-state";
import type { WorkspaceAction } from "../../workspace/logic/workspace-state";

type Props = {
	activeWorktree: Worktree;
	activeSession: WorktreeSession | null;
	activeWorkspaceId: string | null;
	changes: GitChange[];
	openCommentCounts: Record<string, number>;
	commitHistoryState: ReviewLoadState<GitCommitHistory>;
	commitDetailState: ReviewLoadState<GitCommitDetail>;
	remoteStatus: RemoteStatus | null;
	selectedCommitOpenCommentCount: number;
	gitSummaryError: boolean;
	gitSummaryStale: boolean;
	gitSummaryMessage: string | null;
	treePreviewPath: string | null;
	onSetTreePreviewPath: (path: string | null) => void;
	dispatch: (action: WorkspaceAction) => void;
	handleSelectChangedFile: (relativePath: string) => void;
	setDiscardPath: (next: string | null) => void;
	handlePushBranch: (force: boolean) => Promise<void>;
	requestFileSwitch: () => Promise<"proceed" | "cancel">;
	onCloseReview: () => void;
	/** Slot rendered above the active list — Phase 2 fills this with the progress header. */
	header?: React.ReactNode;
	/** Slot rendered below the active list — Phase 2 fills this with the overview. */
	footer?: React.ReactNode;
};

/**
 * Left rail of the review surface: the Files / Changes / Commits tab segments
 * plus the active list ladder (file tree, working-tree changes, or commit
 * history). Renders only the `shell-review-rail` section; the surrounding
 * `<Tabs>` context (and the diff viewer grid) stay in the host so the tab
 * triggers continue to drive the shared review mode. `header`/`footer` are
 * layout slots reserved for the progress header and overview added later.
 */
export function ReviewRail(props: Props): React.ReactElement {
	const {
		activeWorktree,
		activeSession,
		activeWorkspaceId,
		changes,
		openCommentCounts,
		commitHistoryState,
		commitDetailState,
		remoteStatus,
		selectedCommitOpenCommentCount,
		gitSummaryError,
		gitSummaryStale,
		gitSummaryMessage,
		treePreviewPath,
		onSetTreePreviewPath,
		dispatch,
		handleSelectChangedFile,
		setDiscardPath,
		handlePushBranch,
		requestFileSwitch,
		onCloseReview,
		header,
		footer,
	} = props;

	return (
		<section
			className="shell-panel shell-review-rail"
			data-testid="review-rail"
		>
			<div className="shell-review-rail__header">
				<TabsList
					aria-label="Review mode"
					className="shell-review-tabs__list shell-review-tabs__segments"
				>
					<TabsTrigger value="files" className="shell-review-tab">
						Files
					</TabsTrigger>
					<TabsTrigger value="changes" className="shell-review-tab">
						Changes
					</TabsTrigger>
					<TabsTrigger value="commits" className="shell-review-tab">
						Commits
					</TabsTrigger>
				</TabsList>
			</div>

			{header}

			<ScrollArea className="shell-review-rail__scroll">
				<div className="shell-rail__viewport">
					{activeSession?.reviewMode === "commits" ? (
						<>
							{commitHistoryState.message && (
								<p
									className={
										commitHistoryState.stale
											? "shell-inline-warning"
											: "shell-error"
									}
								>
									{commitHistoryState.message}
								</p>
							)}
							<CommitList
								workspaceId={activeWorkspaceId ?? ""}
								worktreeId={activeWorktree.id}
								history={
									commitHistoryState.data ?? {
										mergeTargetRef: null,
										entries: [],
									}
								}
								selectedCommitSha={activeSession.selectedCommitSha}
								selectedCommitFilePath={activeSession.selectedCommitFilePath}
								activeDetail={commitDetailState.data}
								onSelectCommit={(sha) =>
									dispatch({
										type: "session/selectCommit",
										worktreeId: activeWorktree.id,
										sha,
									})
								}
								onDeselectCommit={() =>
									dispatch({
										type: "session/clearSelectedCommit",
										worktreeId: activeWorktree.id,
									})
								}
								onSelectCommitFile={(relativePath) =>
									dispatch({
										type: "session/selectCommitFile",
										worktreeId: activeWorktree.id,
										relativePath,
									})
								}
								remoteStatus={remoteStatus}
								onPush={handlePushBranch}
								selectedCommitOpenCommentCount={selectedCommitOpenCommentCount}
							/>
						</>
					) : activeSession?.reviewMode === "files" ? (
						<>
							<FilesPane
								workspaceId={activeWorkspaceId ?? ""}
								worktreeId={activeWorktree.id}
								worktreeLabel={activeWorktree.label}
								selectedFile={activeSession.selectedFilePath}
								onSelect={async (relativePath) => {
									const decision = await requestFileSwitch();
									if (decision === "cancel") return;
									dispatch({
										type: "session/selectFile",
										worktreeId: activeWorktree.id,
										relativePath,
									});
								}}
								onPreviewMarkdown={onSetTreePreviewPath}
								changedFiles={changes}
								gitSummaryError={gitSummaryError}
								gitSummaryMessage={gitSummaryMessage}
								expandedPaths={activeSession.treeExpandedPaths}
								onExpandedPathsChange={(worktreeId, paths) =>
									dispatch({
										type: "session/setTreeExpandedPaths",
										worktreeId,
										paths,
									})
								}
								showIgnored={activeSession.treeShowIgnored}
								onToggleShowIgnored={() =>
									dispatch({
										type: "session/setTreeShowIgnored",
										worktreeId: activeWorktree.id,
										showIgnored: !activeSession.treeShowIgnored,
									})
								}
								mode={activeSession.filesPaneMode}
								onModeChange={(filesPaneMode) =>
									dispatch({
										type: "session/setFilesPaneMode",
										worktreeId: activeWorktree.id,
										filesPaneMode,
									})
								}
								onRequestClose={onCloseReview}
							/>
							{/* Always mounted, visibility driven by `open`: unmounting
							    a Radix Dialog while it is still open skips its body
							    pointer-events/aria cleanup and freezes the app. */}
							<MarkdownPreviewModal
								workspaceId={activeWorkspaceId ?? ""}
								worktreeId={activeWorktree.id}
								relativePath={treePreviewPath ?? ""}
								open={treePreviewPath !== null}
								onClose={() => onSetTreePreviewPath(null)}
							/>
						</>
					) : (
						<ChangesList
							workspaceId={activeWorkspaceId ?? ""}
							worktreeId={activeWorktree.id}
							changes={changes}
							selectedPath={activeSession?.selectedChangedFilePath ?? null}
							onSelect={handleSelectChangedFile}
							onDiscardChange={(relativePath) => setDiscardPath(relativePath)}
							gitSummaryError={gitSummaryError}
							gitSummaryStale={gitSummaryStale}
							gitSummaryMessage={gitSummaryMessage}
							openCommentCounts={openCommentCounts}
						/>
					)}

					{footer}
				</div>
			</ScrollArea>
		</section>
	);
}
