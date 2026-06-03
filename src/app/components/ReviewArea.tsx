import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { FilesPane } from "./FilesPane";
import { CommitDiffStack } from "../../features/git/components/CommitDiffStack";
import { DiffViewer } from "../../features/viewer/components/DiffViewer";
import { MarkdownPreviewModal } from "../../features/viewer/components/MarkdownPreviewModal";
import {
	InlineEditor,
	type InlineEditorHandle,
} from "../../features/viewer/components/InlineEditor";
import { ReviewQueuePanel } from "../../features/review/components/ReviewQueuePanel";
import { InlineMountsBridge } from "../../features/review/components/InlineMountsBridge";
import { filterForInlineMount } from "../../features/review/logic/inline-mount-filter";
import {
	dispatchActionsForJump,
	waitForEditor,
	runCommentJump,
} from "../../features/review/logic/queue-jump";
import { usePendingCommentJump } from "../../features/review/hooks/use-pending-comment-jump";
import {
	scrollToLineRange,
	installAddAffordances,
} from "../../features/review/logic/diff-editor-decorations";
import { installSelectionPill } from "../../features/review/logic/inline-comment-widgets";
import { installCommentKeyBindings } from "../../features/review/logic/comment-key-bindings";
import { useToast } from "../../features/ui/toast/use-toast";
import { createDiffEditorRegistry } from "../../features/review/logic/diff-editor-registry";
import {
	navigateToNextDiff,
	navigateToPrevDiff,
} from "../../features/review/logic/diff-navigation";
import { useKeyboardShortcut } from "../hooks/use-keyboard-shortcut";
import { detectPlatform } from "../shortcut-registry";
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

	const startDraft = useCallback(
		(
			arg: Pick<
				NewCommentDraft,
				"filePath" | "startLine" | "endLine" | "snippet"
			>,
		) => {
			if (
				addingDraft &&
				addingDraft.body.trim().length > 0 &&
				(addingDraft.filePath !== arg.filePath ||
					addingDraft.startLine !== arg.startLine ||
					addingDraft.endLine !== arg.endLine)
			) {
				const ok = window.confirm(
					"You have an unsaved comment draft. Discard it and start a new one?",
				);
				if (!ok) return;
			}
			const source: ReviewCommentSource =
				activeSession?.reviewMode === "commits" ? "commit" : "working-tree";
			const commitSha =
				activeSession?.reviewMode === "commits"
					? (activeSession?.selectedCommitSha ?? null)
					: null;
			setAddingDraft({ ...arg, body: "", source, commitSha });
		},
		[addingDraft, setAddingDraft, activeSession],
	);

	const inlineComments = useMemo(() => {
		const commitSha =
			activeSession?.reviewMode === "commits"
				? (activeSession?.selectedCommitSha ?? null)
				: null;
		const { inline } = filterForInlineMount(reviewState.comments, {
			reviewMode: activeSession?.reviewMode ?? "files",
			filePath: currentFilePath,
			commitSha,
		});
		return hideAddressed
			? inline.filter((c) => c.status !== "addressed")
			: inline;
	}, [reviewState.comments, activeSession, currentFilePath, hideAddressed]);

	const navigateThread = useCallback(
		(dir: 1 | -1) => {
			const threadsForFile = inlineComments;
			if (threadsForFile.length === 0) return;
			const sorted = [...threadsForFile].sort(
				(a, b) => a.startLine - b.startLine,
			);
			const idx = sorted.findIndex((c) => c.id === focusedThreadId);
			const nextIdx =
				idx === -1
					? dir > 0
						? 0
						: sorted.length - 1
					: (idx + dir + sorted.length) % sorted.length;
			const target = sorted[nextIdx];
			setFocusedThreadId(target.id);
			const editor = diffEditorRegistry.get(target.filePath);
			if (editor) scrollToLineRange(editor, target);
		},
		[inlineComments, focusedThreadId, diffEditorRegistry],
	);

	const pillsRef = useRef(
		new Map<string, ReturnType<typeof installSelectionPill>>(),
	);

	// Stable refs so key-binding handlers (registered once at editor-mount time)
	// always delegate to the latest versions without needing re-registration.
	const startDraftRef = useRef<typeof startDraft>(null!);
	const navigateThreadRef = useRef<(dir: 1 | -1) => void>(null!);
	const focusedThreadIdRef = useRef<string | null>(null);
	const reviewStateRef = useRef<ReviewState>(null!);

	useEffect(() => {
		startDraftRef.current = startDraft;
	}, [startDraft]);
	useEffect(() => {
		navigateThreadRef.current = navigateThread;
	}, [navigateThread]);
	useEffect(() => {
		focusedThreadIdRef.current = focusedThreadId;
	}, [focusedThreadId]);
	useEffect(() => {
		reviewStateRef.current = reviewState;
	}, [reviewState]);

	const handleDiffEditorMount = useCallback(
		(filePath: string, editor: Parameters<typeof installAddAffordances>[0]) => {
			diffEditorRegistry.register(filePath, editor);

			const disposeAdd = installAddAffordances(editor, {
				filePath,
				onEnsureFileFocused: ensureFileFocused,
				onAddSingleLine: ({ filePath: fp, line, snippet }) =>
					startDraftRef.current({
						filePath: fp,
						startLine: line,
						endLine: line,
						snippet,
					}),
				onSelectionChange: () => {
					// selection-pill widget handles its own state
				},
			});

			const pill = installSelectionPill(editor, filePath, (arg) =>
				startDraftRef.current(arg),
			);
			pillsRef.current.set(filePath, pill);

			installCommentKeyBindings(editor.getModifiedEditor(), {
				addAtCaret: () => {
					const pos = editor.getModifiedEditor().getPosition();
					if (!pos) return;
					const snippet =
						editor
							.getModifiedEditor()
							.getModel()
							?.getLineContent(pos.lineNumber) ?? "";
					startDraftRef.current({
						filePath,
						startLine: pos.lineNumber,
						endLine: pos.lineNumber,
						snippet,
					});
				},
				nextThread: () => navigateThreadRef.current(+1),
				prevThread: () => navigateThreadRef.current(-1),
				editFocused: () => {
					const id = focusedThreadIdRef.current;
					if (!id) return;
					const c = reviewStateRef.current.comments.find((x) => x.id === id);
					if (c) scrollToLineRange(editor, c);
				},
				toggleAddressedFocused: () => {
					const id = focusedThreadIdRef.current;
					if (!id) return;
					const c = reviewStateRef.current.comments.find((x) => x.id === id);
					if (!c) return;
					if (c.status === "open")
						void reviewStateRef.current.markAddressed(c.id);
					else void reviewStateRef.current.reopen(c.id);
				},
			});

			editor.onDidDispose(() => {
				disposeAdd();
				pill.dispose();
				pillsRef.current.delete(filePath);
				diffEditorRegistry.unregister(filePath);
			});
		},
		[ensureFileFocused, diffEditorRegistry],
	);

	const handleDiffEditorUnmount = useCallback(
		(filePath: string) => {
			pillsRef.current.get(filePath)?.dispose();
			pillsRef.current.delete(filePath);
			diffEditorRegistry.unregister(filePath);
		},
		[diffEditorRegistry],
	);

	// Suppress selection pill while a draft for that file is active
	useEffect(() => {
		if (!currentFilePath) return;
		const pill = pillsRef.current.get(currentFilePath);
		if (!pill) return;
		pill.setSuppressed(
			addingDraft !== null && addingDraft.filePath === currentFilePath,
		);
	}, [currentFilePath, addingDraft]);

	const platform = useMemo(() => detectPlatform(), []);

	const stepFile = useCallback(
		(direction: 1 | -1, e: KeyboardEvent) => {
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
				e.preventDefault();
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
				e.preventDefault();
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

	const draftBelongsHere =
		addingDraft !== null && addingDraft.filePath === currentFilePath;

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
									<FilesPane
										workspaceId={activeWorkspaceId ?? ""}
										worktreeId={activeWorktree.id}
										worktreeLabel={activeWorktree.label}
										selectedFile={activeSession.selectedFilePath}
										onSelect={async (relativePath) => {
											const decision =
												(await inlineEditorRef.current?.requestSwitch?.()) ??
												"proceed";
											if (decision === "cancel") return;
											dispatch({
												type: "session/selectFile",
												worktreeId: activeWorktree.id,
												relativePath,
											});
										}}
										onPreviewMarkdown={setTreePreviewPath}
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
										onRequestClose={props.onCloseReview}
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
						</div>
					</ScrollArea>
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
					<InlineMountsBridge
						registry={diffEditorRegistry}
						filePath={currentFilePath}
						comments={inlineComments}
						draft={
							draftBelongsHere && addingDraft
								? {
										startLine: addingDraft.startLine,
										endLine: addingDraft.endLine,
									}
								: null
						}
						draftBody={draftBelongsHere ? (addingDraft?.body ?? "") : ""}
						onDraftChange={updateAddingDraftBody}
						onSave={async (id, body) => {
							try {
								const res = await reviewState.update(id, body);
								if (res && "ok" in res && !res.ok) {
									toast.show(
										`Failed to update comment: ${(res as { ok: false; error: string }).error}`,
									);
									return false;
								}
								return true;
							} catch (e) {
								toast.show(`Failed to update: ${(e as Error).message}`);
								return false;
							}
						}}
						onToggleAddressed={async (id) => {
							const c = reviewState.comments.find((x) => x.id === id);
							if (!c) return;
							try {
								if (c.status === "open") await reviewState.markAddressed(id);
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
						onSubmitDraft={async () => {
							if (!addingDraft || addingDraft.body.trim().length === 0) return;
							try {
								await reviewState.create({
									filePath: addingDraft.filePath,
									startLine: addingDraft.startLine,
									endLine: addingDraft.endLine,
									snippet: addingDraft.snippet,
									body: addingDraft.body.trim(),
									source: addingDraft.source,
									commitSha: addingDraft.commitSha,
								});
								setAddingDraft(null);
							} catch (e) {
								toast.show(`Failed to save: ${(e as Error).message}`);
							}
						}}
						onCancelDraft={() => setAddingDraft(null)}
					/>
					{activeSession?.reviewMode === "commits" &&
					commitDetailState.message !== null &&
					commitDetailState.data === null ? (
						<p className="shell-error">{commitDetailState.message}</p>
					) : activeSession?.reviewMode === "commits" &&
					  commitDetailState.data ? (
						<CommitDiffStack
							key={commitDetailState.data.sha}
							workspaceId={activeWorkspaceId ?? ""}
							worktreeId={activeWorktree.id}
							detail={commitDetailState.data}
							focusedPath={activeSession.selectedCommitFilePath}
							resolvedTheme={resolvedTheme}
							onEditorMount={(filePath, editor) => {
								handleDiffEditorMount(filePath, editor);
							}}
							onEditorUnmount={handleDiffEditorUnmount}
						/>
					) : activeSession?.reviewMode === "files" &&
					  activeSession.selectedFilePath ? (
						<InlineEditor
							ref={inlineEditorRef}
							workspaceId={activeWorkspaceId ?? ""}
							worktreeId={activeWorktree.id}
							relativePath={activeSession.selectedFilePath}
							resolvedTheme={resolvedTheme}
							onSaved={bumpRefreshKey}
							pendingReveal={activeSession.pendingReveal}
							onConsumePendingReveal={() =>
								dispatch({
									type: "session/consumePendingReveal",
									worktreeId: activeWorktree.id,
								})
							}
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
								handleDiffEditorMount(filePath, editor);
							}}
						/>
					) : (
						<p className="shell-empty-state">
							Select a file or changed file to inspect it.
						</p>
					)}
				</section>

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
