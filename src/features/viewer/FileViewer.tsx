import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import type { FileView } from "../../../shared/models/file-view";
import { files } from "../../lib/desktop-client";

interface FileViewerProps {
	worktreePath: string;
	relativePath: string;
}

export function FileViewer({ worktreePath, relativePath }: FileViewerProps) {
	const [fileView, setFileView] = useState<FileView | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!worktreePath || !relativePath) return;
		setLoading(true);
		setError(null);
		setFileView(null);
		files
			.read(worktreePath, relativePath)
			.then((view) => {
				setFileView(view);
				setLoading(false);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			});
	}, [worktreePath, relativePath]);

	if (loading)
		return <p className="shell-empty-state">Loading {relativePath}…</p>;
	if (error) return <p className="shell-error">Error: {error}</p>;
	if (!fileView) return null;

	return (
		<div className="shell-viewer">
			<div className="shell-viewer__header">
				<div className="shell-viewer__title">{fileView.path}</div>
			</div>
			<Editor
				height="400px"
				language={fileView.language}
				value={fileView.content}
				options={{ readOnly: true, minimap: { enabled: false } }}
			/>
		</div>
	);
}
