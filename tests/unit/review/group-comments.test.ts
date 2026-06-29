import { describe, expect, it } from "vitest";
import {
	filterHideAddressed,
	firstLine,
	groupCommentsByFile,
} from "../../../src/features/review/logic/group-comments";
import type { ReviewComment } from "../../../shared/models/review-comment";

const make = (over: Partial<ReviewComment>): ReviewComment => ({
	id: "id",
	worktreeId: "wt1",
	filePath: "a.ts",
	startLine: 1,
	endLine: 1,
	snippet: "",
	body: "body",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-06-28T00:00:00.000Z",
	addressedAt: null,
	...over,
});

describe("group-comments", () => {
	it("filterHideAddressed drops addressed when hide=true", () => {
		const list = [make({ id: "1" }), make({ id: "2", status: "addressed" })];
		expect(filterHideAddressed(list, true).map((c) => c.id)).toEqual(["1"]);
		expect(filterHideAddressed(list, false)).toHaveLength(2);
	});

	it("groupCommentsByFile groups preserving first-seen order", () => {
		const list = [
			make({ id: "1", filePath: "b.ts" }),
			make({ id: "2", filePath: "a.ts" }),
			make({ id: "3", filePath: "b.ts" }),
		];
		const grouped = groupCommentsByFile(list);
		expect(grouped.map(([f]) => f)).toEqual(["b.ts", "a.ts"]);
		expect(grouped[0]![1].map((c) => c.id)).toEqual(["1", "3"]);
	});

	it("firstLine returns the first non-empty line", () => {
		expect(firstLine("hello\nworld")).toBe("hello");
		expect(firstLine("")).toBe("");
	});
});
