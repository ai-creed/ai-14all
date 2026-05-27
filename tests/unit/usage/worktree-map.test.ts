import { describe, expect, it } from "vitest";
import { matchCwd } from "../../../services/usage/worktree-map.js";
import type { KnownWorktree } from "../../../shared/models/usage.js";

const known: KnownWorktree[] = [
	{
		worktreeId: "w1",
		workspaceId: "ws1",
		title: "main",
		path: "/Users/me/Dev/app",
	},
	{
		worktreeId: "w2",
		workspaceId: "ws1",
		title: "feat",
		path: "/Users/me/Dev/app/.worktrees/feat/",
	},
];

describe("matchCwd", () => {
	it("matches the most specific (longest) path prefix", () => {
		expect(
			matchCwd("/Users/me/Dev/app/.worktrees/feat", known)?.worktreeId,
		).toBe("w2");
		expect(matchCwd("/Users/me/Dev/app/src", known)?.worktreeId).toBe("w1");
	});
	it("returns null for unknown cwd", () => {
		expect(matchCwd("/Users/me/Dev/other", known)).toBeNull();
		expect(matchCwd("", known)).toBeNull();
	});
});
