import { describe, it, expect } from "vitest";
import {
	buildFileTree,
	WORKTREE_TREE_ROOT_PATH,
} from "../../../src/features/viewer/build-file-tree";

describe("buildFileTree", () => {
	it("exports the root sentinel as the empty string", () => {
		expect(WORKTREE_TREE_ROOT_PATH).toBe("");
	});

	it("builds nested directories from flat relative paths", () => {
		const tree = buildFileTree(["src/a.ts", "src/nested/b.ts", "README.md"]);
		expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
		const srcDir = tree.find((n) => n.name === "src");
		expect(srcDir?.type).toBe("directory");
		if (srcDir?.type === "directory") {
			expect(srcDir.children.map((c) => c.name)).toEqual(["nested", "a.ts"]);
		}
	});

	it("handles > 5 levels of nesting", () => {
		const tree = buildFileTree(["a/b/c/d/e/f/leaf.ts"]);
		let current = tree[0];
		const expected = ["a", "b", "c", "d", "e", "f", "leaf.ts"];
		let i = 0;
		while (current && i < expected.length - 1) {
			expect(current.name).toBe(expected[i]);
			if (current.type !== "directory") throw new Error("expected directory");
			current = current.children[0];
			i++;
		}
		expect(current?.name).toBe("leaf.ts");
	});
});
