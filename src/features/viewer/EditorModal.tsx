import Editor from "@monaco-editor/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useMemo } from "react";

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

export function EditorModal({
	worktreePath: _worktreePath,
	relativePath,
	initialContent,
	initialMtimeMs: _initialMtimeMs,
	theme,
	onClose,
}: EditorModalProps) {
	const basename = relativePath.split("/").pop() ?? relativePath;
	const monacoTheme = theme === "light" ? "vs" : "vs-dark";
	const language = useMemo(() => languageForBasename(basename), [basename]);

	const handleClose = useCallback(() => {
		onClose();
	}, [onClose]);

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
							value={initialContent}
							theme={monacoTheme}
							language={language}
							options={MONACO_OPTIONS}
						/>
					</div>
					<footer className="shell-editor-modal__footer">
						{/* save button added in Task 10 */}
					</footer>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
