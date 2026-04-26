// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, handleMock } = vi.hoisted(() => {
	const handlers = new Map<
		string,
		(event: unknown, payload: unknown) => unknown
	>();
	const handleMock = vi.fn(
		(
			channel: string,
			handler: (event: unknown, payload: unknown) => unknown,
		) => {
			handlers.set(channel, handler);
		},
	);
	return { handlers, handleMock };
});

const { worktreeServiceInstance, fileServiceInstance } = vi.hoisted(() => {
	const worktreeServiceInstance = {
		setRepositoryRoot: vi.fn(),
		listWorktrees: vi.fn(),
		findWorktree: vi.fn(),
		previewCreateWorktree: vi.fn(),
		createWorktree: vi.fn(),
		previewRemoveWorktree: vi.fn(),
		removeWorktree: vi.fn(),
	};
	const fileServiceInstance = {
		listFiles: vi.fn(),
		listScopedFiles: vi.fn(),
		listTrackedFiles: vi.fn(),
		readFile: vi.fn(),
	};
	return { worktreeServiceInstance, fileServiceInstance };
});

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp/test-home"), getAppPath: vi.fn(() => "/tmp/app-resources") },
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: handleMock },
}));

vi.mock("../../../services/worktrees/worktree-service.js", () => {
	function WorktreeService(this: unknown) {
		return worktreeServiceInstance;
	}
	return { WorktreeService };
});

vi.mock("../../../services/files/file-service.js", () => {
	function FileService(this: unknown) {
		return fileServiceInstance;
	}
	return { FileService };
});

import { registerIpcHandlers } from "../../../electron/main/ipc.js";

describe("registerIpcHandlers diagnostics", () => {
	beforeEach(() => {
		handlers.clear();
		handleMock.mockClear();
	});

	it("registers diagnostics:logShellEvent and forwards payload to the log service", async () => {
		const logMock = vi.fn();
		registerIpcHandlers(
			{
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: vi.fn() },
			} as never,
			{
				workspacePersistence: {
					readState: vi.fn(),
					writeState: vi.fn(),
				} as never,
				workspaceRegistry: { register: vi.fn(), get: vi.fn() } as never,
				worktreeService: worktreeServiceInstance as never,
				shellEventLog: { log: logMock } as never,
				review: { service: { onChange: vi.fn(() => () => {}), removeByWorktree: vi.fn(), listByWorktree: vi.fn(() => []), create: vi.fn(), markAddressed: vi.fn(), reopen: vi.fn(), delete: vi.fn(), rebaseWorktreeIds: vi.fn() }, mcpStatus: { port: null, bindError: null, getUrl: () => null }, worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() } } as never,
			},
		);

		const handler = handlers.get("diagnostics:logShellEvent");
		expect(handler).toBeTypeOf("function");
		await handler?.(
			{},
			{
				source: "renderer",
				event: "renderer-start",
				windowId: 1,
				rendererAt: "2026-04-12T00:00:00.000Z",
				rendererSeq: 1,
				data: {},
			},
		);

		expect(logMock).toHaveBeenCalledWith(
			expect.objectContaining({ event: "renderer-start", rendererSeq: 1 }),
		);
	});

	it("drops malformed diagnostics payloads without throwing", async () => {
		const logMock = vi.fn();
		registerIpcHandlers(
			{
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: vi.fn() },
			} as never,
			{
				workspacePersistence: {
					readState: vi.fn(),
					writeState: vi.fn(),
				} as never,
				workspaceRegistry: { register: vi.fn(), get: vi.fn() } as never,
				worktreeService: worktreeServiceInstance as never,
				shellEventLog: { log: logMock } as never,
				review: { service: { onChange: vi.fn(() => () => {}), removeByWorktree: vi.fn(), listByWorktree: vi.fn(() => []), create: vi.fn(), markAddressed: vi.fn(), reopen: vi.fn(), delete: vi.fn(), rebaseWorktreeIds: vi.fn() }, mcpStatus: { port: null, bindError: null, getUrl: () => null }, worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() } } as never,
			},
		);

		const handler = handlers.get("diagnostics:logShellEvent");
		const result = await Promise.resolve(handler?.({}, { bad: true }));
		expect(result).toBeUndefined();
		expect(logMock).not.toHaveBeenCalled();
	});
});

describe("registerIpcHandlers files:listTracked identity resolution", () => {
	beforeEach(() => {
		handlers.clear();
		handleMock.mockClear();
		worktreeServiceInstance.findWorktree.mockReset();
		fileServiceInstance.listTrackedFiles.mockReset();
	});

	const register = (registryGet: (workspaceId: string) => unknown) => {
		registerIpcHandlers(
			{
				id: 1,
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: vi.fn() },
			} as never,
			{
				workspacePersistence: {
					readState: vi.fn(),
					writeState: vi.fn(),
				} as never,
				workspaceRegistry: {
					register: vi.fn(),
					get: vi.fn(registryGet),
				} as never,
				worktreeService: worktreeServiceInstance as never,
				review: { service: { onChange: vi.fn(() => () => {}), removeByWorktree: vi.fn(), listByWorktree: vi.fn(() => []), create: vi.fn(), markAddressed: vi.fn(), reopen: vi.fn(), delete: vi.fn(), rebaseWorktreeIds: vi.fn() }, mcpStatus: { port: null, bindError: null, getUrl: () => null }, worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() } } as never,
			},
		);
		const handler = handlers.get("files:listTracked");
		expect(handler).toBeTypeOf("function");
		return handler!;
	};

	it("rejects when the workspaceId is unknown", async () => {
		const handler = register(() => {
			throw new Error("Unknown workspace: wk-nope");
		});
		await expect(
			handler({}, { workspaceId: "wk-nope", worktreeId: "wt-x" }),
		).rejects.toThrow(/Unknown workspace/);
		expect(worktreeServiceInstance.findWorktree).not.toHaveBeenCalled();
		expect(fileServiceInstance.listTrackedFiles).not.toHaveBeenCalled();
	});

	it("rejects when the worktreeId is unknown under a known workspace", async () => {
		const repository = { repoId: "repo-1", rootPath: "/tmp/repo" };
		worktreeServiceInstance.findWorktree.mockRejectedValueOnce(
			new Error("Unknown worktree: wt-nope"),
		);
		const handler = register(() => repository);
		await expect(
			handler({}, { workspaceId: "wk-ok", worktreeId: "wt-nope" }),
		).rejects.toThrow(/Unknown worktree/);
		expect(worktreeServiceInstance.findWorktree).toHaveBeenCalledWith(
			repository,
			"wt-nope",
		);
		expect(fileServiceInstance.listTrackedFiles).not.toHaveBeenCalled();
	});

	it("resolves identity and returns the tracked file list on the happy path", async () => {
		const repository = { repoId: "repo-1", rootPath: "/tmp/repo" };
		const worktree = {
			id: "wt-ok",
			repositoryId: "repo-1",
			branchName: "main",
			path: "/tmp/repo/.worktrees/main",
			label: "main",
			isMain: true,
		};
		worktreeServiceInstance.findWorktree.mockResolvedValueOnce(worktree);
		fileServiceInstance.listTrackedFiles.mockResolvedValueOnce([
			"README.md",
			"src/index.ts",
		]);
		const handler = register(() => repository);
		const result = await handler(
			{},
			{ workspaceId: "wk-ok", worktreeId: "wt-ok" },
		);
		expect(result).toEqual(["README.md", "src/index.ts"]);
		expect(worktreeServiceInstance.findWorktree).toHaveBeenCalledWith(
			repository,
			"wt-ok",
		);
		expect(fileServiceInstance.listTrackedFiles).toHaveBeenCalledWith(
			"/tmp/repo/.worktrees/main",
		);
	});

	it("rejects malformed payloads via schema validation", async () => {
		const handler = register(() => ({ repoId: "x", rootPath: "/tmp/x" }));
		await expect(handler({}, { worktreeId: "wt-x" })).rejects.toThrow();
		await expect(
			handler({}, { workspaceId: "", worktreeId: "wt-x" }),
		).rejects.toThrow();
		expect(worktreeServiceInstance.findWorktree).not.toHaveBeenCalled();
	});
});
