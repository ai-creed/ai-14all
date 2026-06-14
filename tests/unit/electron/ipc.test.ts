// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, handleMock, listeners, onMock } = vi.hoisted(() => {
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
	const listeners = new Map<
		string,
		(event: unknown, payload: unknown) => unknown
	>();
	const onMock = vi.fn(
		(
			channel: string,
			listener: (event: unknown, payload: unknown) => unknown,
		) => {
			listeners.set(channel, listener);
		},
	);
	return { handlers, handleMock, listeners, onMock };
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
		listWorktreeFiles: vi.fn(),
		readFile: vi.fn(),
	};
	return { worktreeServiceInstance, fileServiceInstance };
});

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp/test-home"),
		getAppPath: vi.fn(() => "/tmp/app-resources"),
	},
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: handleMock, on: onMock },
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
		listeners.clear();
		onMock.mockClear();
	});

	const registerWith = (overrides: {
		shellEventLog?: unknown;
		agentAttentionLogger?: unknown;
	}) => {
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
				shellEventLog: overrides.shellEventLog as never,
				agentAttentionLogger: overrides.agentAttentionLogger as never,
				review: {
					service: {
						onChange: vi.fn(() => () => {}),
						removeByWorktree: vi.fn(),
						listByWorktree: vi.fn(() => []),
						create: vi.fn(),
						markAddressed: vi.fn(),
						reopen: vi.fn(),
						delete: vi.fn(),
						rebaseWorktreeIds: vi.fn(),
					},
					mcpStatus: { port: null, bindError: null, getUrl: () => null },
					worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() },
				} as never,
				getCortexEnabled: () => false,
			},
		);
	};

	const validAttentionEvent = {
		type: "classifier" as const,
		ts: 1700000000000,
		worktreeId: "w1",
		processId: "p1",
		provider: "claude" as const,
		state: "failed" as const,
		matchedPattern: "\\b(error|failed|exception)\\b",
		inputSample: "Error: boom",
		inputPrev: "",
	};

	it("registers diagnostics:attention-event as a one-way listener and forwards valid payloads", () => {
		const appendMock = vi.fn().mockResolvedValue(undefined);
		registerWith({ agentAttentionLogger: { append: appendMock } });

		const listener = listeners.get("diagnostics:attention-event");
		expect(listener).toBeTypeOf("function");
		listener?.({}, validAttentionEvent);

		expect(appendMock).toHaveBeenCalledWith(
			expect.objectContaining({ type: "classifier", state: "failed" }),
		);
	});

	it("drops malformed attention payloads without calling the logger", () => {
		const appendMock = vi.fn().mockResolvedValue(undefined);
		registerWith({ agentAttentionLogger: { append: appendMock } });

		const listener = listeners.get("diagnostics:attention-event");
		listener?.({}, { type: "classifier", state: "not-a-state" });

		expect(appendMock).not.toHaveBeenCalled();
	});

	it("does not throw when the attention logger is absent", () => {
		registerWith({ agentAttentionLogger: undefined });

		const listener = listeners.get("diagnostics:attention-event");
		expect(() => listener?.({}, validAttentionEvent)).not.toThrow();
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
				review: {
					service: {
						onChange: vi.fn(() => () => {}),
						removeByWorktree: vi.fn(),
						listByWorktree: vi.fn(() => []),
						create: vi.fn(),
						markAddressed: vi.fn(),
						reopen: vi.fn(),
						delete: vi.fn(),
						rebaseWorktreeIds: vi.fn(),
					},
					mcpStatus: { port: null, bindError: null, getUrl: () => null },
					worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() },
				} as never,
				getCortexEnabled: () => false,
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
				review: {
					service: {
						onChange: vi.fn(() => () => {}),
						removeByWorktree: vi.fn(),
						listByWorktree: vi.fn(() => []),
						create: vi.fn(),
						markAddressed: vi.fn(),
						reopen: vi.fn(),
						delete: vi.fn(),
						rebaseWorktreeIds: vi.fn(),
					},
					mcpStatus: { port: null, bindError: null, getUrl: () => null },
					worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() },
				} as never,
				getCortexEnabled: () => false,
			},
		);

		const handler = handlers.get("diagnostics:logShellEvent");
		const result = await Promise.resolve(handler?.({}, { bad: true }));
		expect(result).toBeUndefined();
		expect(logMock).not.toHaveBeenCalled();
	});
});

describe("registerIpcHandlers files:listWorktree identity resolution", () => {
	beforeEach(() => {
		handlers.clear();
		handleMock.mockClear();
		worktreeServiceInstance.findWorktree.mockReset();
		fileServiceInstance.listWorktreeFiles.mockReset();
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
				review: {
					service: {
						onChange: vi.fn(() => () => {}),
						removeByWorktree: vi.fn(),
						listByWorktree: vi.fn(() => []),
						create: vi.fn(),
						markAddressed: vi.fn(),
						reopen: vi.fn(),
						delete: vi.fn(),
						rebaseWorktreeIds: vi.fn(),
					},
					mcpStatus: { port: null, bindError: null, getUrl: () => null },
					worktreePathResolver: { resolve: vi.fn(), refresh: vi.fn() },
				} as never,
				getCortexEnabled: () => false,
			},
		);
		const handler = handlers.get("files:listWorktree");
		expect(handler).toBeTypeOf("function");
		return handler!;
	};

	it("rejects when the workspaceId is unknown", async () => {
		const handler = register(() => {
			throw new Error("Unknown workspace: wk-nope");
		});
		await expect(
			handler(
				{},
				{
					workspaceId: "wk-nope",
					worktreeId: "wt-x",
					includeIgnored: false,
				},
			),
		).rejects.toThrow(/Unknown workspace/);
		expect(worktreeServiceInstance.findWorktree).not.toHaveBeenCalled();
		expect(fileServiceInstance.listWorktreeFiles).not.toHaveBeenCalled();
	});

	it("rejects when the worktreeId is unknown under a known workspace", async () => {
		const repository = { repoId: "repo-1", rootPath: "/tmp/repo" };
		worktreeServiceInstance.findWorktree.mockRejectedValueOnce(
			new Error("Unknown worktree: wt-nope"),
		);
		const handler = register(() => repository);
		await expect(
			handler(
				{},
				{
					workspaceId: "wk-ok",
					worktreeId: "wt-nope",
					includeIgnored: false,
				},
			),
		).rejects.toThrow(/Unknown worktree/);
		expect(worktreeServiceInstance.findWorktree).toHaveBeenCalledWith(
			repository,
			"wt-nope",
		);
		expect(fileServiceInstance.listWorktreeFiles).not.toHaveBeenCalled();
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
		fileServiceInstance.listWorktreeFiles.mockResolvedValueOnce([
			{ path: "README.md", ignored: false },
			{ path: "src/index.ts", ignored: false },
		]);
		const handler = register(() => repository);
		const result = await handler(
			{},
			{ workspaceId: "wk-ok", worktreeId: "wt-ok", includeIgnored: false },
		);
		expect(result).toEqual([
			{ path: "README.md", ignored: false },
			{ path: "src/index.ts", ignored: false },
		]);
		expect(worktreeServiceInstance.findWorktree).toHaveBeenCalledWith(
			repository,
			"wt-ok",
		);
		expect(fileServiceInstance.listWorktreeFiles).toHaveBeenCalledWith(
			"/tmp/repo/.worktrees/main",
			{ includeIgnored: false },
		);
	});

	it("rejects malformed payloads via schema validation", async () => {
		const handler = register(() => ({ repoId: "x", rootPath: "/tmp/x" }));
		await expect(
			handler({}, { worktreeId: "wt-x", includeIgnored: false }),
		).rejects.toThrow();
		await expect(
			handler(
				{},
				{ workspaceId: "", worktreeId: "wt-x", includeIgnored: false },
			),
		).rejects.toThrow();
		await expect(
			handler({}, { workspaceId: "wk-ok", worktreeId: "wt-x" }),
		).rejects.toThrow();
		expect(worktreeServiceInstance.findWorktree).not.toHaveBeenCalled();
	});
});
