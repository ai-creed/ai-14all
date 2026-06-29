import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
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
import type { InlineEditorHandle } from "../../features/viewer/components/InlineEditor";
import { ReviewQueuePanel } from "../../features/review/components/ReviewQueuePanel";
import { ReviewRail } from "../../features/review/components/ReviewRail";
import { DiffViewerPane } from "../../features/review/components/DiffViewerPane";
import {
	dispatchActionsForJump,
	waitForEditor,
	runCommentJump,
} from "../../features/review/logic/queue-jump";
import { usePendingCommentJump } from "../../features/review/hooks/use-pending-comment-jump";
import { useReviewedFiles } from "../../features/review/hooks/use-reviewed-files";
import { scrollToLineRange } from "../../features/review/logic/diff-editor-decorations";
import { useToast } from "../../features/ui/toast/use-toast";
import { createDiffEditorRegistry } from "../../features/review/logic/diff-editor-registry";
import {
	navigateToNextDiff,
	navigateToPrevDiff,
} from "../../features/review/logic/diff-navigation";
import { useKeyboardShortcut } from "../hooks/use-keyboard-shortcut";
import { detectPlatform } from "../shortcut-registry";
import { useRegisterCommands } from "../../features/command-palette/hooks/use-command-registry";
import type { Command } from "../../features/command-palette/logic/command";
import type { useReviewComments } from "../../features/review/hooks/use-review-comments";
import type { ReviewCommentSource } from "../../../shared/models/review-comment";
import type { ReviewComment } from "../../../shared/models/review-comment";

export type NewCommentDraft = {
	filePath: string;
	startLine: number;
	endLine: number;
	snippet: string;
	body: string;
	source: ReviewCommentSource;
	commitSha: string | null;
};

type ReviewState = ReturnType<typeof useReviewComments>;

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
	installCtaVisible: boolean;
	onOpenInstall: () => void;
	dispatch: (action: WorkspaceAction) => void;
	handlePushBranch: (force: boolean) => Promise<void>;
	handleSelectChangedFile: (relativePath: string) => void;
	setDiscardPath: (next: string | null) => void;
	bumpRefreshKey: () => void;
	addingDraft: NewCommentDraft | null;
	setAddingDraft: (next: NewCommentDraft | null) => void;
	updateAddingDraftBody: (body: string) => void;
	pendingCommentJump: number;
	onConsumePendingCommentJump: () => void;
	onCloseReview: () => void;
};

/**
 * Three-tab review surface (Files / Changes / Commits) with diff viewer pane
 * and review-comment queue panel. Owns the local UI state for tree preview,
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
		installCtaVisible,
		onOpenInstall,
		dispatch,
		handlePushBranch,
		handleSelectChangedFile,
		setDiscardPath,
		bumpRefreshKey,
		addingDraft,
		setAddingDraft,
		updateAddingDraftBody,
		pendingCommentJump,
		onConsumePendingCommentJump,
	} = props;

	// Local UI state owned by the review surface
	const [treePreviewPath, setTreePreviewPath] = useState<string | null>(null);
	const [hideAddressed, setHideAddressed] = useState(false);
	const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
	const diffEditorRegistry = useMemo(() => createDiffEditorRegistry(), []);
	const toast = useToast();
	const inlineEditorRef = useRef<InlineEditorHandle | null>(null);

	// Single reviewed-files boundary: hashes diff content as editors mount and
	// resolves which paths are currently considered reviewed (per mode).
	const reviewed = useReviewedFiles({
		worktreeId: activeWorktree.id,
		marks: activeSession?.reviewedFiles ?? [],
		dispatch,
	});

	// Record the changes-mode file's content as its diff loads, so its marker
	// resets when the file changes (commit files are recorded on editor mount,
	// via DiffViewerPane's onFileContent).
	useEffect(() => {
		if (activeSession?.reviewMode === "changes" && diffState.data) {
			reviewed.recordHash(diffState.data.path, diffState.data.modifiedContent);
		}
	}, [activeSession?.reviewMode, diffState.data, reviewed]);

	const reviewedPaths = useMemo(
		() => reviewed.reviewedPaths(changes.map((c) => c.path)),
		[reviewed, changes],
	);

	const commitFiles = commitDetailState.data?.files ?? [];
	const commitReviewedPaths = useMemo(
		() => reviewed.reviewedPaths(commitFiles.map((f) => f.path)),
		[reviewed, commitFiles],
	);
	const commitOpenCommentCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		const sha = activeSession?.selectedCommitSha ?? null;
		for (const c of reviewState.comments) {
			if (c.status === "open" && c.source === "commit" && c.commitSha === sha) {
				counts[c.filePath] = (counts[c.filePath] ?? 0) + 1;
			}
		}
		return counts;
	}, [reviewState.comments, activeSession?.selectedCommitSha]);

	// Lifted out of the comment-sidebar IIFE so the chip-initiated hook below can
	// call it too. Reused for both the sidebar onJump (default 500ms editor
	// budget) and the chip jump (COLD_JUMP_TIMEOUT_MS, since the overlay may have
	// just opened and the diff is still loading).
	const jumpToComment = useCallback(
		(c: ReviewComment, opts?: { editorTimeoutMs?: number }) =>
			runCommentJump(c, {
				dispatch,
				getEditor: () => diffEditorRegistry.get(c.filePath) ?? null,
				onResolved: (editor) => {
					scrollToLineRange(editor, c);
					setFocusedThreadId(c.id);
				},
				onMissing: () => toast.show("File no longer in this diff"),
				editorTimeoutMs: opts?.editorTimeoutMs,
			}),
		[dispatch, diffEditorRegistry, toast],
	);

	// React to the review-chip "open comments" signal: jump to the first open
	// comment with the cold-open editor budget, then consume the nonce.
	usePendingCommentJump({
		nonce: pendingCommentJump,
		comments: reviewState.comments,
		jump: jumpToComment,
		onConsume: onConsumePendingCommentJump,
	});

	// Clear tree preview when the active worktree changes
	useEffect(() => {
		setTreePreviewPath(null);
	}, [activeWorktree.id]);

	const currentFilePath =
		activeSession?.reviewMode === "commits"
			? (activeSession?.selectedCommitFilePath ?? null)
			: activeSession?.reviewMode === "changes"
				? (activeSession?.selectedChangedFilePath ?? null)
				: null;

	const platform = useMemo(() => detectPlatform(), []);

	const stepFile = useCallback(
		(direction: 1 | -1, e?: KeyboardEvent) => {
			if (activeSession?.reviewMode === "changes") {
				if (changes.length < 2) return;
				const currentPath = activeSession.selectedChangedFilePath;
				const idx = changes.findIndex((c) => c.path === currentPath);
				const nextIdx =
					idx === -1
						? direction > 0
							? 0
							: changes.length - 1
						: (idx + direction + changes.length) % changes.length;
				const next = changes[nextIdx];
				if (!next) return;
				e?.preventDefault();
				dispatch({
					type: "session/selectChangedFile",
					worktreeId: activeWorktree.id,
					relativePath: next.path,
				});
			} else if (activeSession?.reviewMode === "commits") {
				const files = commitDetailState.data?.files ?? [];
				if (files.length < 2) return;
				const currentPath = activeSession.selectedCommitFilePath;
				const idx = files.findIndex((f) => f.path === currentPath);
				const nextIdx =
					idx === -1
						? direction > 0
							? 0
							: files.length - 1
						: (idx + direction + files.length) % files.length;
				const next = files[nextIdx];
				if (!next) return;
				e?.preventDefault();
				dispatch({
					type: "session/selectCommitFile",
					worktreeId: activeWorktree.id,
					relativePath: next.path,
				});
			}
			// reviewMode === "files" → no-op (no ordered list to navigate)
		},
		[
			activeSession?.reviewMode,
			activeSession?.selectedChangedFilePath,
			activeSession?.selectedCommitFilePath,
			changes,
			commitDetailState.data,
			activeWorktree.id,
			dispatch,
		],
	);

	useKeyboardShortcut(
		"review.fileNext",
		platform,
		(e) => {
			stepFile(+1, e);
		},
		[stepFile],
	);
	useKeyboardShortcut(
		"review.filePrev",
		platform,
		(e) => {
			stepFile(-1, e);
		},
		[stepFile],
	);
	useKeyboardShortcut(
		"review.diffNext",
		platform,
		(e) => {
			if (!currentFilePath) return;
			const editor = diffEditorRegistry.get(currentFilePath);
			if (!editor) return;
			if (navigateToNextDiff(editor)) e.preventDefault();
		},
		[currentFilePath, diffEditorRegistry],
	);
	useKeyboardShortcut(
		"review.diffPrev",
		platform,
		(e) => {
			if (!currentFilePath) return;
			const editor = diffEditorRegistry.get(currentFilePath);
			if (!editor) return;
			if (navigateToPrevDiff(editor)) e.preventDefault();
		},
		[currentFilePath, diffEditorRegistry],
	);

	// Event-free diff-navigation callbacks for the command palette
	const goNextDiff = useCallback(() => {
		if (!currentFilePath) return;
		const editor = diffEditorRegistry.get(currentFilePath);
		if (!editor) return;
		navigateToNextDiff(editor);
	}, [currentFilePath, diffEditorRegistry]);
	const goPrevDiff = useCallback(() => {
		if (!currentFilePath) return;
		const editor = diffEditorRegistry.get(currentFilePath);
		if (!editor) return;
		navigateToPrevDiff(editor);
	}, [currentFilePath, diffEditorRegistry]);

	// Render-synced ref so reviewNavCommands can reference the latest stepFile
	// without listing it (or its churning deps) in the useMemo dependency array.
	// This prevents an infinite render loop: stepFile's deps include `changes`
	// and `commitDetailState.data` which may produce new references every render;
	// putting stepFile directly in useMemo deps would cause reviewNavCommands to
	// churn → useRegisterCommands re-fires → version bump → re-render → loop.
	const stepFileRef = useRef(stepFile);
	stepFileRef.current = stepFile;

	const reviewNavCommands = useMemo<Command[]>(
		() => [
			{
				id: "review.fileNext",
				title: "Next file",
				group: "Review",
				keybindingId: "review.fileNext",
				run: () => stepFileRef.current(+1),
				isAvailable: () =>
					(activeSession?.reviewMode === "changes" && changes.length > 1) ||
					activeSession?.reviewMode === "commits",
			},
			{
				id: "review.filePrev",
				title: "Previous file",
				group: "Review",
				keybindingId: "review.filePrev",
				run: () => stepFileRef.current(-1),
				isAvailable: () =>
					(activeSession?.reviewMode === "changes" && changes.length > 1) ||
					activeSession?.reviewMode === "commits",
			},
			{
				id: "review.diffNext",
				title: "Next diff in file",
				group: "Review",
				keybindingId: "review.diffNext",
				run: goNextDiff,
				isAvailable: () => !!currentFilePath,
			},
			{
				id: "review.diffPrev",
				title: "Previous diff in file",
				group: "Review",
				keybindingId: "review.diffPrev",
				run: goPrevDiff,
				isAvailable: () => !!currentFilePath,
			},
		],
		[
			goNextDiff,
			goPrevDiff,
			currentFilePath,
			activeSession?.reviewMode,
			changes.length,
		],
	);
	useRegisterCommands(reviewNavCommands, [reviewNavCommands]);

	return (
		<Tabs
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
				data-focused-thread-id={focusedThreadId ?? ""}
				style={{
					gridTemplateColumns: commentSidebarOpen
						? `${reviewRailWidth}px 8px minmax(0, 1fr) 8px ${activeSession?.reviewSidebarWidth ?? 280}px`
						: `${reviewRailWidth}px 8px minmax(0, 1fr)`,
				}}
			>
				<ReviewRail
					activeWorktree={activeWorktree}
					activeSession={activeSession}
					activeWorkspaceId={activeWorkspaceId}
					changes={changes}
					openCommentCounts={openCommentCounts}
					reviewedPaths={reviewedPaths}
					commitReviewedPaths={commitReviewedPaths}
					commitOpenCommentCounts={commitOpenCommentCounts}
					commitHistoryState={commitHistoryState}
					commitDetailState={commitDetailState}
					remoteStatus={remoteStatus}
					selectedCommitOpenCommentCount={selectedCommitOpenCommentCount}
					gitSummaryError={gitSummaryError}
					gitSummaryStale={gitSummaryStale}
					gitSummaryMessage={gitSummaryMessage}
					treePreviewPath={treePreviewPath}
					onSetTreePreviewPath={setTreePreviewPath}
					dispatch={dispatch}
					handleSelectChangedFile={handleSelectChangedFile}
					setDiscardPath={setDiscardPath}
					handlePushBranch={handlePushBranch}
					requestFileSwitch={async () =>
						(await inlineEditorRef.current?.requestSwitch?.()) ?? "proceed"
					}
					onCloseReview={props.onCloseReview}
				/>

				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize review rail"
					data-testid="review-rail-resize-handle"
					className="shell-review-grid__resize-handle"
					onMouseDown={handleReviewRailResizeStart}
				/>

				<DiffViewerPane
					activeWorktree={activeWorktree}
					activeSession={activeSession}
					activeWorkspaceId={activeWorkspaceId}
					diffState={diffState}
					commitDetailState={commitDetailState}
					reviewState={reviewState}
					registry={diffEditorRegistry}
					resolvedTheme={resolvedTheme}
					hideAddressed={hideAddressed}
					currentFilePath={currentFilePath}
					addingDraft={addingDraft}
					setAddingDraft={setAddingDraft}
					updateAddingDraftBody={updateAddingDraftBody}
					bumpRefreshKey={bumpRefreshKey}
					dispatch={dispatch}
					inlineEditorRef={inlineEditorRef}
					focusedThreadId={focusedThreadId}
					onFocusedThreadChange={setFocusedThreadId}
					onFileContent={reviewed.recordHash}
				/>

				{commentSidebarOpen &&
					(() => {
						const reviewMode = activeSession?.reviewMode ?? "files";
						const commitSha =
							reviewMode === "commits"
								? (activeSession?.selectedCommitSha ?? null)
								: null;

						return (
							<ReviewQueuePanel
								activeMode={
									reviewMode === "commits"
										? { kind: "commits", commitSha }
										: reviewMode === "changes"
											? { kind: "changes" }
											: { kind: "files" }
								}
								comments={reviewState.comments}
								hideAddressed={hideAddressed}
								pendingDraft={
									addingDraft && addingDraft.filePath !== currentFilePath
										? addingDraft
										: null
								}
								onJumpToPendingDraft={async (draft) => {
									const actions = dispatchActionsForJump({
										id: "__pending_draft__",
										worktreeId: activeWorktree.id,
										filePath: draft.filePath,
										startLine: draft.startLine,
										endLine: draft.endLine,
										snippet: draft.snippet,
										body: draft.body,
										status: "open",
										source: draft.source,
										commitSha: draft.commitSha,
										createdAt: new Date(0).toISOString(),
										addressedAt: null,
									});
									for (const a of actions) dispatch(a);
									const editor = await waitForEditor(
										() => diffEditorRegistry.get(draft.filePath) ?? null,
									);
									if (editor) {
										scrollToLineRange(editor, draft);
									}
								}}
								onJump={(c) => void jumpToComment(c)}
								onToggleAddressed={async (id) => {
									const c = reviewState.comments.find((x) => x.id === id);
									if (!c) return;
									try {
										if (c.status === "open")
											await reviewState.markAddressed(id);
										else await reviewState.reopen(id);
									} catch (e) {
										toast.show(`Failed: ${(e as Error).message}`);
									}
								}}
								onDelete={async (id) => {
									try {
										await reviewState.remove(id);
									} catch (e) {
										toast.show(`Failed to delete: ${(e as Error).message}`);
									}
								}}
								onClearAddressed={async () => {
									try {
										const res = await reviewState.clearAddressed();
										if (res && "ok" in res && !res.ok) {
											toast.show(
												`Failed to clear: ${(res as { ok: false; error: string }).error}`,
											);
										}
									} catch (e) {
										toast.show(`Failed to clear: ${(e as Error).message}`);
									}
								}}
								onToggleHideAddressed={() => setHideAddressed((v) => !v)}
								installCtaVisible={installCtaVisible}
								onOpenInstall={onOpenInstall}
							/>
						);
					})()}
			</div>
		</Tabs>
	);
}
