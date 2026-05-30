import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface CortexKeys {
	repoKey: string;
	worktreeKey: string;
}

export class CortexKeyResolver {
	private cache = new Map<string, CortexKeys>();
	private loaded = false;
	private lastScanAt = 0;
	private readonly rescanThrottleMs: number;
	private readonly now: () => number;

	constructor(
		private readonly opts: {
			cortexCacheRoot: string;
			rescanThrottleMs?: number;
			now?: () => number;
		},
	) {
		this.rescanThrottleMs = opts.rescanThrottleMs ?? 2000;
		this.now = opts.now ?? (() => Date.now());
	}

	async resolve(worktreePath: string): Promise<CortexKeys | null> {
		if (!this.loaded) await this.scan();
		const hit = this.cache.get(worktreePath);
		if (hit) return hit;
		// Cache miss: ai-cortex may have produced an index for this worktree
		// after our last scan (the user indexed it post-launch). Re-scan,
		// throttled, so a fresh index gets picked up without an app restart.
		// Without this the resolver kept a single process-lifetime scan and
		// every later index stayed invisible — a permanent
		// CortexKeysNotFoundError on every cmd+click until restart.
		if (this.now() - this.lastScanAt >= this.rescanThrottleMs) {
			await this.scan();
			return this.cache.get(worktreePath) ?? null;
		}
		return null;
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
					const parsed = JSON.parse(raw) as { worktreePath?: string };
					if (!parsed.worktreePath) continue;
					// ai-cortex encodes the repo/worktree identity in the on-disk
					// path (parent dir = repoKey, file stem = worktreeKey) rather
					// than in the meta JSON body, so derive them from there. The
					// previous schema-in-body approach silently dropped every
					// real index, falling back to CortexKeysNotFoundError on
					// every cmd+click.
					const worktreeKey = entry.slice(0, -".meta.json".length);
					this.cache.set(parsed.worktreePath, {
						repoKey: repo,
						worktreeKey,
					});
				} catch {
					// ignore unparseable sidecars
				}
			}
		}
		this.loaded = true;
		this.lastScanAt = this.now();
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
