// src/features/viewer/FileList.tsx
import { useEffect, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { files } from "../../lib/desktop-client";
import {
	buildFileTree as buildScopedFileTree,
	type FileTreeNode as ScopedFileTreeNode,
} from "./build-file-tree";
import { MarkdownPreviewModal } from "./MarkdownPreviewModal";

type FileListProps = {
	worktreePath: string;
	scopeRoots: string[];
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
	gitSummaryError?: boolean;
	gitSummaryMessage?: string | null;
};

function TreeNode({
	node,
	selectedFile,
	onSelect,
	onPreview,
}: {
	node: ScopedFileTreeNode;
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
	onPreview: (relativePath: string) => void;
}) {
	if (node.type === "file") {
		const button = (
			<button
				type="button"
				className="shell-list__item shell-list__item--tree"
				data-selected={String(selectedFile === node.path)}
				onClick={() => onSelect(node.path)}
			>
				{node.name}
			</button>
		);

		if (node.name.endsWith(".md")) {
			return (
				<ContextMenu.Root>
					<ContextMenu.Trigger asChild>{button}</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content className="shell-toolbar-menu">
							<ContextMenu.Item
								className="shell-toolbar-menu__item"
								onSelect={() => onPreview(node.path)}
							>
								Preview
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			);
		}

		return button;
	}

	return (
		<div className="shell-tree-group">
			<div className="shell-tree-group__label">{node.name}</div>
			<div className="shell-tree-group__children">
				{node.children.map((child) => (
					<TreeNode
						key={child.path}
						node={child}
						selectedFile={selectedFile}
						onSelect={onSelect}
						onPreview={onPreview}
					/>
				))}
			</div>
		</div>
	);
}

export function FileList({
	worktreePath,
	scopeRoots,
	selectedFile,
	onSelect,
	gitSummaryError,
	gitSummaryMessage,
}: FileListProps) {
	const [fileList, setFileList] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [previewPath, setPreviewPath] = useState<string | null>(null);

	useEffect(() => {
		if (scopeRoots.length === 0) return;
		if (!worktreePath) return;
		setLoading(true);
		setError(null);
		files
			.listScoped(worktreePath, scopeRoots)
			.then((list) => {
				setFileList(list);
				setLoading(false);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			});
	}, [worktreePath, scopeRoots]);

	useEffect(() => {
		setPreviewPath(null);
	}, [worktreePath]);

	if (gitSummaryError) {
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">Unable to load Git data.</p>
			</div>
		);
	}

	if (scopeRoots.length === 0)
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">
					No nearby files for changed directories.
				</p>
			</div>
		);
	if (loading)
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">Loading files…</p>
			</div>
		);
	if (error) return <p className="shell-error">Error: {error}</p>;
	if (fileList.length === 0)
		return (
			<div className="shell-rail__message">
				<p className="shell-empty-state">No files found.</p>
			</div>
		);

	const tree = buildScopedFileTree(fileList);

	return (
		<>
			{gitSummaryMessage && (
				<p className="shell-inline-warning">{gitSummaryMessage}</p>
			)}
			<div className="shell-list">
				{tree.map((node) => (
					<TreeNode
						key={node.path}
						node={node}
						selectedFile={selectedFile}
						onSelect={onSelect}
						onPreview={setPreviewPath}
					/>
				))}
			</div>
			{previewPath !== null && (
				<MarkdownPreviewModal
					worktreePath={worktreePath}
					relativePath={previewPath}
					open={true}
					onClose={() => setPreviewPath(null)}
				/>
			)}
		</>
	);
}
