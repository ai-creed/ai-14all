import { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { FileView } from "../../../shared/models/file-view";
import { files } from "../../lib/desktop-client";
import { MarkdownPreviewModal } from "./MarkdownPreviewModal";

interface FileViewerProps {
	worktreePath: string;
	relativePath: string;
}

export function FileViewer({ worktreePath, relativePath }: FileViewerProps) {
	const [fileView, setFileView] = useState<FileView | null>(null);
	const [loading, setLoading] = useState(false);
	const [stale, setStale] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const latestFileViewRef = useRef<FileView | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);

	useEffect(() => {
		latestFileViewRef.current = fileView;
	}, [fileView]);

	useEffect(() => {
		if (!worktreePath || !relativePath) return;
		setLoading(true);
		setMessage(null);
		files
			.read(worktreePath, relativePath)
			.then((view) => {
				setFileView(view);
				setStale(false);
				setMessage(null);
				setLoading(false);
			})
			.catch(() => {
				const previous = latestFileViewRef.current;
				const canPreserve = previous?.path === relativePath;
				if (!canPreserve) setFileView(null);
				setStale(canPreserve);
				setMessage(
					canPreserve
						? "Couldn't refresh file contents. Showing last successful result."
						: "Couldn't load file contents.",
				);
				setLoading(false);
			});
	}, [worktreePath, relativePath, reloadToken]);

	if (loading && !fileView)
		return <p className="shell-empty-state">Loading {relativePath}…</p>;
	if (message && !fileView) return <p className="shell-error">Error: {message}</p>;
	if (!fileView) return null;

	return (
		<div className="shell-viewer">
			{relativePath.endsWith(".md") ? (
				<ContextMenu.Root>
					<ContextMenu.Trigger asChild>
						<div className="shell-viewer__header">
							<div className="shell-viewer__title">{fileView.path}</div>
						</div>
					</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content className="shell-toolbar-menu">
							<ContextMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={() => setPreviewOpen(true)}
							>
								Preview
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			) : (
				<div className="shell-viewer__header">
					<div className="shell-viewer__title">{fileView.path}</div>
				</div>
			)}
			{message && (
				<p className={stale ? "shell-inline-warning" : "shell-error"}>{message}</p>
			)}
			{stale && (
				<button type="button" onClick={() => setReloadToken((x) => x + 1)}>
					Retry
				</button>
			)}
			<Editor
				height="100%"
				language={fileView.language}
				theme="vs-dark"
				value={fileView.content}
				options={{ readOnly: true, fontSize: 12, minimap: { enabled: false } }}
			/>
			{previewOpen && (
				<MarkdownPreviewModal
					worktreePath={worktreePath}
					relativePath={relativePath}
					open={true}
					onClose={() => setPreviewOpen(false)}
				/>
			)}
		</div>
	);
}
