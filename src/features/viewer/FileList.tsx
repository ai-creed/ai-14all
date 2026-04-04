import { useEffect, useState } from "react";
import { files } from "../../lib/desktop-client";
import {
	buildScopedFileTree,
	type ScopedFileTreeNode,
} from "./build-scoped-file-tree";

type FileListProps = {
	worktreePath: string;
	scopeRoots: string[];
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
	gitSummaryError?: boolean;
};

function TreeNode({
	node,
	selectedFile,
	onSelect,
}: {
	node: ScopedFileTreeNode;
	selectedFile: string | null;
	onSelect: (relativePath: string) => void;
}) {
	if (node.type === "file") {
		return (
			<button
				type="button"
				className="shell-list__item shell-list__item--tree"
				data-selected={String(selectedFile === node.path)}
				onClick={() => onSelect(node.path)}
			>
				{node.name}
			</button>
		);
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
}: FileListProps) {
	const [fileList, setFileList] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

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

	if (gitSummaryError) {
		return <p className="shell-empty-state">Unable to load Git data.</p>;
	}

	if (scopeRoots.length === 0)
		return (
			<p className="shell-empty-state">
				No nearby files for changed directories.
			</p>
		);
	if (loading) return <p className="shell-empty-state">Loading files…</p>;
	if (error) return <p className="shell-error">Error: {error}</p>;
	if (fileList.length === 0)
		return <p className="shell-empty-state">No files found.</p>;

	const tree = buildScopedFileTree(fileList);

	return (
		<div className="shell-list">
			{tree.map((node) => (
				<TreeNode
					key={node.path}
					node={node}
					selectedFile={selectedFile}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}
