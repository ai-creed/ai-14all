import type { KnownWorktree } from "../../shared/models/usage.js";

// Forward slug of an absolute path: drop the leading "/", then replace every "/"
// and "." with "-". Lossy (not reversible). Historic ledger buckets from the
// retired ezio record store are keyed by this slug, so matchCwd keeps a
// second-pass exact-slug match to resolve them in all-time views.
export function ezioSlug(path: string): string {
	return path.replace(/^\//, "").replace(/[/.]/g, "-");
}

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

// The repo root for a worktree path. Worktrees live at `<repo>/.worktrees/<name>`
// (services/worktrees/worktree-service.ts), so strip that suffix to fold every
// worktree of one repo to the same root; a plain checkout is its own root.
function repoRoot(wtPath: string): string {
	const p = norm(wtPath);
	const i = p.indexOf("/.worktrees/");
	return i >= 0 ? p.slice(0, i) : p;
}

// For a cwd with no current worktree (a deleted/closed worktree, or a checkout the
// app isn't tracking), group it under the workspace of a known worktree ONLY when
// the cwd belongs to that repo — i.e. it IS, or sits under, that worktree's repo
// root. Matching on the immediate parent dir (the old behaviour) wrongly merged
// SIBLING repos that merely share a parent — e.g. ~/Dev/ai-14all and ~/Dev/ai-whisper
// both have parent ~/Dev, so every other ~/Dev repo collapsed into whichever one was
// open. Requiring repo-root containment (longest/most-specific match wins) keeps a
// repo's deleted worktrees together while leaving unrelated repos as untracked.
export function workspaceGroupFor(
	cwd: string,
	known: KnownWorktree[],
): { workspaceId: string | null; title: string } {
	const c = norm(cwd);
	let best: { workspaceId: string | null; title: string } | null = null;
	let bestLen = -1;
	for (const wt of known) {
		const root = repoRoot(wt.path);
		if ((c === root || c.startsWith(`${root}/`)) && root.length > bestLen) {
			best = { workspaceId: wt.workspaceId, title: wt.title };
			bestLen = root.length;
		}
	}
	return best ?? { workspaceId: null, title: "other (untracked)" };
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
