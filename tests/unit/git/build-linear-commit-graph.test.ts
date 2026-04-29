import { describe, it, expect } from "vitest";
import { buildLinearCommitGraph } from "../../../src/features/git/logic/build-linear-commit-graph";

describe("buildLinearCommitGraph", () => {
	it("marks the merge-target row and preserves commit order", () => {
		expect(
			buildLinearCommitGraph([
				{
					sha: "c1",
					shortSha: "c1",
					subject: "feature 1",
					isMergeTarget: false,
				},
				{
					sha: "c2",
					shortSha: "c2",
					subject: "feature 2",
					isMergeTarget: false,
				},
				{
					sha: "b0",
					shortSha: "b0",
					subject: "origin/main",
					isMergeTarget: true,
				},
			]),
		).toEqual([
			expect.objectContaining({ sha: "c1", rowKind: "commit" }),
			expect.objectContaining({ sha: "c2", rowKind: "commit" }),
			expect.objectContaining({ sha: "b0", rowKind: "mergeTarget" }),
		]);
	});
});
