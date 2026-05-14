import { describe, expect, it } from "vitest";
import { filterForInlineMount } from "../../../src/features/review/logic/inline-mount-filter";
import type { ReviewComment } from "../../../shared/models/review-comment";

const base: Omit<ReviewComment, "id" | "source" | "commitSha"> = {
	worktreeId: "w1",
	filePath: "a.ts",
	startLine: 1,
	endLine: 1,
	snippet: "x",
	body: "b",
	status: "open",
	createdAt: "2026-05-14T00:00:00.000Z",
	addressedAt: null,
};

function c(id: string, over: Partial<ReviewComment> = {}): ReviewComment {
	return { ...base, id, source: "working-tree", commitSha: null, ...over };
}

describe("filterForInlineMount", () => {
	it("returns empty for files mode", () => {
		const r = filterForInlineMount(
			[c("1"), c("2", { source: "commit", commitSha: "abc" })],
			{ reviewMode: "files", filePath: "a.ts", commitSha: null },
		);
		expect(r.inline).toEqual([]);
		expect(r.otherModes.map((x) => x.id)).toEqual(["1", "2"]);
	});

	it("changes mode keeps only working-tree on current file", () => {
		const r = filterForInlineMount(
			[
				c("1"),
				c("2", { source: "commit", commitSha: "abc" }),
				c("3", { filePath: "b.ts" }),
			],
			{ reviewMode: "changes", filePath: "a.ts", commitSha: null },
		);
		expect(r.inline.map((x) => x.id)).toEqual(["1"]);
		expect(r.otherModes.map((x) => x.id)).toEqual(["2", "3"]);
	});

	it("commits mode keeps only matching sha on current file", () => {
		const r = filterForInlineMount(
			[
				c("1", { source: "commit", commitSha: "abc" }),
				c("2", { source: "commit", commitSha: "xyz" }),
				c("3"),
			],
			{ reviewMode: "commits", filePath: "a.ts", commitSha: "abc" },
		);
		expect(r.inline.map((x) => x.id)).toEqual(["1"]);
		expect(r.otherModes.map((x) => x.id)).toEqual(["2", "3"]);
	});
});
