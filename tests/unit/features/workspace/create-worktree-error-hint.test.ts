import { describe, it, expect } from "vitest";
import { getCreateWorktreeErrorHint } from "../../../../src/features/workspace/logic/create-worktree-error-hint";

describe("getCreateWorktreeErrorHint", () => {
	it("returns null for no error", () => {
		expect(getCreateWorktreeErrorHint(null)).toBeNull();
		expect(getCreateWorktreeErrorHint("")).toBeNull();
	});

	it("returns a friendly hint with a fix command when origin/HEAD is unset", () => {
		// The IPC layer wraps the message, so detection must survive a prefix.
		const wrapped =
			"Error invoking remote method 'repository:previewCreateWorktree': " +
			"Error: Could not resolve a base branch — origin/HEAD is not set. " +
			"Run: git remote set-head origin -a";
		const hint = getCreateWorktreeErrorHint(wrapped);
		expect(hint).not.toBeNull();
		expect(hint?.command).toBe("git remote set-head origin -a");
		expect(hint?.title.length).toBeGreaterThan(0);
		expect(hint?.detail.length).toBeGreaterThan(0);
	});

	it("returns null for unrelated errors so the raw banner is used", () => {
		expect(
			getCreateWorktreeErrorHint(
				"Worktree path already exists: /repo/.worktrees/x",
			),
		).toBeNull();
	});
});
