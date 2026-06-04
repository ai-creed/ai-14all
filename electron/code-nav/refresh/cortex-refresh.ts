import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestCortexJson } from "../ingest/json-to-sqlite.js";
import type {
	CortexIndexService,
	WorktreeKeys,
} from "../cortex-index-service.js";

export interface CortexRefreshDeps {
	cortexIndex: CortexIndexService;
	cortexCacheRoot: string;
	emit(
		event: "code-nav:worktreeIndexRefreshed",
		payload: { workspaceId: string; worktreeId: string },
	): void;
	toast(msg: string): void;
}

export class CortexRefreshController {
	private running = new Map<string, Promise<void>>();
	constructor(private readonly d: CortexRefreshDeps) {}

	async refresh(
		keys: WorktreeKeys,
		ids: { workspaceId: string; worktreeId: string },
		changedFiles?: string[],
	): Promise<void> {
		const k = `${keys.repoKey}/${keys.worktreeKey}`;
		const existing = this.running.get(k);
		if (existing) return existing;
		const run = this.doRefresh(keys, ids, changedFiles).finally(() =>
			this.running.delete(k),
		);
		this.running.set(k, run);
		return run;
	}

	private async doRefresh(
		keys: WorktreeKeys,
		ids: { workspaceId: string; worktreeId: string },
		_changedFiles?: string[],
	): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			// Hygiene re-index via the ai-cortex CLI. `rehydrate <worktreePath>`
			// re-indexes the worktree and rewrites the cache JSON we ingest. The
			// CLI has no incremental `--changed` flag, so `changedFiles` only
			// gates whether a refresh runs (decided by the caller/watcher).
			const args = ["rehydrate", keys.worktreePath];
			const child = spawn("ai-cortex", args, {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stderr = "";
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on("exit", (code) =>
				code === 0
					? resolve()
					: reject(new Error(stderr || `exit ${code ?? "?"}`)),
			);
			child.on("error", reject);
		}).catch((err) => {
			this.d.toast(`Code-nav index refresh failed: ${(err as Error).message}`);
			throw err;
		});

		const jsonPath = join(
			this.d.cortexCacheRoot,
			keys.repoKey,
			`${keys.worktreeKey}.json`,
		);
		if (!existsSync(jsonPath)) return;
		const json = JSON.parse(readFileSync(jsonPath, "utf8"));
		const dbPath = this.d.cortexIndex.dbPathForKeys(
			keys.repoKey,
			keys.worktreeKey,
		);
		const r = ingestCortexJson(json, dbPath);
		if (!r.skipped) {
			this.d.cortexIndex.invalidate(keys);
			this.d.emit("code-nav:worktreeIndexRefreshed", ids);
		}
	}
}
