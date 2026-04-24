import type { GitChangeStatus } from "../../../shared/models/git-change";
import { type FileTreeNode, WORKTREE_TREE_ROOT_PATH } from "./build-file-tree";

export type VisibleRow =
	| {
			kind: "dir";
			path: string;
			name: string;
			depth: number;
			expanded: boolean;
			hasChildren: boolean;
	  }
	| {
			kind: "file";
			path: string;
			name: string;
			depth: number;
			gitStatus?: GitChangeStatus;
	  };

export type FlattenTreeInput = {
	tree: FileTreeNode[];
	rootLabel: string;
	expandedPaths: Set<string>;
	changedFiles: Map<string, GitChangeStatus>;
	searchTerm: string;
};

function collectMatchAncestors(
	paths: string[],
	term: string,
): { matches: Set<string>; ancestors: Set<string> } {
	const matches = new Set<string>();
	const ancestors = new Set<string>();
	for (const p of paths) {
		if (!p.toLowerCase().includes(term)) continue;
		matches.add(p);
		const parts = p.split("/");
		parts.pop();
		let acc = "";
		for (const part of parts) {
			acc = acc ? `${acc}/${part}` : part;
			ancestors.add(acc);
		}
	}
	return { matches, ancestors };
}

function collectAllFilePaths(tree: FileTreeNode[], out: string[]): void {
	for (const node of tree) {
		if (node.type === "file") out.push(node.path);
		else collectAllFilePaths(node.children, out);
	}
}

export function flattenTreeToRows(input: FlattenTreeInput): VisibleRow[] {
	const rows: VisibleRow[] = [];
	const term = input.searchTerm.trim().toLowerCase();
	const searching = term.length > 0;

	let matches: Set<string> | null = null;
	let ancestors: Set<string> | null = null;
	if (searching) {
		const all: string[] = [];
		collectAllFilePaths(input.tree, all);
		const r = collectMatchAncestors(all, term);
		matches = r.matches;
		ancestors = r.ancestors;
	}

	const rootExpanded = searching
		? true
		: input.expandedPaths.has(WORKTREE_TREE_ROOT_PATH);
	rows.push({
		kind: "dir",
		path: WORKTREE_TREE_ROOT_PATH,
		name: input.rootLabel,
		depth: 0,
		expanded: rootExpanded,
		hasChildren: input.tree.length > 0,
	});
	if (!rootExpanded) return rows;

	function walk(nodes: FileTreeNode[], depth: number): void {
		for (const node of nodes) {
			if (node.type === "file") {
				if (searching && !matches!.has(node.path)) continue;
				rows.push({
					kind: "file",
					path: node.path,
					name: node.name,
					depth,
					gitStatus: input.changedFiles.get(node.path),
				});
				continue;
			}
			if (searching && !ancestors!.has(node.path)) continue;
			const expanded = searching ? true : input.expandedPaths.has(node.path);
			rows.push({
				kind: "dir",
				path: node.path,
				name: node.name,
				depth,
				expanded,
				hasChildren: node.children.length > 0,
			});
			if (expanded) walk(node.children, depth + 1);
		}
	}

	walk(input.tree, 1);
	return rows;
}
