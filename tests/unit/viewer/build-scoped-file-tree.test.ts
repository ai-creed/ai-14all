import { describe, expect, it } from "vitest";
import { buildScopedFileTree } from "../../../src/features/viewer/build-scoped-file-tree";

describe("buildScopedFileTree", () => {
	it("returns empty array for empty input", () => {
		expect(buildScopedFileTree([])).toEqual([]);
	});

	it("handles root-level files with no directory prefix", () => {
		expect(buildScopedFileTree(["README.md"])).toEqual([
			{ type: "file", name: "README.md", path: "README.md" },
		]);
	});

	it("groups nested files under folder nodes", () => {
		expect(
			buildScopedFileTree([
				"src/index.ts",
				"src/new-file.ts",
				"src/nested/example.ts",
			]),
		).toEqual([
			{
				type: "directory",
				name: "src",
				path: "src",
				children: [
					{ type: "file", name: "index.ts", path: "src/index.ts" },
					{ type: "file", name: "new-file.ts", path: "src/new-file.ts" },
					{
						type: "directory",
						name: "nested",
						path: "src/nested",
						children: [
							{
								type: "file",
								name: "example.ts",
								path: "src/nested/example.ts",
							},
						],
					},
				],
			},
		]);
	});
});
