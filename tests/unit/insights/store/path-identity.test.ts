import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertNoAbsolutePaths,
	assertNoAbsolutePathsDeep,
	isAbsolutePathLike,
	resolveWorkspaceIdentity,
	sha256Short,
} from "../../../../services/insights/store/path-identity.js";

const dirs: string[] = [];
const mk = () => {
	const d = mkdtempSync(join(tmpdir(), "insights-pi-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("path identity", () => {
	it("hashes opaquely and stably", () => {
		expect(sha256Short("/a/b")).toBe(sha256Short("/a/b"));
		expect(sha256Short("/a/b")).not.toContain("/");
		expect(sha256Short("/a/b").length).toBe(16);
	});

	it("flags absolute-path shapes", () => {
		for (const s of ["/Users/x", "~/x", "C:\\x", "\\\\host\\x"])
			expect(isAbsolutePathLike(s)).toBe(true);
		for (const s of ["", ".worktrees/x", "repo-rel/dir", "n/a"])
			expect(isAbsolutePathLike(s)).toBe(false);
		expect(() => assertNoAbsolutePaths(["ok", "/abs"])).toThrow();
		expect(() => assertNoAbsolutePaths(["ok", 123, null])).not.toThrow();
		// Recursive guard: catches an absolute path nested in an object/array.
		expect(() =>
			assertNoAbsolutePathsDeep({ a: { b: ["ok", "/Users/x"] } }),
		).toThrow();
		expect(() =>
			assertNoAbsolutePathsDeep({ a: { b: ["ok", "rel/dir"] }, c: 1, d: null }),
		).not.toThrow();
	});

	it("resolves a normal repo to opaque id + empty rel + basename label", () => {
		const repo = mk();
		mkdirSync(join(repo, ".git"));
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		const id = resolveWorkspaceIdentity(repo);
		expect(id.repoId).toBe(sha256Short(realpathSync(repo)));
		expect(id.workspaceRel).toBe("");
		expect(id.workspaceLabel).toBe(basename(repo));
		expect(id.branch).toBe("main");
		expect(isAbsolutePathLike(id.repoId)).toBe(false);
		expect(isAbsolutePathLike(id.workspaceRel)).toBe(false);
	});

	it("resolves a nested linked worktree to the common repo id + relative path", () => {
		const repo = mk();
		mkdirSync(join(repo, ".git", "worktrees", "wt"), { recursive: true });
		writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
		const wt = join(repo, ".worktrees", "wt");
		mkdirSync(wt, { recursive: true });
		writeFileSync(
			join(wt, ".git"),
			`gitdir: ${join(repo, ".git", "worktrees", "wt")}\n`,
		);
		writeFileSync(
			join(repo, ".git", "worktrees", "wt", "HEAD"),
			"ref: refs/heads/feature\n",
		);
		const id = resolveWorkspaceIdentity(wt);
		expect(id.repoId).toBe(sha256Short(realpathSync(repo)));
		expect(id.workspaceRel).toBe(join(".worktrees", "wt"));
		expect(id.branch).toBe("feature");
	});

	it("falls back for a non-git path without leaking an absolute path", () => {
		const plain = mk();
		const id = resolveWorkspaceIdentity(plain);
		expect(id.repoId).toBe(sha256Short(realpathSync(plain)));
		expect(id.workspaceRel).toBe(basename(plain));
		expect(id.branch).toBeNull();
		expect(isAbsolutePathLike(id.workspaceRel)).toBe(false);
	});
});
