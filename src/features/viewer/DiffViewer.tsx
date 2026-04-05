import Editor from "@monaco-editor/react";

type Props = {
	path: string;
	content: string;
};

export function DiffViewer({ path, content }: Props) {
	return (
		<div className="shell-viewer">
			<div className="shell-viewer__header">
				<div className="shell-viewer__title">{path}</div>
				<div className="shell-viewer__meta">Diff vs HEAD</div>
			</div>
			<Editor
				height="100%"
				language="plaintext"
				theme="vs-dark"
				value={content}
				options={{ readOnly: true, minimap: { enabled: false } }}
			/>
		</div>
	);
}
