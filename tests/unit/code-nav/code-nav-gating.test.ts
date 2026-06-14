import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the handlers registered via ipcMain.handle so we can invoke them.
const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();
vi.mock("electron", () => ({
	ipcMain: {
		handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) =>
			handlers.set(ch, fn),
		removeHandler: (ch: string) => handlers.delete(ch),
	},
}));

import { registerCodeNavIpc } from "../../../electron/code-nav/ipc/register";

const IDS = { workspaceId: "w", worktreeId: "t" };

function makeDeps(enabled: boolean, over: Record<string, unknown> = {}) {
	return {
		workspaceRegistry: { get: vi.fn(() => ({})) },
		worktreeService: { findWorktree: vi.fn(async () => ({ path: "/w" })) },
		cortexIndex: {
			getWorktreeStatus: vi.fn(() => ({ available: true, reason: null })),
			findDefinitions: vi.fn(() => [{ id: 1 }]),
			findCallees: vi.fn(() => []),
			findCallers: vi.fn(() => []),
			searchSymbols: vi.fn(() => []),
			getFileImports: vi.fn(() => []),
			listFiles: vi.fn(() => []),
		},
		cortexKeyResolver: {
			resolve: vi.fn(async () => ({ repoKey: "r", worktreeKey: "k" })),
		},
		refreshController: { refresh: vi.fn(async () => {}) },
		watcherController: { watch: vi.fn(), unwatch: vi.fn() },
		isCortexEnabled: () => enabled,
		...over,
	};
}

beforeEach(() => handlers.clear());

describe("registerCodeNavIpc cortex gating — disabled", () => {
	it("getWorktreeStatus returns cortex-disabled without resolving keys", async () => {
		const deps = makeDeps(false);
		registerCodeNavIpc(deps as never);
		const res = await handlers.get("code-nav:getWorktreeStatus")!(null, IDS);
		expect(res).toMatchObject({
			available: false,
			ready: false,
			reason: "cortex-disabled",
		});
		expect(deps.cortexKeyResolver.resolve).not.toHaveBeenCalled();
		expect(deps.cortexIndex.getWorktreeStatus).not.toHaveBeenCalled();
	});

	it.each([
		"code-nav:findDefinitions",
		"code-nav:findCallees",
		"code-nav:findCallers",
		"code-nav:searchSymbols",
		"code-nav:getFileImports",
		"code-nav:listFiles",
	])("%s short-circuits to [] when disabled", async (channel) => {
		const deps = makeDeps(false);
		registerCodeNavIpc(deps as never);
		expect(
			await handlers.get(channel)!(null, {
				...IDS,
				name: "x",
				fnId: 1,
				query: "x",
				file: "a",
				limit: 5,
			}),
		).toEqual([]);
	});

	it("watch/unwatch/refresh handlers stay functional when disabled (lifecycle preserved)", async () => {
		const deps = makeDeps(false);
		registerCodeNavIpc(deps as never);
		await handlers.get("code-nav:watchWorktree")!(null, IDS);
		await handlers.get("code-nav:unwatchWorktree")!(null, IDS);
		await handlers.get("code-nav:refreshWorktree")!(null, IDS);
		// Watcher lifecycle must NOT be gated, or watchers leak on unmount and
		// never register when mounted while disabled. The refresh no-op is the
		// controller's job (CortexRefreshController, tested elsewhere).
		expect(deps.watcherController.watch).toHaveBeenCalled();
		expect(deps.watcherController.unwatch).toHaveBeenCalled();
		expect(deps.refreshController.refresh).toHaveBeenCalled();
	});
});

describe("registerCodeNavIpc cortex gating — enabled (unchanged path)", () => {
	it("getWorktreeStatus delegates to cortexIndex when enabled", async () => {
		const deps = makeDeps(true);
		registerCodeNavIpc(deps as never);
		const res = await handlers.get("code-nav:getWorktreeStatus")!(null, IDS);
		expect(deps.cortexKeyResolver.resolve).toHaveBeenCalled();
		expect(deps.cortexIndex.getWorktreeStatus).toHaveBeenCalled();
		expect(res).toMatchObject({ available: true });
	});

	it("findDefinitions delegates to cortexIndex when enabled", async () => {
		const deps = makeDeps(true);
		registerCodeNavIpc(deps as never);
		const res = await handlers.get("code-nav:findDefinitions")!(null, {
			...IDS,
			name: "foo",
		});
		expect(deps.cortexIndex.findDefinitions).toHaveBeenCalled();
		expect(res).toEqual([{ id: 1 }]);
	});
});
