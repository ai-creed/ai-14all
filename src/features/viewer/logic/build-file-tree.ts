export const WORKTREE_TREE_ROOT_PATH = "" as const;

export type FileTreeEntry = {
	path: string;
	ignored: boolean;
};

export type FileTreeNode =
	| {
			type: "directory";
			name: string;
			path: string;
			ignored: boolean;
			children: FileTreeNode[];
	  }
	| {
			type: "file";
			name: string;
			path: string;
			ignored: boolean;
	  };

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
	return [...nodes].sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "file" ? 1 : -1;
		}
		return a.name.localeCompare(b.name);
	});
}

// Builds a tree from worktree entries. A directory node's `ignored` is true iff
// every leaf under it is ignored — used only for visual dimming in the tree row.
export function buildFileTree(entries: FileTreeEntry[]): FileTreeNode[] {
	const root: FileTreeNode[] = [];

	for (const { path: fullPath, ignored } of entries) {
		const parts = fullPath.split("/");
		let current = root;
		let currentPath = "";

		for (const [index, part] of parts.entries()) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const isFile = index === parts.length - 1;

			if (isFile) {
				current.push({
					type: "file",
					name: part,
					path: currentPath,
					ignored,
				});
				continue;
			}

			let next = current.find(
				(node): node is Extract<FileTreeNode, { type: "directory" }> =>
					node.type === "directory" && node.path === currentPath,
			);
			if (!next) {
				next = {
					type: "directory",
					name: part,
					path: currentPath,
					ignored: true, // optimistic — flipped to false if any non-ignored leaf joins
					children: [],
				};
				current.push(next);
			}
			if (!ignored && next.ignored) next.ignored = false;
			current = next.children;
		}
	}

	function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
		return sortNodes(nodes).map((node) =>
			node.type === "directory"
				? { ...node, children: sortTree(node.children) }
				: node,
		);
	}

	return sortTree(root);
}
