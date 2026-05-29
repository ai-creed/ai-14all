import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CortexKeys {
	repoKey: string;
	worktreeKey: string;
}

export class CortexKeyResolver {
	private cache = new Map<string, CortexKeys>();
	private loaded = false;

	constructor(private readonly opts: { cortexCacheRoot: string }) {}

	async resolve(worktreePath: string): Promise<CortexKeys | null> {
		if (!this.loaded) await this.scan();
		return this.cache.get(worktreePath) ?? null;
	}

	invalidate(): void {
		this.cache.clear();
		this.loaded = false;
	}

	private async scan(): Promise<void> {
		this.cache.clear();
		let repos: string[] = [];
		try {
			repos = await readdir(this.opts.cortexCacheRoot);
		} catch {
			this.loaded = true;
			return;
		}
		for (const repo of repos) {
			let entries: string[] = [];
			try {
				entries = await readdir(join(this.opts.cortexCacheRoot, repo));
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.endsWith(".meta.json")) continue;
				try {
					const raw = await readFile(
						join(this.opts.cortexCacheRoot, repo, entry),
						"utf8",
					);
					const parsed = JSON.parse(raw) as {
						worktreePath?: string;
						repoKey?: string;
						worktreeKey?: string;
					};
					if (parsed.worktreePath && parsed.repoKey && parsed.worktreeKey) {
						this.cache.set(parsed.worktreePath, {
							repoKey: parsed.repoKey,
							worktreeKey: parsed.worktreeKey,
						});
					}
				} catch {
					// ignore unparseable sidecars
				}
			}
		}
		this.loaded = true;
	}
}

export class CortexKeysNotFoundError extends Error {
	constructor(public readonly worktreePath: string) {
		super(
			`No cortex index found for worktree ${worktreePath}; run cortex index first.`,
		);
		this.name = "CortexKeysNotFoundError";
	}
}
