import { join } from "node:path";
import { ingestCortexStore } from "../ingest/cortex-store-to-mirror.js";
import {
	reconcileAvailability,
	type ReconcileDeps,
} from "./reconcile-availability.js";
import type { WorktreeKeys } from "../cortex-index-service.js";

export interface BootstrapDeps extends ReconcileDeps {
	cortexCacheRoot: string;
	mirrorPathForKeys(repoKey: string, worktreeKey: string): string;
}

/**
 * First-watch seed: ingest an existing cortex `.db` (no CLI spawn) and reconcile
 * availability through the same helper as refresh, so the marker discipline is
 * shared and cannot be silently skipped.
 */
export function bootstrapWorktreeMirror(
	deps: BootstrapDeps,
	keys: WorktreeKeys,
	ids: { workspaceId: string; worktreeId: string },
): void {
	const cortexDbPath = join(
		deps.cortexCacheRoot,
		keys.repoKey,
		`${keys.worktreeKey}.db`,
	);
	const mirrorPath = deps.mirrorPathForKeys(keys.repoKey, keys.worktreeKey);
	const result = ingestCortexStore(cortexDbPath, mirrorPath);
	reconcileAvailability(deps, keys, ids, result);
}
