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

	const winKnown: KnownWorktree[] = [
		{
			worktreeId: "w1",
			workspaceId: "ws1",
			title: "main",
			path: "C:\\Users\\me\\Dev\\app",
		},
		{
			worktreeId: "w2",
			workspaceId: "ws1",
			title: "feat",
			path: "C:\\Users\\me\\Dev\\app\\.worktrees\\feat\\",
		},
	];

	it("matches Windows backslash paths to the most specific worktree", () => {
		expect(
			matchCwd("C:\\Users\\me\\Dev\\app\\.worktrees\\feat", winKnown)
				?.worktreeId,
		).toBe("w2");
		expect(matchCwd("C:\\Users\\me\\Dev\\app\\src", winKnown)?.worktreeId).toBe(
			"w1",
		);
	});

	it("matches when cwd and worktree.path disagree on separator", () => {
		// cwd from the usage log uses forward slashes while the registry path uses
		// backslashes — the match must be separator-agnostic.
		expect(matchCwd("C:/Users/me/Dev/app/src", winKnown)?.worktreeId).toBe(
			"w1",
		);
		expect(
			matchCwd("C:/Users/me/Dev/app/.worktrees/feat", winKnown)?.worktreeId,
		).toBe("w2");
	});

	it("does not false-match a sibling dir sharing a path prefix (win)", () => {
		expect(matchCwd("C:\\Users\\me\\Dev\\app-other\\src", winKnown)).toBeNull();
	});
});
