import { realpath } from "node:fs/promises";

export type WorktreeRegistryEntry = { id: string; path: string };

export type WorktreePathResolver = {
	resolve: (input: string) => Promise<string | null>;
	refresh: () => Promise<void>;
};

export type WorktreePathResolverOptions = {
	now?: () => number;
	refreshCooldownMs?: number;
};

export async function createWorktreePathResolver(
	listWorktrees: () =>
		| WorktreeRegistryEntry[]
		| Promise<WorktreeRegistryEntry[]>,
	options: WorktreePathResolverOptions = {},
): Promise<WorktreePathResolver> {
	const { now = Date.now, refreshCooldownMs = 1000 } = options;
	let canonicalToId = new Map<string, string>();
	// -Infinity so the first miss always re-lists: the initial population below
	// does not arm the cooldown, keeping a repo registered in the same instant
	// the resolver is built discoverable.
	let lastRefreshAt = Number.NEGATIVE_INFINITY;
	// The most recent still-running re-list. Listing is async (git subprocesses
	// per repo), so a miss can arrive while another consumer's re-list is in
	// flight; it must ride that listing rather than fast-fail on the cooldown.
	let inFlight: Promise<void> | null = null;

	const populate = async () => {
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

	const refresh = async () => {
		lastRefreshAt = now();
		const run = populate().finally(() => {
			if (inFlight === run) inFlight = null;
		});
		inFlight = run;
		await run;
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
		// once and retry before reporting the path as unknown — but at most once
		// per cooldown window. A single re-list is cheap; unthrottled, a batch of
		// permanently unresolvable paths (dead collab rows) pays a full sweep per
		// miss, which is what stalled the XBP session-report handler for seconds.
		//
		// A re-list already in flight (another consumer's miss, or the eager
		// refresh on registry change) answers this miss in milliseconds — ride it
		// instead of fast-failing on the cooldown. The cooldown fast-fail is only
		// correct against a map that is both fresh AND fully built.
		if (inFlight !== null) {
			await inFlight;
			const rode = canonicalToId.get(canonical);
			if (rode !== undefined) return rode;
		}
		if (now() - lastRefreshAt < refreshCooldownMs) return null;
		await refresh();
		return canonicalToId.get(canonical) ?? null;
	};

	await populate();
	return { resolve, refresh };
}
