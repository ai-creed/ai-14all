import Editor from "@monaco-editor/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { files } from "../../lib/desktop-client";

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
	const [status, setStatus] = useState<{ kind: "saved" | "error"; message: string } | null>(null);

	const dirty = content !== originalContent;

	const handleClose = useCallback(() => {
		onClose();
	}, [onClose]);

	const handleSave = useCallback(async () => {
		if (!dirty || saving) return;
		setSaving(true);
		setStatus(null);
		const result = await files.save({
			worktreePath,
			relativePath,
			content,
			expectedMtimeMs: mtimeMs,
		});
		setSaving(false);
		if (result.ok) {
			setOriginalContent(content);
			setMtimeMs(result.mtimeMs);
			const when = new Date().toLocaleTimeString();
			setStatus({ kind: "saved", message: `Saved ${when}` });
			return;
		}
		if (result.reason === "mtime-conflict") {
			// conflict handling comes in Task 11 — for now fall through to generic error
		}
		setStatus({ kind: "error", message: errorMessageForReason(result.reason) });
	}, [content, dirty, mtimeMs, relativePath, saving, worktreePath]);

	// Auto-clear status after 3s
	useEffect(() => {
		if (!status) return;
		const id = setTimeout(() => setStatus(null), 3000);
		return () => clearTimeout(id);
	}, [status]);

	return (
		<Dialog.Root
			open={true}
			onOpenChange={(next) => {
				if (!next) handleClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-editor-overlay" />
				<Dialog.Content
					className="shell-editor-modal"
					aria-describedby={undefined}
				>
					<header className="shell-editor-modal__header">
						<Dialog.Title className="shell-editor-modal__title">
							{relativePath}
						</Dialog.Title>
						<button
							type="button"
							className="shell-editor-modal__close"
							aria-label="Close"
							onClick={handleClose}
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
	);
}
