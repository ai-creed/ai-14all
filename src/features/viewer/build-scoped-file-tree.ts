export type ScopedFileTreeNode =
	| {
			type: "directory";
			name: string;
			path: string;
			children: ScopedFileTreeNode[];
	  }
	| {
			type: "file";
			name: string;
			path: string;
	  };

function sortNodes(nodes: ScopedFileTreeNode[]): ScopedFileTreeNode[] {
	return [...nodes].sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "file" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

export function buildScopedFileTree(paths: string[]): ScopedFileTreeNode[] {
	const root: ScopedFileTreeNode[] = [];

	for (const fullPath of paths) {
		const parts = fullPath.split("/");
		let current = root;
		let currentPath = "";

		for (const [index, part] of parts.entries()) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const isFile = index === parts.length - 1;

			if (isFile) {
				current.push({ type: "file", name: part, path: currentPath });
				continue;
			}

			let next = current.find(
				(node): node is Extract<ScopedFileTreeNode, { type: "directory" }> =>
					node.type === "directory" && node.path === currentPath,
			);
			if (!next) {
				next = {
					type: "directory",
					name: part,
					path: currentPath,
					children: [],
				};
				current.push(next);
			}
			current = next.children;
		}
	}

	function sortTree(nodes: ScopedFileTreeNode[]): ScopedFileTreeNode[] {
		return sortNodes(nodes).map((node) =>
			node.type === "directory"
				? { ...node, children: sortTree(node.children) }
				: node,
		);
	}

	return sortTree(root);
}
