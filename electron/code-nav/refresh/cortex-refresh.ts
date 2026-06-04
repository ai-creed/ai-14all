import { spawn } from "node:child_process";
import { join } from "node:path";
import { ingestCortexStore } from "../ingest/cortex-store-to-mirror.js";
import {
	reconcileAvailability,
	type CodeNavEvent,
} from "./reconcile-availability.js";
import type {
	CortexIndexService,
	WorktreeKeys,
} from "../cortex-index-service.js";

export interface CortexRefreshDeps {
	cortexIndex: CortexIndexService;
	cortexCacheRoot: string;
	codeNavCacheRoot: string;
	emit(event: CodeNavEvent, payload: Record<string, unknown>): void;
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

	private reconcileDeps() {
		return {
			codeNavCacheRoot: this.d.codeNavCacheRoot,
			cortexIndex: this.d.cortexIndex,
			emit: this.d.emit,
		};
	}

	private async doRefresh(
		keys: WorktreeKeys,
		ids: { workspaceId: string; worktreeId: string },
		_changedFiles?: string[],
	): Promise<void> {
		let notInstalled = false;
		try {
			await new Promise<void>((resolve, reject) => {
				// Hygiene re-index: `rehydrate <worktreePath>`. On ai-cortex >= 0.13
				// this (re)writes the per-worktree `.db` we ingest.
				const child = spawn("ai-cortex", ["rehydrate", keys.worktreePath], {
					stdio: ["ignore", "pipe", "pipe"],
				});
				let stderr = "";
				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});
				child.on("error", (err: NodeJS.ErrnoException) => {
					if (err.code === "ENOENT") {
						// ai-cortex not installed / not on PATH: a capability the user
						// does not have, not a hard error. Route to the disable path.
						notInstalled = true;
						resolve();
					} else {
						reject(err);
					}
				});
				child.on("exit", (code) =>
					code === 0
						? resolve()
						: reject(new Error(stderr || `exit ${code ?? "?"}`)),
				);
			});
		} catch (err) {
			this.d.toast(`Code-nav index refresh failed: ${(err as Error).message}`);
			throw err;
		}

		if (notInstalled) {
			reconcileAvailability(this.reconcileDeps(), keys, ids, {
				unavailable: true,
				reason: "no-store",
			});
			return;
		}

		const cortexDbPath = join(
			this.d.cortexCacheRoot,
			keys.repoKey,
			`${keys.worktreeKey}.db`,
		);
		const mirrorPath = this.d.cortexIndex.dbPathForKeys(
			keys.repoKey,
			keys.worktreeKey,
		);
		const result = ingestCortexStore(cortexDbPath, mirrorPath);
		reconcileAvailability(this.reconcileDeps(), keys, ids, result);
	}
}
