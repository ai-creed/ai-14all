import type { ObserveOutput, WorktreeIdentity } from "./observe-types";

export type ResolveResult =
	| { kind: "found"; worktreeId: string }
	| { kind: "none" }
	| { kind: "ambiguous"; candidates: string[] };

/**
 * Map a `"<repo>/<branch>"` observe key to a worktreeId. The key is not globally
 * unique (two same-basename repos on the same branch collide), so ambiguity is a
 * first-class outcome: an ambiguous key is refused, never guessed.
 */
export function resolveWorktreeKey(
	identities: Record<string, WorktreeIdentity>,
	key: string,
): ResolveResult {
	const matches: { worktreeId: string; path: string }[] = [];
	for (const [worktreeId, identity] of Object.entries(identities)) {
		if (`${identity.repo}/${identity.branch}` === key)
			matches.push({ worktreeId, path: identity.path });
	}
	if (matches.length === 0) return { kind: "none" };
	if (matches.length === 1)
		return { kind: "found", worktreeId: matches[0].worktreeId };
	return { kind: "ambiguous", candidates: matches.map((m) => m.path) };
}

/** Render the whole-app roll-up: the summary headline + one line per worktree. */
export function renderReport(out: ObserveOutput): string {
	const lines = Object.entries(out.details).map(
		([key, line]) => `${key}: ${line}`,
	);
	return lines.length === 0 ? out.summary : [out.summary, ...lines].join("\n");
}
