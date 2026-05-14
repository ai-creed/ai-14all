import { describe, expect, it, vi } from "vitest";
import {
	dispatchActionsForJump,
	waitForEditor,
} from "../../../src/features/review/logic/queue-jump";
import type { ReviewComment } from "../../../shared/models/review-comment";

const base: ReviewComment = {
	id: "1",
	worktreeId: "w1",
	filePath: "a.ts",
	startLine: 3,
	endLine: 4,
	snippet: "x",
	body: "b",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-05-14T00:00:00.000Z",
	addressedAt: null,
};

describe("dispatchActionsForJump", () => {
	it("working-tree comment → single selectChangedFile action", () => {
		expect(dispatchActionsForJump(base)).toEqual([
			{
				type: "session/selectChangedFile",
				worktreeId: "w1",
				relativePath: "a.ts",
			},
		]);
	});

	it("commit comment → selectCommit then selectCommitFile in order", () => {
		const c: ReviewComment = { ...base, source: "commit", commitSha: "abc" };
		expect(dispatchActionsForJump(c)).toEqual([
			{ type: "session/selectCommit", worktreeId: "w1", sha: "abc" },
			{ type: "session/selectCommitFile", worktreeId: "w1", relativePath: "a.ts" },
		]);
	});

	it("commit comment without commitSha throws", () => {
		const c: ReviewComment = { ...base, source: "commit", commitSha: null };
		expect(() => dispatchActionsForJump(c)).toThrow(/commitSha/);
	});
});

describe("waitForEditor", () => {
	it("resolves when the editor becomes available", async () => {
		let count = 0;
		const get = vi.fn(() => (++count >= 2 ? { id: "ed" } : null));
		const ed = await waitForEditor(get as never, 500, () => 0);
		expect(ed).toEqual({ id: "ed" });
	});

	it("times out and resolves to null after the deadline", async () => {
		const start = Date.now();
		const ed = await waitForEditor((() => null) as never, 50, () => start);
		expect(ed).toBeNull();
	});
});
