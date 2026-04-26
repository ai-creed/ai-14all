import { DiffEditor } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useEffect, useRef } from "react";
import type { ResolvedTheme } from "../../lib/useTheme";

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	json: "json",
	css: "css",
	html: "html",
	md: "markdown",
	sh: "shell",
	bash: "shell",
	py: "python",
	rs: "rust",
	go: "go",
	yaml: "yaml",
	yml: "yaml",
	toml: "ini",
	sql: "sql",
};

type Props = {
	path: string;
	content: string;
	originalContent: string;
	modifiedContent: string;
	resolvedTheme: ResolvedTheme;
	onMount?: (filePath: string, editor: MonacoEditor.IStandaloneDiffEditor) => void;
};

function languageFromPath(path: string): string | undefined {
	const ext = path.split(".").pop()?.toLowerCase();
	return ext ? EXTENSION_TO_LANGUAGE[ext] : undefined;
}

export function DiffViewer({
	path,
	originalContent,
	modifiedContent,
	resolvedTheme,
	onMount,
}: Props) {
	const editorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		return () => {
			// Null out models before @monaco-editor/react disposes the editor so
			// DiffEditorWidget can reset cleanly — avoids "TextModel disposed before
			// DiffEditorWidget model got reset" invariant error.
			editorRef.current?.setModel(null);
		};
	}, []);

	return (
		<div className="shell-viewer">
			<div className="shell-viewer__header">
				<div className="shell-viewer__title">{path}</div>
				<div className="shell-viewer__meta">Diff vs HEAD</div>
			</div>
			<DiffEditor
				height="100%"
				language={languageFromPath(path)}
				theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
				original={originalContent}
				modified={modifiedContent}
				options={{
					readOnly: true,
					fontSize: 12,
					renderSideBySide: true,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					glyphMargin: true,
				}}
				onMount={(editor) => {
					editorRef.current = editor;
					onMount?.(path, editor);
				}}
			/>
		</div>
	);
}
