import type { KnownWorktree } from "../../shared/models/usage.js";

// Canonicalise a path for prefix comparison: fold Windows backslashes to "/"
// and drop trailing separators. Unlike resolveWithinWorktree (which compares two
// resolve()-produced, consistently OS-native paths via path.sep), matchCwd
// compares strings from two independent sources — `cwd` from external usage logs
// and `wt.path` from the worktree registry — which may not agree on separator on
// Windows. Folding both sides to "/" makes the match separator-agnostic; on mac
// (no backslashes) this is a no-op beyond the existing trailing-slash trim.
function norm(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function matchCwd(
	cwd: string,
	known: KnownWorktree[],
): KnownWorktree | null {
	if (!cwd) return null;
	const c = norm(cwd);
	let best: KnownWorktree | null = null;
	for (const wt of known) {
		const base = norm(wt.path);
		if (c === base || c.startsWith(base + "/")) {
			if (!best || norm(best.path).length < base.length) best = wt;
		}
	}
	return best;
}
