import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWithinWorktree } from "../../../../services/files/worktree-path";

// `path.win32` / `path.posix` make these run identically on any host, so a
// POSIX CI still catches a Windows-only "/" regression — the bug that made the
// review/editor chrome refuse every file with "path escapes the worktree".
describe("resolveWithinWorktree", () => {
	describe("win32 separators", () => {
		const wt = "C:\\Users\\u\\repo\\.worktrees\\feat";

		it("accepts a forward-slash relative path (git-style) inside the worktree", () => {
			const r = resolveWithinWorktree(wt, "src/features/foo.ts", path.win32);
			expect(r.inside).toBe(true);
			expect(r.absolute).toBe(`${wt}\\src\\features\\foo.ts`);
		});

		it("accepts the worktree root itself", () => {
			expect(resolveWithinWorktree(wt, ".", path.win32).inside).toBe(true);
		});

		it("rejects a `..` traversal that escapes the worktree", () => {
			expect(
				resolveWithinWorktree(wt, "..\\..\\secrets.txt", path.win32).inside,
			).toBe(false);
			expect(
				resolveWithinWorktree(wt, "../../secrets.txt", path.win32).inside,
			).toBe(false);
		});

		it("rejects a sibling dir sharing the worktree's name prefix", () => {
			// `…\feat-evil` must not be treated as inside `…\feat`.
			expect(
				resolveWithinWorktree(wt, "..\\feat-evil\\x", path.win32).inside,
			).toBe(false);
		});
	});

	describe("posix separators", () => {
		const wt = "/home/u/repo/.worktrees/feat";

		it("accepts a path inside the worktree", () => {
			const r = resolveWithinWorktree(wt, "src/foo.ts", path.posix);
			expect(r.inside).toBe(true);
			expect(r.absolute).toBe(`${wt}/src/foo.ts`);
		});

		it("rejects a `..` traversal", () => {
			expect(
				resolveWithinWorktree(wt, "../../etc/passwd", path.posix).inside,
			).toBe(false);
		});

		it("rejects a sibling sharing the name prefix", () => {
			expect(
				resolveWithinWorktree(wt, "../feat-evil/x", path.posix).inside,
			).toBe(false);
		});
	});
});
