import Editor, { type OnMount } from "@monaco-editor/react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { files } from "../../../lib/desktop-client";
import { app } from "../../../lib/desktop-client";
import type { ResolvedTheme } from "../../../lib/use-theme";
import { Icon } from "@/components/ui/icon";
import { isEditable } from "../../../../shared/editor/editable-files";
import { languageForBasename } from "../logic/language-for-basename.js";
import { ConfirmCloseDialog } from "./ConfirmCloseDialog";
import { EditorDirtyBar } from "./EditorDirtyBar";
import { SaveConflictDialog } from "./SaveConflictDialog";
import { registerInlineEditor } from "../inline-editor-registry";

type MonacoEditorInstance = Parameters<OnMount>[0];

export type InlineEditorHandle = {
	requestSwitch: () => Promise<"proceed" | "cancel">;
};

export type InlineEditorPendingReveal = {
	line: number;
	column?: number;
	capturedAt: number;
};

export type InlineEditorProps = {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
	resolvedTheme: ResolvedTheme;
	onSaved?: () => void;
	onDirtyChange?: (dirty: boolean) => void;
	pendingReveal?: InlineEditorPendingReveal | null;
	onConsumePendingReveal?: () => void;
};

const MONACO_OPTIONS = {
	fontSize: 12,
	minimap: { enabled: false },
	lineNumbers: "on" as const,
	quickSuggestions: false,
	suggestOnTriggerCharacters: false,
	wordBasedSuggestions: "off" as const,
};

type LoadState =
	| { kind: "loading" }
	| {
			kind: "editable";
			content: string;
			mtimeMs: number;
			language: string;
	  }
	| { kind: "readonly"; content: string; language: string }
	| {
			kind: "error";
			message: string;
			reason: string;
	  };

function describeOpenForEditReason(reason: string): string {
	switch (reason) {
		case "not-found":
			return "File not found.";
		case "binary":
			return "Binary file — editor not available.";
		case "too-large":
			return "File too large to edit.";
		case "not-editable":
			return "File type not editable.";
		case "permission-denied":
			return "Permission denied.";
		case "path-escape":
			return "Refused: path escapes the worktree.";
		default:
			return "Couldn't open the file.";
	}
}

function describeReadReason(kind: string, size?: number): string {
	if (kind === "too-large")
		return `File too large to display${
			size ? ` (${size.toLocaleString()} bytes)` : ""
		}.`;
	if (kind === "binary") return "Binary file — preview not available.";
	if (kind === "not-found") return "File not found.";
	return "Couldn't load file contents.";
}

function describeSaveReason(reason: string): string {
	switch (reason) {
		case "permission-denied":
			return "Permission denied.";
		case "disk-full":
			return "Disk full.";
		case "not-found":
			return "File no longer exists.";
		case "not-editable":
			return "File type not editable.";
		case "path-escape":
			return "Refused: path escapes the worktree.";
		default:
			return "Save failed.";
	}
}

// Files-mode in-place editor. When the file basename is whitelisted, mounts
// Monaco editable and tracks dirty state against the loaded pristine content +
// mtime. Otherwise mounts read-only via files.read. ⌘S saves through
// files.save with the loaded mtime; mtime conflict opens SaveConflictDialog.
// The exposed requestSwitch handle lets the parent gate file/worktree
// switches when the buffer is dirty.
export const InlineEditor = forwardRef<InlineEditorHandle, InlineEditorProps>(
	function InlineEditor(
		{
			workspaceId,
			worktreeId,
			relativePath,
			resolvedTheme,
			onSaved,
			onDirtyChange,
			pendingReveal,
			onConsumePendingReveal,
		},
		ref,
	) {
		const basename = useMemo(
			() => relativePath.split("/").pop() ?? relativePath,
			[relativePath],
		);
		const canEdit = useMemo(() => isEditable(basename), [basename]);
		const monacoTheme = resolvedTheme === "light" ? "vs" : "vs-dark";

		const [load, setLoad] = useState<LoadState>({ kind: "loading" });
		const [pristineContent, setPristineContent] = useState("");
		const [pristineMtimeMs, setPristineMtimeMs] = useState(0);
		const [buffer, setBuffer] = useState("");
		const [saving, setSaving] = useState(false);
		const [conflict, setConflict] = useState<{ currentMtimeMs: number } | null>(
			null,
		);
		const [confirmSwitch, setConfirmSwitch] = useState(false);
		const [previewing, setPreviewing] = useState(false);
		const [status, setStatus] = useState<{
			kind: "saved" | "error";
			message: string;
		} | null>(null);

		// Reset preview when navigating to a different file.
		useEffect(() => {
			setPreviewing(false);
		}, [relativePath]);
		const editorRef = useRef<MonacoEditorInstance | null>(null);
		const switchResolverRef = useRef<
			((decision: "proceed" | "cancel") => void) | null
		>(null);

		const dirty = load.kind === "editable" && buffer !== pristineContent;

		// Push dirty bit to main + notify parent on every transition.
		useEffect(() => {
			onDirtyChange?.(dirty);
			void app.setEditorDirty({
				workspaceId,
				worktreeId,
				relativePath,
				dirty,
			});
			return () => {
				// On unmount or key change, clear the dirty bit for this file so the
				// close-gate doesn't keep blocking a stale buffer.
				void app.setEditorDirty({
					workspaceId,
					worktreeId,
					relativePath,
					dirty: false,
				});
			};
		}, [dirty, workspaceId, worktreeId, relativePath, onDirtyChange]);

		// Initial load, keyed on file identity.
		useEffect(() => {
			let cancelled = false;
			setLoad({ kind: "loading" });
			setBuffer("");
			setPristineContent("");
			setPristineMtimeMs(0);
			setStatus(null);
			setConflict(null);
			setConfirmSwitch(false);

			(async () => {
				if (canEdit) {
					try {
						const r = await files.openForEdit(
							workspaceId,
							worktreeId,
							relativePath,
						);
						if (cancelled) return;
						if (r.ok) {
							setPristineContent(r.content);
							setPristineMtimeMs(r.mtimeMs);
							setBuffer(r.content);
							setLoad({
								kind: "editable",
								content: r.content,
								mtimeMs: r.mtimeMs,
								language: languageForBasename(basename),
							});
						} else {
							setLoad({
								kind: "error",
								message: describeOpenForEditReason(r.reason),
								reason: r.reason,
							});
						}
					} catch {
						if (!cancelled)
							setLoad({
								kind: "error",
								message: "Couldn't open the file.",
								reason: "exception",
							});
					}
				} else {
					try {
						const r = await files.read(workspaceId, worktreeId, relativePath);
						if (cancelled) return;
						if (r.ok) {
							setLoad({
								kind: "readonly",
								content: r.view.content,
								language: r.view.language,
							});
						} else {
							setLoad({
								kind: "error",
								message: describeReadReason(
									r.reason.kind,
									r.reason.kind === "too-large" ? r.reason.size : undefined,
								),
								reason: r.reason.kind,
							});
						}
					} catch {
						if (!cancelled)
							setLoad({
								kind: "error",
								message: "Couldn't load file contents.",
								reason: "exception",
							});
					}
				}
			})();

			return () => {
				cancelled = true;
			};
		}, [workspaceId, worktreeId, relativePath, basename, canEdit]);

		const [editorReady, setEditorReady] = useState(false);

		const handleMount: OnMount = useCallback((editor, monacoInstance) => {
			editorRef.current = editor;
			setEditorReady(true);
			// Code nav returns all ranked definitions; jump to the top one on
			// cmd+click/F12 instead of opening the multi-result peek (⌥F12 still
			// peeks the full list). Monaco peeks on >1 result by default.
			editor.updateOptions?.({
				gotoLocation: {
					multipleDefinitions: "goto",
					multipleDeclarations: "goto",
					multipleTypeDefinitions: "goto",
					multipleImplementations: "goto",
				},
			});
			// E2E hook: expose the live editor instance so Playwright can drive
			// the same Monaco actions cmd+click invokes (revealDefinition) —
			// monaco's module singleton is loaded by @monaco-editor/react and
			// not the same as code-nav's bundle, so an editor handle is the
			// only reliable bridge. Harmless in prod.
			if (typeof window !== "undefined") {
				(
					window as unknown as {
						__codeNavTestInlineEditor?: typeof editor;
					}
				).__codeNavTestInlineEditor = editor;
			}
			// Register code-nav providers + cortex:// openers on the EXACT monaco
			// instance this editor uses (the second onMount arg). That is the
			// singleton whose StandaloneServices the gotoDefinition / openLink
			// actions resolve, so our handlers actually fire. Lazy-imported so
			// jsdom App tests don't pull monaco internals at import time.
			void import("../../code-nav/monaco/register")
				.then(({ ensureCortexNavRegistered }) =>
					ensureCortexNavRegistered(monacoInstance),
				)
				.catch(() => {});
		}, []);

		// Apply a one-shot pendingReveal once Monaco is ready and the file has
		// loaded. Mirrors the pendingCommentJump pattern in App.tsx — reveal
		// then dispatch consume so the same target isn't replayed on remount.
		const fileLoaded = load.kind === "editable" || load.kind === "readonly";
		useEffect(() => {
			if (!editorReady || !fileLoaded || !pendingReveal) return;
			const editor = editorRef.current;
			if (!editor) return;
			editor.revealLineInCenter(pendingReveal.line);
			if (pendingReveal.column !== undefined) {
				editor.setPosition({
					lineNumber: pendingReveal.line,
					column: pendingReveal.column,
				});
				editor.focus();
			}
			onConsumePendingReveal?.();
		}, [editorReady, fileLoaded, pendingReveal, onConsumePendingReveal]);

		const runSave = useCallback(
			async (expectedMtimeMs: number, content: string): Promise<boolean> => {
				if (saving) return false;
				setSaving(true);
				setStatus(null);
				try {
					const result = await files.save({
						workspaceId,
						worktreeId,
						relativePath,
						content,
						expectedMtimeMs,
					});
					if (result.ok) {
						setPristineContent(content);
						setPristineMtimeMs(result.mtimeMs);
						setBuffer(content);
						setStatus({
							kind: "saved",
							message: `Saved ${new Date().toLocaleTimeString()}`,
						});
						onSaved?.();
						return true;
					}
					if (result.reason === "mtime-conflict") {
						setConflict({ currentMtimeMs: result.currentMtimeMs });
						return false;
					}
					setStatus({
						kind: "error",
						message: describeSaveReason(result.reason),
					});
					return false;
				} catch {
					setStatus({
						kind: "error",
						message: "Save failed: unexpected error",
					});
					return false;
				} finally {
					setSaving(false);
				}
			},
			[onSaved, relativePath, saving, workspaceId, worktreeId],
		);

		const handleSave = useCallback(async (): Promise<boolean> => {
			if (load.kind !== "editable") return false;
			const latest = editorRef.current?.getValue() ?? buffer;
			if (latest === pristineContent) return false;
			return runSave(pristineMtimeMs, latest);
		}, [buffer, load.kind, pristineContent, pristineMtimeMs, runSave]);

		const handleOverwrite = useCallback(async () => {
			if (!conflict) return;
			const latest = editorRef.current?.getValue() ?? buffer;
			const expected = conflict.currentMtimeMs;
			setConflict(null);
			await runSave(expected, latest);
		}, [buffer, conflict, runSave]);

		const handleReloadFromConflict = useCallback(async () => {
			setConflict(null);
			try {
				const r = await files.openForEdit(
					workspaceId,
					worktreeId,
					relativePath,
				);
				if (r.ok) {
					setPristineContent(r.content);
					setPristineMtimeMs(r.mtimeMs);
					setBuffer(r.content);
					setStatus({ kind: "saved", message: "Reloaded from disk" });
				} else {
					setStatus({
						kind: "error",
						message: describeOpenForEditReason(r.reason),
					});
				}
			} catch {
				setStatus({
					kind: "error",
					message: "Reload failed: unexpected error",
				});
			}
		}, [relativePath, workspaceId, worktreeId]);

		const handleDiscard = useCallback(() => {
			setBuffer(pristineContent);
			// Re-apply Monaco value in case editor model is ahead of React state.
			editorRef.current?.setValue?.(pristineContent);
		}, [pristineContent]);

		const requestSwitch = useCallback(
			() =>
				new Promise<"proceed" | "cancel">((resolve) => {
					if (!dirty) {
						resolve("proceed");
						return;
					}
					switchResolverRef.current = resolve;
					setConfirmSwitch(true);
				}),
			[dirty],
		);

		useImperativeHandle(ref, () => ({ requestSwitch }), [requestSwitch]);

		// Register in the close-gate-facing registry so App can drive Save/Discard
		// for every mounted editor when the user tries to close the window.
		useEffect(() => {
			return registerInlineEditor(
				{ workspaceId, worktreeId, relativePath },
				{ requestSwitch },
			);
		}, [workspaceId, worktreeId, relativePath, requestSwitch]);

		const handleSwitchSave = useCallback(async () => {
			const ok = await handleSave();
			setConfirmSwitch(false);
			switchResolverRef.current?.(ok ? "proceed" : "cancel");
			switchResolverRef.current = null;
		}, [handleSave]);

		const handleSwitchDiscard = useCallback(() => {
			handleDiscard();
			setConfirmSwitch(false);
			switchResolverRef.current?.("proceed");
			switchResolverRef.current = null;
		}, [handleDiscard]);

		const handleSwitchCancel = useCallback(() => {
			setConfirmSwitch(false);
			switchResolverRef.current?.("cancel");
			switchResolverRef.current = null;
		}, []);

		const onKeyDown = useCallback<React.KeyboardEventHandler<HTMLDivElement>>(
			(e) => {
				const meta = e.metaKey || e.ctrlKey;
				if (!meta) return;
				if (e.key.toLowerCase() === "s") {
					e.preventDefault();
					e.stopPropagation();
					if (load.kind === "editable") void handleSave();
				}
			},
			[handleSave, load.kind],
		);

		// Auto-clear status after 3s.
		useEffect(() => {
			if (!status) return;
			const id = setTimeout(() => setStatus(null), 3000);
			return () => clearTimeout(id);
		}, [status]);

		if (load.kind === "loading") {
			return (
				<p className="shell-empty-state" data-testid="inline-editor-loading">
					Loading {relativePath}…
				</p>
			);
		}

		if (load.kind === "error") {
			return (
				<div
					className="shell-viewer"
					data-testid="inline-editor-error"
					data-reason={load.reason}
				>
					<div className="shell-viewer__header">
						<div className="shell-viewer__title">{relativePath}</div>
					</div>
					<p className="shell-error">{load.message}</p>
				</div>
			);
		}

		const readOnly = load.kind !== "editable";
		const value = readOnly ? load.content : buffer;
		const language = load.language;
		const isMarkdown = relativePath.endsWith(".md");

		return (
			<div
				className="shell-viewer shell-inline-editor"
				data-testid="inline-editor"
				data-readonly={readOnly ? "true" : "false"}
				data-preview={previewing ? "true" : "false"}
				onKeyDownCapture={onKeyDown}
			>
				<div className="shell-viewer__header">
					<div className="shell-viewer__title">{relativePath}</div>
					{readOnly && (
						<span className="shell-inline-editor__readonly-chip">
							read-only
						</span>
					)}
					{status && (
						<span
							className={`shell-inline-editor__status shell-inline-editor__status--${status.kind}`}
							role="status"
						>
							{status.message}
						</span>
					)}
					{isMarkdown && (
						<button
							type="button"
							className="shell-inline-editor__preview-btn"
							onClick={() => setPreviewing((p) => !p)}
							title={
								previewing
									? "Edit raw markdown"
									: "Preview rendered markdown in place"
							}
							aria-label={
								previewing
									? "Edit raw markdown"
									: "Preview rendered markdown in place"
							}
							aria-pressed={previewing}
						>
							<span aria-hidden="true">
								{previewing ? (
									<Icon name="edit" fallback="✏" />
								) : (
									<Icon name="eye" />
								)}
							</span>
							<span>{previewing ? "Edit" : "Preview"}</span>
						</button>
					)}
				</div>
				{previewing && isMarkdown ? (
					<div className="shell-inline-editor__preview">
						<div className="shell-inline-editor__preview-body">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[rehypeHighlight]}
							>
								{value}
							</ReactMarkdown>
						</div>
					</div>
				) : (
					<Editor
						height="100%"
						language={language}
						theme={monacoTheme}
						value={value}
						onChange={(v) => {
							if (!readOnly) setBuffer(v ?? "");
						}}
						onMount={handleMount}
						options={{ ...MONACO_OPTIONS, readOnly }}
					/>
				)}
				{dirty && (
					<div className="shell-inline-editor__bar-slot">
						<EditorDirtyBar
							onSave={() => void handleSave()}
							onDiscard={handleDiscard}
							currentLength={buffer.length}
							pristineLength={pristineContent.length}
						/>
					</div>
				)}
				<SaveConflictDialog
					open={conflict !== null}
					onReload={() => void handleReloadFromConflict()}
					onOverwrite={() => void handleOverwrite()}
					onCancel={() => setConflict(null)}
				/>
				<ConfirmCloseDialog
					open={confirmSwitch}
					onSave={() => void handleSwitchSave()}
					onDiscard={handleSwitchDiscard}
					onCancel={handleSwitchCancel}
				/>
			</div>
		);
	},
);
