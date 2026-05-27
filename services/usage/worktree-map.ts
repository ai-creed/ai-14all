import type { KnownWorktree } from "../../shared/models/usage.js";

function norm(p: string): string {
	return p.replace(/\/+$/, "");
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
