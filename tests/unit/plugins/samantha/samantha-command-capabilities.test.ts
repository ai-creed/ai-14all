import { describe, expect, it } from "vitest";
import {
	renderReport,
	resolveWorktreeKey,
} from "../../../../services/plugins/samantha/samantha-command-capabilities";
import type { WorktreeIdentity } from "../../../../services/plugins/samantha/observe-types";

const id = (repo: string, branch: string, path: string): WorktreeIdentity => ({
	repo,
	branch,
	path,
});

describe("resolveWorktreeKey", () => {
	it("returns found for a uniquely-matched key", () => {
		const identities = { wt1: id("ai-14all", "main", "/a") };
		expect(resolveWorktreeKey(identities, "ai-14all/main")).toEqual({
			kind: "found",
			worktreeId: "wt1",
		});
	});

	it("returns none for an unknown key", () => {
		expect(
			resolveWorktreeKey({ wt1: id("ai-14all", "main", "/a") }, "x/y"),
		).toEqual({
			kind: "none",
		});
	});

	it("returns ambiguous (with candidate paths) when two identities share a key", () => {
		const identities = {
			wt1: id("ai-14all", "main", "/a/ai-14all"),
			wt2: id("ai-14all", "main", "/b/ai-14all"),
		};
		const r = resolveWorktreeKey(identities, "ai-14all/main");
		expect(r.kind).toBe("ambiguous");
		expect(r.kind === "ambiguous" && r.candidates.sort()).toEqual([
			"/a/ai-14all",
			"/b/ai-14all",
		]);
	});
});

describe("renderReport", () => {
	it("renders the headline plus one line per details entry", () => {
		expect(
			renderReport({
				summary: "[ready] — 2 sessions",
				status: "ok",
				details: {
					"ai-14all/main": "claude · active",
					"ai-14all/dev": "★ codex · idle",
				},
				signals: {},
			}),
		).toBe(
			"[ready] — 2 sessions\nai-14all/main: claude · active\nai-14all/dev: ★ codex · idle",
		);
	});

	it("renders the headline alone when there are zero worktrees", () => {
		expect(
			renderReport({
				summary: "[ready] — no active sessions",
				status: "unknown",
				details: {},
				signals: {},
			}),
		).toBe("[ready] — no active sessions");
	});
});
