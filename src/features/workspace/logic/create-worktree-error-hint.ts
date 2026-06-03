export type CreateWorktreeErrorHint = {
	/** Short, calm headline for the problem. */
	title: string;
	/** One-line explanation of why creation can't proceed. */
	detail: string;
	/** Optional shell command the user can run to fix it. */
	command?: string;
};

/**
 * Map a raw create-worktree error message to a friendlier, actionable hint.
 * Returns null when the error has no known remedy, so callers fall back to
 * showing the raw message. Matching is substring-based so it survives the
 * Electron IPC layer wrapping the original message with its own prefix.
 */
export function getCreateWorktreeErrorHint(
	message: string | null,
): CreateWorktreeErrorHint | null {
	if (!message) return null;

	if (message.includes("origin/HEAD is not set")) {
		return {
			title: "No default branch detected",
			detail:
				"New sessions branch from this repository's default branch, but Git " +
				"hasn't recorded one for the 'origin' remote. Set it once, then try again:",
			command: "git remote set-head origin -a",
		};
	}

	return null;
}
