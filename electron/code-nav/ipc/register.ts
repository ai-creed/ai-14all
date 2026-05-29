import { ipcMain } from "electron";
import { readFileSync } from "node:fs";
import {
	FindCalleesSchema,
	FindCallersSchema,
	FindDefinitionsSchema,
	GetFileImportsSchema,
	GetWorktreeStatusSchema,
	ListFilesNavSchema,
	RefreshWorktreeSchema,
	SearchSymbolsSchema,
	UnwatchWorktreeSchema,
	WatchWorktreeSchema,
} from "../../../shared/contracts/commands.js";
import { ingestCortexJson } from "../ingest/json-to-sqlite.js";
import type {
	CortexIndexService,
	WorktreeKeys,
} from "../cortex-index-service.js";
import {
	type CortexKeyResolver,
	CortexKeysNotFoundError,
} from "../cortex-key-resolver.js";
import type { WorkspaceRegistryService } from "../../../services/workspace/workspace-registry-service.js";
import type { WorktreeService } from "../../../services/worktrees/worktree-service.js";

type IdPair = { workspaceId: string; worktreeId: string };

export interface CodeNavIpcDeps {
	workspaceRegistry: WorkspaceRegistryService;
	worktreeService: WorktreeService;
	cortexIndex: CortexIndexService;
	cortexKeyResolver: CortexKeyResolver;
	refreshController: {
		refresh(keys: WorktreeKeys, ids: IdPair, changed?: string[]): Promise<void>;
	};
	watcherController: {
		watch(keys: WorktreeKeys, ids: IdPair): void;
		unwatch(keys: WorktreeKeys): void;
	};
}

async function resolveKeys(
	deps: CodeNavIpcDeps,
	payload: IdPair,
): Promise<WorktreeKeys> {
	const repository = deps.workspaceRegistry.get(payload.workspaceId);
	const worktree = await deps.worktreeService.findWorktree(
		repository,
		payload.worktreeId,
	);
	const keys = await deps.cortexKeyResolver.resolve(worktree.path);
	if (!keys) throw new CortexKeysNotFoundError(worktree.path);
	return {
		worktreePath: worktree.path,
		repoKey: keys.repoKey,
		worktreeKey: keys.worktreeKey,
	};
}

export function registerCodeNavIpc(deps: CodeNavIpcDeps): () => void {
	ipcMain.handle("code-nav:findDefinitions", async (_e, raw: unknown) => {
		const p = FindDefinitionsSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.findDefinitions(keys, {
			name: p.name,
			callerFile: p.callerFile,
		});
	});

	ipcMain.handle("code-nav:findCallees", async (_e, raw: unknown) => {
		const p = FindCalleesSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.findCallees(keys, { fnId: p.fnId });
	});

	ipcMain.handle("code-nav:findCallers", async (_e, raw: unknown) => {
		const p = FindCallersSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.findCallers(keys, { fnId: p.fnId });
	});

	ipcMain.handle("code-nav:searchSymbols", async (_e, raw: unknown) => {
		const p = SearchSymbolsSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.searchSymbols(keys, {
			query: p.query,
			limit: p.limit,
		});
	});

	ipcMain.handle("code-nav:getFileImports", async (_e, raw: unknown) => {
		const p = GetFileImportsSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.getFileImports(keys, { file: p.file });
	});

	ipcMain.handle("code-nav:getWorktreeStatus", async (_e, raw: unknown) => {
		const p = GetWorktreeStatusSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.getWorktreeStatus(keys);
	});

	ipcMain.handle("code-nav:listFiles", async (_e, raw: unknown) => {
		const p = ListFilesNavSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		return deps.cortexIndex.listFiles(keys);
	});

	ipcMain.handle("code-nav:refreshWorktree", async (_e, raw: unknown) => {
		const p = RefreshWorktreeSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		await deps.refreshController.refresh(
			keys,
			{ workspaceId: p.workspaceId, worktreeId: p.worktreeId },
			p.changedFiles,
		);
	});

	ipcMain.handle("code-nav:watchWorktree", async (_e, raw: unknown) => {
		const p = WatchWorktreeSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		deps.watcherController.watch(keys, {
			workspaceId: p.workspaceId,
			worktreeId: p.worktreeId,
		});
	});

	ipcMain.handle("code-nav:unwatchWorktree", async (_e, raw: unknown) => {
		const p = UnwatchWorktreeSchema.parse(raw);
		const keys = await resolveKeys(deps, p);
		deps.watcherController.unwatch(keys);
	});

	// E2E-only: ingest a cortex JSON file into a code-nav SQLite mirror. This
	// lets Playwright seed a fixture without having to load better-sqlite3 in
	// the host node (which has a different ABI than Electron). Gated behind
	// the AI14ALL_E2E env so it is never registered in production builds.
	if (process.env.AI14ALL_E2E) {
		ipcMain.handle("code-nav:e2eIngest", async (_e, raw: unknown) => {
			const p = raw as { jsonPath: string; dbPath: string };
			const json = JSON.parse(readFileSync(p.jsonPath, "utf8"));
			return ingestCortexJson(json, p.dbPath);
		});
	}

	return () => {
		const channels = [
			"code-nav:findDefinitions",
			"code-nav:findCallees",
			"code-nav:findCallers",
			"code-nav:searchSymbols",
			"code-nav:getFileImports",
			"code-nav:getWorktreeStatus",
			"code-nav:listFiles",
			"code-nav:refreshWorktree",
			"code-nav:watchWorktree",
			"code-nav:unwatchWorktree",
		];
		if (process.env.AI14ALL_E2E) channels.push("code-nav:e2eIngest");
		for (const ch of channels) {
			ipcMain.removeHandler(ch);
		}
	};
}
