import { describe, it, expect } from "vitest";
import {
	buildFileTree,
	WORKTREE_TREE_ROOT_PATH,
} from "../../../src/features/viewer/logic/build-file-tree";

function entries(paths: string[]) {
	return paths.map((p) => ({ path: p, ignored: false }));
}

describe("buildFileTree", () => {
	it("exports the root sentinel as the empty string", () => {
		expect(WORKTREE_TREE_ROOT_PATH).toBe("");
	});

	it("builds nested directories from flat relative paths", () => {
		const tree = buildFileTree(
			entries(["src/a.ts", "src/nested/b.ts", "README.md"]),
		);
		expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
		const srcDir = tree.find((n) => n.name === "src");
		expect(srcDir?.type).toBe("directory");
		if (srcDir?.type === "directory") {
			expect(srcDir.children.map((c) => c.name)).toEqual(["nested", "a.ts"]);
		}
	});

	it("handles > 5 levels of nesting", () => {
		const tree = buildFileTree(entries(["a/b/c/d/e/f/leaf.ts"]));
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

	it("propagates ignored to file leaves verbatim", () => {
		const tree = buildFileTree([
			{ path: "src/a.ts", ignored: false },
			{ path: ".env", ignored: true },
		]);
		const env = tree.find((n) => n.name === ".env");
		expect(env?.type).toBe("file");
		expect(env?.ignored).toBe(true);
		const src = tree.find((n) => n.name === "src");
		if (src?.type !== "directory") throw new Error("expected directory");
		const a = src.children.find((n) => n.name === "a.ts");
		expect(a?.ignored).toBe(false);
	});

	it("marks a directory ignored iff every descendant is ignored", () => {
		const tree = buildFileTree([
			{ path: "dist/a.js", ignored: true },
			{ path: "dist/sub/b.js", ignored: true },
			{ path: "src/index.ts", ignored: false },
			{ path: "mixed/keep.ts", ignored: false },
			{ path: "mixed/skip.log", ignored: true },
		]);
		const dist = tree.find((n) => n.name === "dist");
		expect(dist?.type).toBe("directory");
		expect(dist?.ignored).toBe(true);
		const src = tree.find((n) => n.name === "src");
		expect(src?.ignored).toBe(false);
		const mixed = tree.find((n) => n.name === "mixed");
		expect(mixed?.ignored).toBe(false);
	});
});
