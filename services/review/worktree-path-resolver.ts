import { realpath } from "node:fs/promises";

export type WorktreeRegistryEntry = { id: string; path: string };

export type WorktreePathResolver = {
	resolve: (input: string) => Promise<string | null>;
	refresh: () => Promise<void>;
};

export async function createWorktreePathResolver(
	listWorktrees: () => WorktreeRegistryEntry[] | Promise<WorktreeRegistryEntry[]>,
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

	const resolve = async (input: string) => {
		let canonical: string;
		try {
			canonical = await realpath(input);
		} catch {
			canonical = input;
		}
		return canonicalToId.get(canonical) ?? null;
	};

	await refresh();
	return { resolve, refresh };
}
