import { useCallback, useEffect, useMemo, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import type { GitChange } from "../../../shared/models/git-change";
import type { GitDiff } from "../../../shared/models/git-diff";
import type {
	GitCommitDetail,
	GitCommitHistory,
} from "../../../shared/models/git-commit-review";
import type { RemoteStatus } from "../../../shared/models/git-remote-status";
import type { Worktree } from "../../../shared/models/worktree";
import type { WorktreeSession } from "../../../shared/models/worktree-session";
import type { ReviewLoadState } from "../hooks/review-load-state";
import type {
	WorkspaceAction,
	WorkspaceState,
} from "../../features/workspace/logic/workspace-state";
import type { ResolvedTheme } from "../../lib/use-theme";
import { CommitList } from "../../features/git/components/CommitList";
import { ChangesList } from "../../features/git/components/ChangesList";
import { WorktreeTree } from "../../features/viewer/components/WorktreeTree";
import { CommitDiffStack } from "../../features/git/components/CommitDiffStack";
import { FileViewer } from "../../features/viewer/components/FileViewer";
import { DiffViewer } from "../../features/viewer/components/DiffViewer";
import { MarkdownPreviewModal } from "../../features/viewer/components/MarkdownPreviewModal";
import { EditorModal } from "../../features/viewer/components/EditorModal";
import {
	ReviewCommentSidebar,
	type NewCommentDraft,
} from "../../features/review/components/ReviewCommentSidebar";
import { createDiffEditorRegistry } from "../../features/review/logic/diff-editor-registry";
import {
	installAddAffordances,
	scrollToLineRange,
	type SelectionDraft,
} from "../../features/review/logic/diff-editor-decorations";
import type { useReviewComments } from "../../features/review/hooks/use-review-comments";

type ReviewState = ReturnType<typeof useReviewComments>;

type EditorTarget = {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
	content: string;
	mtimeMs: number;
};

type Props = {
	activeWorktree: Worktree;
	activeSession: WorktreeSession | null;
	activeWorkspaceId: string | null;
	workspaceState: WorkspaceState;
	changes: GitChange[];
	openCommentCounts: Record<string, number>;
	commitHistoryState: ReviewLoadState<GitCommitHistory>;
	commitDetailState: ReviewLoadState<GitCommitDetail>;
	diffState: ReviewLoadState<GitDiff>;
	remoteStatus: RemoteStatus | null;
	selectedCommitOpenCommentCount: number;
	gitSummaryError: boolean;
	gitSummaryMessage: string | null;
	gitSummaryStale: boolean;
	reviewState: ReviewState;
	reviewRailWidth: number;
	handleReviewRailResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void;
	commentSidebarOpen: boolean;
	resolvedTheme: ResolvedTheme;
	editorTarget: EditorTarget | null;
	setEditorTarget: (next: EditorTarget | null) => void;
	openEditorForFile: (relativePath: string) => Promise<void>;
	openEditorError: string | null;
	setOpenEditorError: (next: string | null) => void;
	installCtaVisible: boolean;
	onOpenInstall: () => void;
	dispatch: (action: WorkspaceAction) => void;
	handlePushBranch: (force: boolean) => Promise<void>;
	handleSelectChangedFile: (relativePath: string) => void;
	setDiscardPath: (next: string | null) => void;
	bumpRefreshKey: () => void;
	addingDraft: NewCommentDraft | null;
	setAddingDraft: (next: NewCommentDraft | null) => void;
	selectionDraft: SelectionDraft;
	setSelectionDraft: (next: SelectionDraft) => void;
};

/**
 * Three-tab review surface (Files / Changes / Commits) with diff viewer pane
 * and review-comment sidebar. Owns the local UI state for tree preview,
 * comment drafts, diff-editor registry, and open-editor errors. Heavier
 * shared state (active worktree, loaders, review comments) is provided by
 * the host via props.
 */
export function ReviewArea(props: Props): React.ReactElement {
	const {
		activeWorktree,
		activeSession,
		activeWorkspaceId,
		changes,
		openCommentCounts,
		commitHistoryState,
		commitDetailState,
		diffState,
		remoteStatus,
		selectedCommitOpenCommentCount,
		gitSummaryError,
		gitSummaryMessage,
		gitSummaryStale,
		reviewState,
		reviewRailWidth,
		handleReviewRailResizeStart,
		commentSidebarOpen,
		resolvedTheme,
		editorTarget,
		setEditorTarget,
		openEditorForFile,
		openEditorError,
		installCtaVisible,
		onOpenInstall,
		dispatch,
		handlePushBranch,
		handleSelectChangedFile,
		setDiscardPath,
		bumpRefreshKey,
		addingDraft,
		setAddingDraft,
		selectionDraft,
		setSelectionDraft,
	} = props;

	// Local UI state owned by the review surface
	const [treePreviewPath, setTreePreviewPath] = useState<string | null>(null);
	const diffEditorRegistry = useMemo(() => createDiffEditorRegistry(), []);

	// Clear tree preview when the active worktree changes
	useEffect(() => {
		setTreePreviewPath(null);
	}, [activeWorktree.id]);

	const ensureFileFocused = useCallback(
		(filePath: string) => {
			if (activeSession?.reviewMode === "commits") {
				if (activeSession.selectedCommitFilePath !== filePath) {
					dispatch({
						type: "session/selectCommitFile",
						worktreeId: activeWorktree.id,
						relativePath: filePath,
					});
				}
			} else {
				if (activeSession?.selectedChangedFilePath !== filePath) {
					dispatch({
						type: "session/selectChangedFile",
						worktreeId: activeWorktree.id,
						relativePath: filePath,
					});
				}
			}
		},
		[activeWorktree, activeSession, dispatch],
	);

	return (
		<Tabs.Root
			value={activeSession?.reviewMode ?? "files"}
			onValueChange={(value) =>
				dispatch({
					type: "session/setReviewMode",
					worktreeId: activeWorktree.id,
					reviewMode: value as "files" | "changes" | "commits",
				})
			}
			className="shell-review-shell"
		>
			<div
				className="shell-review-grid"
				data-testid="review-grid"
				style={{
					gridTemplateColumns: commentSidebarOpen
						? `${reviewRailWidth}px 8px minmax(0, 1fr) 8px ${activeSession?.reviewSidebarWidth ?? 280}px`
						: `${reviewRailWidth}px 8px minmax(0, 1fr)`,
				}}
			>
				<section
					className="shell-panel shell-review-rail"
					data-testid="review-rail"
				>
					<div className="shell-review-rail__header">
						<Tabs.List
							aria-label="Review mode"
							className="shell-review-tabs__list shell-review-tabs__segments"
						>
							<Tabs.Trigger value="files" className="shell-review-tab">
								Files
							</Tabs.Trigger>
							<Tabs.Trigger value="changes" className="shell-review-tab">
								Changes
							</Tabs.Trigger>
							<Tabs.Trigger value="commits" className="shell-review-tab">
								Commits
							</Tabs.Trigger>
						</Tabs.List>
					</div>

					<ScrollArea.Root className="shell-review-rail__scroll">
						<ScrollArea.Viewport className="shell-rail__viewport">
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
										selectedCommitFilePath={
											activeSession.selectedCommitFilePath
										}
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
										selectedCommitOpenCommentCount={
											selectedCommitOpenCommentCount
										}
									/>
								</>
							) : activeSession?.reviewMode === "files" ? (
								<>
									{openEditorError !== null && (
										<p className="shell-error">{openEditorError}</p>
									)}
									<WorktreeTree
										workspaceId={activeWorkspaceId ?? ""}
										worktreeId={activeWorktree.id}
										worktreeLabel={activeWorktree.label}
										selectedFile={activeSession.selectedFilePath}
										onSelect={(relativePath) =>
											dispatch({
												type: "session/selectFile",
												worktreeId: activeWorktree.id,
												relativePath,
											})
										}
										onPreviewMarkdown={setTreePreviewPath}
										onEditFile={openEditorForFile}
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
									/>
									{treePreviewPath !== null && (
										<MarkdownPreviewModal
											workspaceId={activeWorkspaceId ?? ""}
											worktreeId={activeWorktree.id}
											relativePath={treePreviewPath}
											open={true}
											onClose={() => setTreePreviewPath(null)}
										/>
									)}
									{editorTarget !== null && (
										<EditorModal
											workspaceId={editorTarget.workspaceId}
											worktreeId={editorTarget.worktreeId}
											relativePath={editorTarget.relativePath}
											initialContent={editorTarget.content}
											initialMtimeMs={editorTarget.mtimeMs}
											theme={resolvedTheme}
											onClose={() => setEditorTarget(null)}
											onFileSaved={bumpRefreshKey}
										/>
									)}
								</>
							) : (
								<ChangesList
									workspaceId={activeWorkspaceId ?? ""}
									worktreeId={activeWorktree.id}
									changes={changes}
									selectedPath={activeSession?.selectedChangedFilePath ?? null}
									onSelect={handleSelectChangedFile}
									onDiscardChange={(relativePath) =>
										setDiscardPath(relativePath)
									}
									gitSummaryError={gitSummaryError}
									gitSummaryStale={gitSummaryStale}
									gitSummaryMessage={gitSummaryMessage}
									openCommentCounts={openCommentCounts}
								/>
							)}
						</ScrollArea.Viewport>
						<ScrollArea.Scrollbar
							orientation="vertical"
							className="shell-scrollbar"
						/>
					</ScrollArea.Root>
				</section>

				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize review rail"
					data-testid="review-rail-resize-handle"
					className="shell-review-grid__resize-handle"
					onMouseDown={handleReviewRailResizeStart}
				/>

				<section className="shell-panel shell-viewer-panel">
					{activeSession?.reviewMode === "commits" &&
					commitDetailState.message !== null &&
					commitDetailState.data === null ? (
						<p className="shell-error">{commitDetailState.message}</p>
					) : activeSession?.reviewMode === "commits" &&
					  commitDetailState.data ? (
						<CommitDiffStack
							key={commitDetailState.data.sha}
							detail={commitDetailState.data}
							focusedPath={activeSession.selectedCommitFilePath}
							resolvedTheme={resolvedTheme}
							onEditorMount={(filePath, editor) => {
								diffEditorRegistry.register(filePath, editor);
								const dispose = installAddAffordances(editor, {
									filePath,
									onEnsureFileFocused: ensureFileFocused,
									onAddSingleLine: ({ filePath, line, snippet }) =>
										setAddingDraft({
											filePath,
											startLine: line,
											endLine: line,
											snippet,
										}),
									onSelectionChange: (draft) => setSelectionDraft(draft),
								});
								editor.onDidDispose(() => {
									dispose();
									diffEditorRegistry.unregister(filePath);
								});
							}}
							onEditorUnmount={(filePath) =>
								diffEditorRegistry.unregister(filePath)
							}
						/>
					) : activeSession?.reviewMode === "files" &&
					  activeSession.selectedFilePath ? (
						<FileViewer
							workspaceId={activeWorkspaceId ?? ""}
							worktreeId={activeWorktree.id}
							relativePath={activeSession.selectedFilePath}
							resolvedTheme={resolvedTheme}
							onEditFile={openEditorForFile}
						/>
					) : activeSession?.reviewMode === "changes" && diffState.data ? (
						<DiffViewer
							key={diffState.data.path}
							path={diffState.data.path}
							content={diffState.data.content}
							originalContent={diffState.data.originalContent}
							modifiedContent={diffState.data.modifiedContent}
							resolvedTheme={resolvedTheme}
							onMount={(filePath, editor) => {
								diffEditorRegistry.register(filePath, editor);
								const dispose = installAddAffordances(editor, {
									filePath,
									onEnsureFileFocused: ensureFileFocused,
									onAddSingleLine: ({ filePath, line, snippet }) =>
										setAddingDraft({
											filePath,
											startLine: line,
											endLine: line,
											snippet,
										}),
									onSelectionChange: (draft) => setSelectionDraft(draft),
								});
								editor.onDidDispose(() => {
									dispose();
									diffEditorRegistry.unregister(filePath);
								});
							}}
						/>
					) : (
						<p className="shell-empty-state">
							Select a file or changed file to inspect it.
						</p>
					)}
					{selectionDraft && (
						<button
							type="button"
							className="shell-review-floating-add"
							onClick={() => {
								ensureFileFocused(selectionDraft.filePath);
								setAddingDraft({
									filePath: selectionDraft.filePath,
									startLine: selectionDraft.startLine,
									endLine: selectionDraft.endLine,
									snippet: selectionDraft.snippet,
								});
								setSelectionDraft(null);
							}}
						>
							+ Add comment for L{selectionDraft.startLine}–
							{selectionDraft.endLine}
						</button>
					)}
				</section>

				{commentSidebarOpen &&
					(() => {
						const currentFilePath =
							activeSession?.reviewMode === "commits"
								? (activeSession.selectedCommitFilePath ?? null)
								: (activeSession?.selectedChangedFilePath ?? null);
						return currentFilePath ? (
							<ReviewCommentSidebar
								filePath={currentFilePath}
								comments={reviewState.comments}
								addingForFile={addingDraft}
								onScrollTo={(range) => {
									const editor = diffEditorRegistry.get(currentFilePath);
									if (editor) scrollToLineRange(editor, range);
								}}
								onToggleAddressed={async (commentId) => {
									const c = reviewState.comments.find(
										(c) => c.id === commentId,
									);
									if (!c) return;
									if (c.status === "open")
										await reviewState.markAddressed(commentId);
									else await reviewState.reopen(commentId);
								}}
								onDelete={(commentId) => reviewState.remove(commentId)}
								onSubmitNew={async (draft, body) => {
									await reviewState.create({
										filePath: draft.filePath,
										startLine: draft.startLine,
										endLine: draft.endLine,
										snippet: draft.snippet,
										body,
										source:
											activeSession?.reviewMode === "commits"
												? "commit"
												: "working-tree",
										commitSha:
											activeSession?.reviewMode === "commits"
												? (activeSession.selectedCommitSha ?? null)
												: null,
									});
									setAddingDraft(null);
								}}
								onCancelNew={() => setAddingDraft(null)}
								installCtaVisible={installCtaVisible}
								onOpenInstall={onOpenInstall}
							/>
						) : null;
					})()}
			</div>
		</Tabs.Root>
	);
}

// Re-export so App.tsx can use this prop type
export type { EditorTarget };
