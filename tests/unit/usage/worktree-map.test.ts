import { describe, expect, it } from "vitest";
import {
	ezioSlug,
	matchCwd,
	workspaceGroupFor,
} from "../../../services/usage/worktree-map.js";
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

describe("ezioSlug", () => {
	it("strips the leading slash and replaces / and . with -", () => {
		expect(
			ezioSlug("/Users/vuphan/Dev/ai-14all/.worktrees/bugs-hardening"),
		).toBe("Users-vuphan-Dev-ai-14all--worktrees-bugs-hardening");
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
	// Only a worktree of `app` is open (main checkout closed). Repo root = /Users/me/Dev/app.
	const known = [
		{
			worktreeId: "w2",
			workspaceId: "ws-app",
			title: "feat",
			path: "/Users/me/Dev/app/.worktrees/feat",
		},
	];
	it("groups a closed sibling worktree of the same repo under its workspace", () => {
		// /Users/me/Dev/app/.worktrees/gone shares the repo root /Users/me/Dev/app
		expect(
			workspaceGroupFor("/Users/me/Dev/app/.worktrees/gone", known).workspaceId,
		).toBe("ws-app");
	});
	it("groups the repo's main checkout under its workspace", () => {
		expect(workspaceGroupFor("/Users/me/Dev/app", known).workspaceId).toBe(
			"ws-app",
		);
	});
	it("does NOT merge a sibling REPO that only shares a parent directory (the bug)", () => {
		// /Users/me/Dev/other-repo is a DIFFERENT repo; it shares /Users/me/Dev with `app`
		// but must not collapse into the app workspace.
		expect(workspaceGroupFor("/Users/me/Dev/other-repo", known)).toEqual({
			workspaceId: null,
			title: "other (untracked)",
		});
	});
	it("falls back to untracked when no repo root contains the cwd", () => {
		expect(workspaceGroupFor("/tmp/random", known)).toEqual({
			workspaceId: null,
			title: "other (untracked)",
		});
	});
});
