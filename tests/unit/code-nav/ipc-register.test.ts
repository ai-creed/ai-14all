import { afterEach, describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { registerCodeNavIpc } from "../../../electron/code-nav/ipc/register.js";

vi.mock("electron", () => {
	const handlers = new Map<
		string,
		(e: unknown, raw: unknown) => unknown | Promise<unknown>
	>();
	return {
		ipcMain: {
			handle: (
				ch: string,
				h: (e: unknown, raw: unknown) => unknown | Promise<unknown>,
			) => handlers.set(ch, h),
			removeHandler: (ch: string) => handlers.delete(ch),
			__invoke: (ch: string, raw: unknown) => handlers.get(ch)?.(undefined, raw),
		},
	};
});

const fakeKeys = { worktreePath: "/wt", repoKey: "r", worktreeKey: "w" };

function setup() {
	const cortexIndex = {
		findDefinitions: vi.fn().mockReturnValue([]),
		searchSymbols: vi.fn(),
		findCallees: vi.fn(),
		findCallers: vi.fn(),
		getFileImports: vi.fn(),
		getWorktreeStatus: vi.fn(),
		listFiles: vi.fn(),
	};
	const workspaceRegistry = {
		get: vi.fn().mockImplementation((id: string) => {
			if (id !== "ws1") throw new Error("unknown workspace");
			return { id: "ws1" };
		}),
	};
	const worktreeService = {
		findWorktree: vi.fn().mockImplementation(async (_r: unknown, id: string) => {
			if (id !== "wt1") throw new Error("unknown worktree");
			return { id, path: fakeKeys.worktreePath };
		}),
	};
	const cortexKeyResolver = {
		resolve: vi.fn().mockImplementation(async (p: string) => {
			if (p === fakeKeys.worktreePath)
				return { repoKey: fakeKeys.repoKey, worktreeKey: fakeKeys.worktreeKey };
			return null;
		}),
	};
	const refreshController = {
		refresh: vi.fn().mockResolvedValue(undefined),
	};
	const watcherController = { watch: vi.fn(), unwatch: vi.fn() };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const dispose = registerCodeNavIpc({
		workspaceRegistry,
		worktreeService,
		cortexIndex,
		cortexKeyResolver,
		refreshController,
		watcherController,
	} as any);
	return {
		dispose,
		cortexIndex,
		workspaceRegistry,
		worktreeService,
		cortexKeyResolver,
	};
}

describe("code-nav IPC trust boundary", () => {
	let teardown: () => void;
	afterEach(() => teardown?.());

	it("rejects payloads missing workspaceId/worktreeId", async () => {
		const { dispose } = setup();
		teardown = dispose;
		await expect(
			(ipcMain as unknown as { __invoke: Function }).__invoke(
				"code-nav:findDefinitions",
				{ name: "foo" },
			),
		).rejects.toThrow();
	});

	it("rejects payloads smuggling worktreePath (zod strict)", async () => {
		const { dispose, cortexKeyResolver } = setup();
		teardown = dispose;
		await expect(
			(ipcMain as unknown as { __invoke: Function }).__invoke(
				"code-nav:findDefinitions",
				{
					workspaceId: "ws1",
					worktreeId: "wt1",
					worktreePath: "/etc",
					name: "foo",
				},
			),
		).rejects.toThrow();
		expect(cortexKeyResolver.resolve).not.toHaveBeenCalled();
	});

	it("rejects payloads smuggling any unknown key (e.g. arbitrary cwd)", async () => {
		const { dispose } = setup();
		teardown = dispose;
		await expect(
			(ipcMain as unknown as { __invoke: Function }).__invoke(
				"code-nav:searchSymbols",
				{
					workspaceId: "ws1",
					worktreeId: "wt1",
					query: "foo",
					cwd: "/Users/attacker",
				},
			),
		).rejects.toThrow();
	});

	it("rejects unknown workspaceId", async () => {
		const { dispose } = setup();
		teardown = dispose;
		await expect(
			(ipcMain as unknown as { __invoke: Function }).__invoke(
				"code-nav:findDefinitions",
				{ workspaceId: "nope", worktreeId: "wt1", name: "foo" },
			),
		).rejects.toThrow(/unknown workspace/);
	});

	it("rejects when CortexKeyResolver returns null", async () => {
		const { dispose, cortexKeyResolver } = setup();
		teardown = dispose;
		cortexKeyResolver.resolve.mockResolvedValueOnce(null);
		await expect(
			(ipcMain as unknown as { __invoke: Function }).__invoke(
				"code-nav:findDefinitions",
				{ workspaceId: "ws1", worktreeId: "wt1", name: "foo" },
			),
		).rejects.toThrow(/No cortex index|CortexKeysNotFoundError/);
	});

	it("resolves the worktree via registry + resolver and forwards to cortexIndex", async () => {
		const {
			dispose,
			cortexIndex,
			workspaceRegistry,
			worktreeService,
			cortexKeyResolver,
		} = setup();
		teardown = dispose;
		await (ipcMain as unknown as { __invoke: Function }).__invoke(
			"code-nav:findDefinitions",
			{ workspaceId: "ws1", worktreeId: "wt1", name: "foo" },
		);
		expect(workspaceRegistry.get).toHaveBeenCalledWith("ws1");
		expect(worktreeService.findWorktree).toHaveBeenCalledWith(
			expect.anything(),
			"wt1",
		);
		expect(cortexKeyResolver.resolve).toHaveBeenCalledWith(fakeKeys.worktreePath);
		expect(cortexIndex.findDefinitions).toHaveBeenCalledWith(fakeKeys, {
			name: "foo",
			callerFile: undefined,
		});
	});
});
