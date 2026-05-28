import { describe, it, expect } from "vitest";
import {
	buildFileTree,
	WORKTREE_TREE_ROOT_PATH,
} from "../../../src/features/viewer/logic/build-file-tree";
import { flattenTreeToRows } from "../../../src/features/viewer/logic/flatten-tree-to-rows";

function toEntries(paths: string[]) {
	return paths.map((p) => ({ path: p, ignored: false }));
}

describe("flattenTreeToRows (no search)", () => {
	it("emits only the root row when only the root is expanded", () => {
		const tree = buildFileTree(toEntries(["src/a.ts", "README.md"]));
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH]),
			changedFiles: new Map(),
			searchTerm: "",
		});
		expect(rows.map((r) => `${r.kind}:${r.path}`)).toEqual([
			"dir:",
			"dir:src",
			"file:README.md",
		]);
	});

	it("recurses into expanded directories only", () => {
		const tree = buildFileTree(
			toEntries(["src/a.ts", "src/nested/b.ts", "README.md"]),
		);
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH, "src"]),
			changedFiles: new Map(),
			searchTerm: "",
		});
		expect(rows.map((r) => `${r.kind}:${r.path}`)).toEqual([
			"dir:",
			"dir:src",
			"dir:src/nested",
			"file:src/a.ts",
			"file:README.md",
		]);
	});

	it("assigns depths — root 0, top-level 1, nested 2+", () => {
		const tree = buildFileTree(toEntries(["src/a.ts"]));
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH, "src"]),
			changedFiles: new Map(),
			searchTerm: "",
		});
		expect(rows.map((r) => [r.kind, r.path, r.depth])).toEqual([
			["dir", "", 0],
			["dir", "src", 1],
			["file", "src/a.ts", 2],
		]);
	});

	it("propagates ignored onto rows", () => {
		const tree = buildFileTree([
			{ path: "src/a.ts", ignored: false },
			{ path: ".env", ignored: true },
		]);
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH, "src"]),
			changedFiles: new Map(),
			searchTerm: "",
		});
		const env = rows.find((r) => r.kind === "file" && r.path === ".env");
		expect(env?.ignored).toBe(true);
		const a = rows.find((r) => r.kind === "file" && r.path === "src/a.ts");
		expect(a?.ignored).toBe(false);
	});

	it("attaches gitStatus from changedFiles map", () => {
		const tree = buildFileTree(toEntries(["src/a.ts"]));
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH, "src"]),
			changedFiles: new Map([["src/a.ts", "M"]]),
			searchTerm: "",
		});
		const fileRow = rows.find(
			(r) => r.kind === "file" && r.path === "src/a.ts",
		);
		expect(fileRow).toMatchObject({ gitStatus: "M" });
	});
});

describe("flattenTreeToRows (search)", () => {
	it("hides non-matching branches, shows matched files, auto-expands ancestors", () => {
		const tree = buildFileTree(
			toEntries(["src/a.ts", "src/nested/deep.ts", "README.md"]),
		);
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH]),
			changedFiles: new Map(),
			searchTerm: "deep",
		});
		expect(rows.map((r) => `${r.kind}:${r.path}`)).toEqual([
			"dir:",
			"dir:src",
			"dir:src/nested",
			"file:src/nested/deep.ts",
		]);
	});

	it("is case-insensitive and matches against full relative path", () => {
		const tree = buildFileTree(toEntries(["src/App.tsx"]));
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH]),
			changedFiles: new Map(),
			searchTerm: "SRC/APP",
		});
		expect(
			rows.some((r) => r.kind === "file" && r.path === "src/App.tsx"),
		).toBe(true);
	});

	it("returns only the root row when search has no matches", () => {
		const tree = buildFileTree(toEntries(["src/a.ts"]));
		const rows = flattenTreeToRows({
			tree,
			rootLabel: "repo",
			expandedPaths: new Set<string>([WORKTREE_TREE_ROOT_PATH]),
			changedFiles: new Map(),
			searchTerm: "zzznomatch",
		});
		expect(rows.map((r) => r.path)).toEqual([""]);
	});
});
