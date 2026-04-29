import { describe, expect, it } from "vitest";
import type { Worktree } from "../../../shared/models/worktree";
import { displayTitle } from "../../../src/features/workspace/logic/session-display-title";

const worktree: Worktree = {
	id: "w1",
	repositoryId: "r1",
	branchName: "main",
	path: "/repo",
	label: "main",
	isMain: true,
};

describe("displayTitle", () => {
	it("returns the worktree label when the title is empty", () => {
		expect(displayTitle("", worktree)).toBe("main");
	});

	it("returns the worktree label when the title is whitespace", () => {
		expect(displayTitle("   ", worktree)).toBe("main");
	});

	it("returns the trimmed title when non-empty", () => {
		expect(displayTitle("  Auth rewrite  ", worktree)).toBe("Auth rewrite");
	});
});
