import type { KnownWorktree } from "../../shared/models/usage.js";
import { ezioSlug } from "./ezio-source.js";

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
	cwdOrSlug: string,
	known: KnownWorktree[],
): KnownWorktree | null {
	if (!cwdOrSlug) return null;
	// First pass: real-path longest-prefix (claude/codex feed absolute paths).
	const c = norm(cwdOrSlug);
	let best: KnownWorktree | null = null;
	for (const wt of known) {
		const base = norm(wt.path);
		if (c === base || c.startsWith(base + "/")) {
			if (!best || norm(best.path).length < base.length) best = wt;
		}
	}
	if (best) return best;
	// Second pass: exact dir-slug match (ezio feeds a lossy, separator-free slug).
	// norm() drops the trailing slash so registry paths slugify consistently.
	for (const wt of known) {
		if (ezioSlug(norm(wt.path)) === cwdOrSlug) return wt;
	}
	return null;
}
