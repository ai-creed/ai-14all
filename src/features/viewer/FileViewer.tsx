import { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { FileView } from "../../../shared/models/file-view";
import { files } from "../../lib/desktop-client";
import type { ResolvedTheme } from "../../lib/use-theme";
import { MarkdownPreviewModal } from "./MarkdownPreviewModal";
import { isEditable } from "../../../shared/editor/editable-files";

interface FileViewerProps {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
	resolvedTheme: ResolvedTheme;
	onEditFile?: (path: string) => void;
}

export function FileViewer({
	workspaceId,
	worktreeId,
	relativePath,
	resolvedTheme,
	onEditFile,
}: FileViewerProps) {
	const [fileView, setFileView] = useState<FileView | null>(null);
	const [loading, setLoading] = useState(false);
	const [stale, setStale] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);
	const latestFileViewRef = useRef<FileView | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
	const previewActionRef = useRef<{ dispose(): void } | null>(null);

	useEffect(() => {
		latestFileViewRef.current = fileView;
	}, [fileView]);

	useEffect(() => {
		setPreviewOpen(false);
	}, [workspaceId, worktreeId, relativePath]);

	useEffect(() => {
		if (!editorRef.current) return;
		previewActionRef.current?.dispose();
		previewActionRef.current = null;
		if (relativePath.endsWith(".md")) {
			previewActionRef.current = editorRef.current.addAction({
				id: "markdown-preview",
				label: "Preview",
				contextMenuGroupId: "navigation",
				contextMenuOrder: 1.5,
				run: () => setPreviewOpen(true),
			});
		}
		return () => {
			previewActionRef.current?.dispose();
			previewActionRef.current = null;
		};
	}, [relativePath]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!workspaceId || !worktreeId || !relativePath) return;
		setLoading(true);
		setMessage(null);
		files
			.read(workspaceId, worktreeId, relativePath)
			.then((result) => {
				if (result.ok) {
					setFileView(result.view);
					setStale(false);
					setMessage(null);
					setLoading(false);
					return;
				}
				const previous = latestFileViewRef.current;
				const canPreserve = previous?.path === relativePath;
				if (!canPreserve) setFileView(null);
				setStale(canPreserve);
				const message =
					result.reason.kind === "too-large"
						? `File too large to display (${result.reason.size.toLocaleString()} bytes).`
						: result.reason.kind === "binary"
							? "Binary file — preview not available."
							: result.reason.kind === "not-found"
								? "File not found."
								: "Couldn't load file contents.";
				setMessage(message);
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
	}, [workspaceId, worktreeId, relativePath, reloadToken]);

	if (loading && !fileView)
		return <p className="shell-empty-state">Loading {relativePath}…</p>;
	if (message && !fileView)
		return <p className="shell-error">Error: {message}</p>;
	if (!fileView) return null;

	const basename = relativePath.split("/").pop() ?? "";
	const isMarkdown = relativePath.endsWith(".md");
	const canEdit = isEditable(basename);
	const hasMenuItems = isMarkdown || (canEdit && !!onEditFile);

	return (
		<div className="shell-viewer" data-readonly-editor="true">
			{hasMenuItems ? (
				<ContextMenu.Root>
					<ContextMenu.Trigger asChild>
						<div className="shell-viewer__header">
							<div className="shell-viewer__title">{fileView.path}</div>
						</div>
					</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content className="shell-toolbar-menu">
							{isMarkdown && (
								<ContextMenu.Item
									className="shell-toolbar-menu__item"
									onSelect={() => setPreviewOpen(true)}
								>
									Preview
								</ContextMenu.Item>
							)}
							{canEdit && onEditFile && (
								<ContextMenu.Item
									className="shell-toolbar-menu__item"
									onSelect={() => onEditFile(relativePath)}
								>
									Edit
								</ContextMenu.Item>
							)}
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			) : (
				<div className="shell-viewer__header">
					<div className="shell-viewer__title">{fileView.path}</div>
				</div>
			)}
			{message && (
				<p className={stale ? "shell-inline-warning" : "shell-error"}>
					{message}
				</p>
			)}
			{stale && (
				<button type="button" onClick={() => setReloadToken((x) => x + 1)}>
					Retry
				</button>
			)}
			<Editor
				height="100%"
				language={fileView.language}
				theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
				value={fileView.content}
				options={{ readOnly: true, fontSize: 12, minimap: { enabled: false } }}
				onMount={(editor) => {
					editorRef.current = editor;
					if (relativePath.endsWith(".md")) {
						previewActionRef.current = editor.addAction({
							id: "markdown-preview",
							label: "Preview",
							contextMenuGroupId: "navigation",
							contextMenuOrder: 1.5,
							run: () => setPreviewOpen(true),
						});
					}
				}}
			/>
			{previewOpen && (
				<MarkdownPreviewModal
					workspaceId={workspaceId}
					worktreeId={worktreeId}
					relativePath={relativePath}
					open={true}
					onClose={() => setPreviewOpen(false)}
				/>
			)}
		</div>
	);
}
