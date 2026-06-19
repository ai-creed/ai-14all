import { realpath } from "node:fs/promises";

export type WorktreeRegistryEntry = { id: string; path: string };

export type WorktreePathResolver = {
	resolve: (input: string) => Promise<string | null>;
	refresh: () => Promise<void>;
};

export async function createWorktreePathResolver(
	listWorktrees: () =>
		| WorktreeRegistryEntry[]
		| Promise<WorktreeRegistryEntry[]>,
): Promise<WorktreePathResolver> {
	let canonicalToId = new Map<string, string>();

	const refresh = async () => {
		const next = new Map<string, string>();
		const entries = await listWorktrees();
		for (const entry of entries) {
			let canonical: string;
			try {
				canonical = await realpath(entry.path);
			} catch {
				canonical = entry.path;
			}
			next.set(canonical, entry.id);
		}
		canonicalToId = next;
	};

	const canonicalize = async (input: string) => {
		try {
			return await realpath(input);
		} catch {
			return input;
		}
	};

	const resolve = async (input: string) => {
		const canonical = await canonicalize(input);
		const hit = canonicalToId.get(canonical);
		if (hit !== undefined) return hit;
		// Cache miss. The worktree set may have changed since the last refresh:
		// a repo can be registered just after an eager consumer (the whisper lens
		// poll) resolves its collab path, so the map is momentarily stale. Re-list
		// once and retry before reporting the path as unknown. A path we genuinely
		// don't manage still returns null — only at the cost of one extra re-list,
		// which is cheap (an in-process registry walk / `git worktree list`).
		await refresh();
		return canonicalToId.get(canonical) ?? null;
	};

	await refresh();
	return { resolve, refresh };
}
