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
import { isEditable } from "../../../../shared/editor/editable-files";
import { ConfirmCloseDialog } from "./ConfirmCloseDialog";
import { EditorDirtyBar } from "./EditorDirtyBar";
import { SaveConflictDialog } from "./SaveConflictDialog";
import { registerInlineEditor } from "../inline-editor-registry";

type MonacoEditorInstance = Parameters<OnMount>[0];

export type InlineEditorHandle = {
	requestSwitch: () => Promise<"proceed" | "cancel">;
};

export type InlineEditorProps = {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
	resolvedTheme: ResolvedTheme;
	onSaved?: () => void;
	onDirtyChange?: (dirty: boolean) => void;
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

function languageForBasename(basename: string): string {
	const lower = basename.toLowerCase();
	if (lower.endsWith(".md")) return "markdown";
	if (lower.endsWith(".json")) return "json";
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
	if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
	if (
		lower.endsWith(".js") ||
		lower.endsWith(".jsx") ||
		lower.endsWith(".mjs") ||
		lower.endsWith(".cjs")
	)
		return "javascript";
	if (lower.endsWith(".css") || lower.endsWith(".scss")) return "css";
	if (lower.endsWith(".html")) return "html";
	if (lower.endsWith(".sh")) return "shell";
	if (lower.endsWith(".py")) return "python";
	if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
	if (
		lower.endsWith(".cpp") ||
		lower.endsWith(".cc") ||
		lower.endsWith(".cxx") ||
		lower.endsWith(".hpp")
	)
		return "cpp";
	if (
		lower.endsWith(".toml") ||
		lower.endsWith(".ini") ||
		lower.endsWith(".conf") ||
		lower.endsWith(".env")
	)
		return "ini";
	if (lower.endsWith(".xml")) return "xml";
	return "plaintext";
}

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

		const handleMount: OnMount = useCallback((editor) => {
			editorRef.current = editor;
		}, []);

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
							<span aria-hidden="true">{previewing ? "✏" : "👁"}</span>
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
