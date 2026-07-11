import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GitDiff } from "../../../../shared/models/git-diff";
import type { GitCommitDetail } from "../../../../shared/models/git-commit-review";
import type { Worktree } from "../../../../shared/models/worktree";
import type { WorktreeSession } from "../../../../shared/models/worktree-session";
import type {
	ReviewComment,
	ReviewCommentSource,
} from "../../../../shared/models/review-comment";
import type { ReviewLoadState } from "../../../app/hooks/review-load-state";
import type { WorkspaceAction } from "../../workspace/logic/workspace-state";
import type { ResolvedTheme } from "../../../lib/use-theme";
import type { NewCommentDraft } from "../../../app/components/ReviewArea";
import { CommitDiffStack } from "../../git/components/CommitDiffStack";
import { DiffViewer } from "../../viewer/components/DiffViewer";
import { FileViewer } from "../../viewer/components/FileViewer";
import type { InlineEditorHandle } from "../../viewer/components/InlineEditor";
import { InlineMountsBridge } from "./InlineMountsBridge";
import { filterForInlineMount } from "../logic/inline-mount-filter";
import {
	scrollToLineRange,
	installAddAffordances,
} from "../logic/diff-editor-decorations";
import { installSelectionPill } from "../logic/inline-comment-widgets";
import { installCommentKeyBindings } from "../logic/comment-key-bindings";
import { useToast } from "../../ui/toast/use-toast";
import type { DiffEditorRegistry } from "../logic/diff-editor-registry";
import type { useReviewComments } from "../hooks/use-review-comments";

type ReviewState = ReturnType<typeof useReviewComments>;

type Props = {
	activeWorktree: Worktree;
	activeSession: WorktreeSession | null;
	activeWorkspaceId: string | null;
	diffState: ReviewLoadState<GitDiff>;
	commitDetailState: ReviewLoadState<GitCommitDetail>;
	reviewState: ReviewState;
	registry: DiffEditorRegistry;
	resolvedTheme: ResolvedTheme;
	hideAddressed: boolean;
	currentFilePath: string | null;
	addingDraft: NewCommentDraft | null;
	setAddingDraft: (next: NewCommentDraft | null) => void;
	updateAddingDraftBody: (body: string) => void;
	bumpRefreshKey: () => void;
	dispatch: (action: WorkspaceAction) => void;
	inlineEditorRef: React.RefObject<InlineEditorHandle | null>;
	focusedThreadId: string | null;
	onFocusedThreadChange: (id: string | null) => void;
	/**
	 * Reports the modified-model content of a diff editor as it mounts so the
	 * reviewed-files hook can hash it. Lets commit-mode files (which never flow
	 * through `diffState`) get a current hash once viewed, resetting their marker.
	 */
	onFileContent?: (path: string, content: string) => void;
};

/**
 * Center column of the review surface: the inline-comment mount bridge plus the
 * viewer-selection ladder (commit diff stack / inline file editor / working-tree
 * diff / empty state). Owns the diff-editor mount handlers, the selection pill
 * and comment key bindings, the inline-thread navigation, and the new-comment
 * draft lifecycle. The shared `diffEditorRegistry` is created by the host and
 * passed down via `registry` so the host's file/diff keyboard shortcuts can read
 * it; focus changes are reported up via `onFocusedThreadChange` so the host can
 * keep the grid's `data-focused-thread-id` attribute in sync.
 */
export function DiffViewerPane(props: Props): React.ReactElement {
	const {
		activeWorktree,
		activeSession,
		activeWorkspaceId,
		diffState,
		commitDetailState,
		reviewState,
		registry,
		resolvedTheme,
		hideAddressed,
		currentFilePath,
		addingDraft,
		setAddingDraft,
		updateAddingDraftBody,
		bumpRefreshKey,
		dispatch,
		inlineEditorRef,
		focusedThreadId,
		onFocusedThreadChange,
		onFileContent,
	} = props;

	const toast = useToast();

	const focusHostEditor = useCallback(
		(filePath: string | null) => {
			if (!filePath) return;
			registry.get(filePath)?.getModifiedEditor().focus();
		},
		[registry],
	);

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
			onFocusedThreadChange(target.id);
			const editor = registry.get(target.filePath);
			if (editor) scrollToLineRange(editor, target);
		},
		[inlineComments, focusedThreadId, registry, onFocusedThreadChange],
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
	const pendingUndoRef = useRef<{
		toastId: string;
		snapshot: ReviewComment;
	} | null>(null);

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
			registry.register(filePath, editor);

			const value = editor.getModifiedEditor?.().getModel?.()?.getValue?.();
			if (value !== undefined) onFileContent?.(filePath, value);

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
				registry.unregister(filePath);
			});
		},
		[ensureFileFocused, registry, onFileContent],
	);

	const handleDiffEditorUnmount = useCallback(
		(filePath: string) => {
			pillsRef.current.get(filePath)?.dispose();
			pillsRef.current.delete(filePath);
			registry.unregister(filePath);
		},
		[registry],
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

	const draftBelongsHere =
		addingDraft !== null && addingDraft.filePath === currentFilePath;

	return (
		<section className="shell-panel shell-viewer-panel">
			<InlineMountsBridge
				registry={registry}
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
						focusHostEditor(currentFilePath);
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
					const snapshot = reviewState.comments.find((c) => c.id === id);
					try {
						await reviewState.remove(id);
					} catch (e) {
						toast.show(`Failed to delete: ${(e as Error).message}`);
						return;
					}
					if (!snapshot) return;
					if (pendingUndoRef.current)
						toast.dismiss(pendingUndoRef.current.toastId);
					const toastId = toast.show("Comment deleted", {
						ttlMs: 6000,
						action: {
							label: "Undo",
							onSelect: () => {
								pendingUndoRef.current = null;
								void reviewState.restore(snapshot);
							},
						},
					});
					pendingUndoRef.current = { toastId, snapshot };
					focusHostEditor(currentFilePath);
				}}
				onCancelEdit={() => focusHostEditor(currentFilePath)}
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
						focusHostEditor(currentFilePath);
					} catch (e) {
						toast.show(`Failed to save: ${(e as Error).message}`);
					}
				}}
				onCancelDraft={() => {
					setAddingDraft(null);
					focusHostEditor(currentFilePath);
				}}
			/>
			{activeSession?.reviewMode === "commits" &&
			commitDetailState.message !== null &&
			commitDetailState.data === null ? (
				<p className="shell-error">{commitDetailState.message}</p>
			) : activeSession?.reviewMode === "commits" && commitDetailState.data ? (
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
				<FileViewer
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
	);
}
