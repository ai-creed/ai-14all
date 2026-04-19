import Editor from "@monaco-editor/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { files } from "../../lib/desktop-client";
import { ConfirmCloseDialog } from "./ConfirmCloseDialog";
import { SaveConflictDialog } from "./SaveConflictDialog";

type ResolvedTheme = "light" | "dark";

export type EditorModalProps = {
	worktreePath: string;
	relativePath: string;
	initialContent: string;
	initialMtimeMs: number;
	theme: ResolvedTheme;
	onClose: () => void;
};

const MONACO_OPTIONS = {
	fontSize: 11,
	minimap: { enabled: false },
	lineNumbers: "on" as const,
	quickSuggestions: false,
	suggestOnTriggerCharacters: false,
	wordBasedSuggestions: "off" as const,
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

function errorMessageForReason(reason: string): string {
	switch (reason) {
		case "permission-denied":
			return "Permission denied";
		case "disk-full":
			return "Disk full";
		case "not-found":
			return "File no longer exists";
		default:
			return "Save failed";
	}
}

export function EditorModal({
	worktreePath,
	relativePath,
	initialContent,
	initialMtimeMs,
	theme,
	onClose,
}: EditorModalProps) {
	const basename = relativePath.split("/").pop() ?? relativePath;
	const monacoTheme = theme === "light" ? "vs" : "vs-dark";
	const language = useMemo(() => languageForBasename(basename), [basename]);

	const [originalContent, setOriginalContent] = useState(initialContent);
	const [content, setContent] = useState(initialContent);
	const [mtimeMs, setMtimeMs] = useState(initialMtimeMs);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<{
		kind: "saved" | "error";
		message: string;
	} | null>(null);
	const [conflict, setConflict] = useState<{ currentMtimeMs: number } | null>(
		null,
	);
	const [confirmClose, setConfirmClose] = useState(false);
	const [pendingReload, setPendingReload] = useState(false);

	const dirty = content !== originalContent;

	const dirtyRef = useRef(dirty);
	useEffect(() => {
		dirtyRef.current = dirty;
	}, [dirty]);

	const nestedDialogOpen = conflict !== null || confirmClose;

	const handleSave = useCallback(async (): Promise<boolean> => {
		if (!dirty || saving) return false;
		setSaving(true);
		setStatus(null);
		try {
			const result = await files.save({
				worktreePath,
				relativePath,
				content,
				expectedMtimeMs: mtimeMs,
			});
			if (result.ok) {
				setOriginalContent(content);
				setMtimeMs(result.mtimeMs);
				const when = new Date().toLocaleTimeString();
				setStatus({ kind: "saved", message: `Saved ${when}` });
				return true;
			}
			if (result.reason === "mtime-conflict") {
				setConflict({ currentMtimeMs: result.currentMtimeMs });
				return false;
			}
			setStatus({ kind: "error", message: errorMessageForReason(result.reason) });
			return false;
		} catch {
			setStatus({ kind: "error", message: "Save failed: unexpected error" });
			return false;
		} finally {
			setSaving(false);
		}
	}, [content, dirty, mtimeMs, relativePath, saving, worktreePath]);

	const handleOverwrite = useCallback(async () => {
		if (!conflict) return;
		const expected = conflict.currentMtimeMs;
		setConflict(null);
		setSaving(true);
		try {
			const result = await files.save({
				worktreePath,
				relativePath,
				content,
				expectedMtimeMs: expected,
			});
			if (result.ok) {
				setOriginalContent(content);
				setMtimeMs(result.mtimeMs);
				setStatus({ kind: "saved", message: `Saved ${new Date().toLocaleTimeString()}` });
			} else {
				setStatus({ kind: "error", message: errorMessageForReason(result.reason) });
			}
		} catch {
			setStatus({ kind: "error", message: "Save failed: unexpected error" });
		} finally {
			setSaving(false);
		}
	}, [conflict, content, relativePath, worktreePath]);

	const executeReload = useCallback(async () => {
		const result = await files.openForEdit(worktreePath, relativePath);
		if (result.ok) {
			setOriginalContent(result.content);
			setContent(result.content);
			setMtimeMs(result.mtimeMs);
			setStatus({ kind: "saved", message: "Reloaded from disk" });
		} else {
			setStatus({ kind: "error", message: errorMessageForReason(result.reason) });
		}
	}, [relativePath, worktreePath]);

	const handleReload = useCallback(async () => {
		setConflict(null);
		if (dirty) {
			setPendingReload(true);
			setConfirmClose(true);
			return;
		}
		await executeReload();
	}, [dirty, executeReload]);

	const handleCancelConflict = useCallback(() => setConflict(null), []);

	const requestClose = useCallback(() => {
		if (dirty) {
			setConfirmClose(true);
			return;
		}
		onClose();
	}, [dirty, onClose]);

	const confirmSaveThenClose = useCallback(async () => {
		const saved = await handleSave();
		setConfirmClose(false);
		if (!saved) return;
		if (pendingReload) {
			setPendingReload(false);
			await executeReload();
			return;
		}
		onClose();
	}, [executeReload, handleSave, onClose, pendingReload]);

	const confirmDiscard = useCallback(async () => {
		setConfirmClose(false);
		if (pendingReload) {
			setPendingReload(false);
			await executeReload();
			return;
		}
		onClose();
	}, [executeReload, onClose, pendingReload]);

	const cancelConfirmClose = useCallback(() => {
		setConfirmClose(false);
		setPendingReload(false);
	}, []);

	const onDialogKeyDown = useCallback<React.KeyboardEventHandler<HTMLElement>>(
		(e) => {
			if (nestedDialogOpen) return;
			const meta = e.metaKey || e.ctrlKey;
			if (!meta) return;
			if (e.key === "s") {
				e.preventDefault();
				e.stopPropagation();
				if (dirty && !saving) void handleSave();
				return;
			}
			if (e.key === "e") {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		[dirty, handleSave, nestedDialogOpen, saving],
	);

	// Auto-clear status after 3s
	useEffect(() => {
		if (!status) return;
		const id = setTimeout(() => setStatus(null), 3000);
		return () => clearTimeout(id);
	}, [status]);

	return (
		<>
			<Dialog.Root
				open={true}
				onOpenChange={(next) => {
					if (!next) requestClose();
				}}
			>
				<Dialog.Portal>
					<Dialog.Overlay className="shell-editor-overlay" />
					<Dialog.Content
						className="shell-editor-modal"
						aria-describedby={undefined}
						onKeyDownCapture={onDialogKeyDown}
					>
						<header className="shell-editor-modal__header">
							<Dialog.Title className="shell-editor-modal__title">
								{relativePath}
							</Dialog.Title>
							<button
								type="button"
								className="shell-editor-modal__close"
								aria-label="Close"
								onClick={requestClose}
							>
								Close
							</button>
						</header>
						<div className="shell-editor-modal__body">
							<Editor
								value={content}
								onChange={(v) => setContent(v ?? "")}
								theme={monacoTheme}
								language={language}
								options={MONACO_OPTIONS}
							/>
						</div>
						<footer className="shell-editor-modal__footer">
							<span
								className={`shell-editor-modal__status shell-editor-modal__status--${status?.kind ?? "idle"}`}
							>
								{status?.message ?? ""}
							</span>
							<button
								type="button"
								className="shell-btn shell-btn--primary"
								disabled={!dirty || saving}
								onClick={() => void handleSave()}
							>
								{saving ? "Saving…" : "Save"}
							</button>
						</footer>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
			<SaveConflictDialog
				open={conflict !== null}
				onReload={handleReload}
				onOverwrite={handleOverwrite}
				onCancel={handleCancelConflict}
			/>
			<ConfirmCloseDialog
				open={confirmClose}
				onSave={confirmSaveThenClose}
				onDiscard={confirmDiscard}
				onCancel={cancelConfirmClose}
			/>
		</>
	);
}
