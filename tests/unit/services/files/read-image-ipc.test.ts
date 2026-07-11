// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors the harness in tests/unit/electron/ipc.test.ts: registerIpcHandlers
// constructs its own FileService internally, so intercepting `new FileService()`
// via module mocking is the only way to observe the resolved-path call.
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
		listRemoteBranches: vi.fn(),
		refreshRemote: vi.fn(),
	};
	const fileServiceInstance = {
		listFiles: vi.fn(),
		listScopedFiles: vi.fn(),
		listWorktreeFiles: vi.fn(),
		readFile: vi.fn(),
		readImage: vi.fn(),
	};
	return { worktreeServiceInstance, fileServiceInstance };
});

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp/test-home"),
		getAppPath: vi.fn(() => "/tmp/app-resources"),
	},
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: handleMock, on: vi.fn() },
	BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock("../../../../services/worktrees/worktree-service.js", () => {
	function WorktreeService(this: unknown) {
		return worktreeServiceInstance;
	}
	return { WorktreeService };
});

vi.mock("../../../../services/files/file-service.js", () => {
	function FileService(this: unknown) {
		return fileServiceInstance;
	}
	return { FileService };
});

import { registerIpcHandlers } from "../../../../electron/main/ipc.js";

describe("registerIpcHandlers files:readImage identity resolution", () => {
	beforeEach(() => {
		handlers.clear();
		handleMock.mockClear();
		worktreeServiceInstance.findWorktree.mockReset();
		fileServiceInstance.readImage.mockReset();
	});

	const register = (registryGet: (workspaceId: string) => unknown) => {
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
				settingsService: {
					readState: vi.fn(),
					readStateSync: vi.fn(),
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
		const handler = handlers.get("files:readImage");
		expect(handler).toBeTypeOf("function");
		return handler!;
	};

	it("rejects unknown workspaceId via the resolver-thrown error", async () => {
		const handler = register(() => {
			throw new Error("Unknown workspace: wk-nope");
		});

		await expect(
			handler(
				{},
				{ workspaceId: "wk-nope", worktreeId: "t", relativePath: "a.png" },
			),
		).rejects.toThrow(/Unknown workspace/);
		expect(worktreeServiceInstance.findWorktree).not.toHaveBeenCalled();
		expect(fileServiceInstance.readImage).not.toHaveBeenCalled();
	});

	it("resolves the worktree server-side and passes the resolved path", async () => {
		const repository = { repoId: "repo-1", rootPath: "/tmp/repo" };
		const worktree = {
			id: "wt-ok",
			repositoryId: "repo-1",
			branchName: "main",
			path: "/resolved/wt",
			label: "main",
			isMain: true,
		};
		worktreeServiceInstance.findWorktree.mockResolvedValueOnce(worktree);
		fileServiceInstance.readImage.mockResolvedValueOnce({
			ok: true,
			base64: "Zm9v",
			mime: "image/png",
			byteLength: 3,
		});

		const handler = register(() => repository);
		const result = await handler(
			{},
			{ workspaceId: "ws1", worktreeId: "t", relativePath: "a.png" },
		);

		expect(worktreeServiceInstance.findWorktree).toHaveBeenCalledWith(
			repository,
			"t",
		);
		expect(fileServiceInstance.readImage).toHaveBeenCalledWith(
			"/resolved/wt",
			"a.png",
		);
		expect(result).toEqual({
			ok: true,
			base64: "Zm9v",
			mime: "image/png",
			byteLength: 3,
		});
	});

	it("rejects malformed payloads via schema validation", async () => {
		const handler = register(() => ({ repoId: "x", rootPath: "/tmp/x" }));

		await expect(
			handler({}, { worktreeId: "t", relativePath: "a.png" }),
		).rejects.toThrow();
		await expect(
			handler({}, { workspaceId: "", worktreeId: "t", relativePath: "a.png" }),
		).rejects.toThrow();
		expect(worktreeServiceInstance.findWorktree).not.toHaveBeenCalled();
		expect(fileServiceInstance.readImage).not.toHaveBeenCalled();
	});
});
