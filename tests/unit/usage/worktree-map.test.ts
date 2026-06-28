import { describe, expect, it } from "vitest";
import { matchCwd, workspaceGroupFor } from "../../../services/usage/worktree-map.js";
import type { KnownWorktree } from "../../../shared/models/usage.js";
import { ezioSlug } from "../../../services/usage/ezio-source.js";

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

describe("matchCwd dir-slug (ezio)", () => {
	it("matches a forward-slug against a known worktree path", () => {
		const slug = ezioSlug("/Users/me/Dev/app");
		expect(matchCwd(slug, known)?.worktreeId).toBe("w1");
	});
	it("matches a worktree under .worktrees by slug", () => {
		const slug = ezioSlug("/Users/me/Dev/app/.worktrees/feat");
		expect(matchCwd(slug, known)?.worktreeId).toBe("w2");
	});
	it("returns null for an unknown slug", () => {
		expect(matchCwd(ezioSlug("/Users/me/Dev/other"), known)).toBeNull();
	});
});

describe("workspaceGroupFor", () => {
	const known = [
		{ worktreeId: "w1", workspaceId: "ws-app", title: "main", path: "/Users/me/Dev/app/main" },
	];
	it("groups a deleted worktree under its workspace when the root prefix matches a known one", () => {
		// /Users/me/Dev/app/feature-x is gone, but shares the /Users/me/Dev/app root
		const g = workspaceGroupFor("/Users/me/Dev/app/feature-x", known);
		expect(g.workspaceId).toBe("ws-app");
		expect(g.title).toBe("main"); // or the workspace label derivable from known
	});
	it("falls back to untracked when no workspace root is derivable", () => {
		expect(workspaceGroupFor("/tmp/random", known)).toEqual({ workspaceId: null, title: "other (untracked)" });
	});
});
