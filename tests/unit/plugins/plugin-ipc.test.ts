import { describe, expect, it, vi } from "vitest";
import {
	PLUGINS_AGENT_CLIS,
	PLUGINS_LIST,
	PLUGINS_REPROBE,
	PLUGINS_SET_ENABLED,
	PLUGINS_STATE_CHANGED,
	PLUGINS_WHISPER_COMMAND,
} from "../../../shared/contracts/plugins";
import { registerPluginIpc } from "../../../services/plugins/plugin-ipc";

function makeFakeIpcMain() {
	const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
	return {
		handle: (
			channel: string,
			fn: (event: unknown, raw: unknown) => unknown,
		) => {
			handlers.set(channel, fn);
		},
		removeHandler: (channel: string) => handlers.delete(channel),
		invoke: (channel: string, raw?: unknown) =>
			handlers.get(channel)?.({}, raw),
	};
}

function makeFakeRegistry() {
	let snapshotListener: ((s: unknown[]) => void) | null = null;
	return {
		snapshots: vi.fn(() => [
			{
				id: "whisper",
				enabled: false,
				installPath: null,
				status: { state: "not-installed" },
			},
		]),
		onSnapshots: vi.fn((cb: (s: unknown[]) => void) => {
			snapshotListener = cb;
			return () => {};
		}),
		reprobe: vi.fn(async () => {}),
		idle: vi.fn(async () => {}),
		emit: (s: unknown[]) => snapshotListener?.(s),
	};
}

describe("registerPluginIpc", () => {
	it("plugins:list returns registry snapshots", async () => {
		const ipcMain = makeFakeIpcMain();
		const registry = makeFakeRegistry();
		const config = { setEnabled: vi.fn(), get: vi.fn() };
		const webContents = { send: vi.fn() };
		registerPluginIpc({
			ipcMain: ipcMain as never,
			registry: registry as never,
			config: config as never,
			resolveWorktreeCwd: vi.fn(async () => "/resolved"),
			runWhisperCommand: vi.fn(),
			probes: {
				agentClis: vi.fn(async () => ({}) as never),
				invalidate: vi.fn(),
			},
			getWebContents: () => webContents as never,
		});
		const result = await ipcMain.invoke(PLUGINS_LIST);
		expect(result).toEqual(registry.snapshots());
	});

	it("plugins:setEnabled validates payload, writes config, returns fresh snapshots", async () => {
		const ipcMain = makeFakeIpcMain();
		const registry = makeFakeRegistry();
		const config = { setEnabled: vi.fn(), get: vi.fn() };
		registerPluginIpc({
			ipcMain: ipcMain as never,
			registry: registry as never,
			config: config as never,
			resolveWorktreeCwd: vi.fn(async () => "/resolved"),
			runWhisperCommand: vi.fn(),
			probes: {
				agentClis: vi.fn(async () => ({}) as never),
				invalidate: vi.fn(),
			},
			getWebContents: () => null,
		});
		await ipcMain.invoke(PLUGINS_SET_ENABLED, { id: "whisper", enabled: true });
		expect(config.setEnabled).toHaveBeenCalledWith("whisper", true);
		await expect(
			ipcMain.invoke(PLUGINS_SET_ENABLED, { id: "evil", enabled: true }),
		).rejects.toThrow();
	});

	it("plugins:whisperCommand resolves cwd server-side from ids", async () => {
		const ipcMain = makeFakeIpcMain();
		const registry = makeFakeRegistry();
		const resolveWorktreeCwd = vi.fn(async () => "/resolved/worktree");
		const runWhisperCommand = vi.fn(async () => ({
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		registerPluginIpc({
			ipcMain: ipcMain as never,
			registry: registry as never,
			config: { setEnabled: vi.fn(), get: vi.fn() } as never,
			resolveWorktreeCwd,
			runWhisperCommand,
			probes: {
				agentClis: vi.fn(async () => ({}) as never),
				invalidate: vi.fn(),
			},
			getWebContents: () => null,
		});
		const command = {
			kind: "workflow-pause",
			workflowId: "wf1",
			workspaceId: "ws-1",
			worktreeId: "wt-1",
		};
		await ipcMain.invoke(PLUGINS_WHISPER_COMMAND, command);
		expect(resolveWorktreeCwd).toHaveBeenCalledWith("ws-1", "wt-1");
		expect(runWhisperCommand).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "workflow-pause" }),
			"/resolved/worktree",
		);
	});

	it("plugins:whisperCommand rejects when id resolution throws (unknown id)", async () => {
		const ipcMain = makeFakeIpcMain();
		registerPluginIpc({
			ipcMain: ipcMain as never,
			registry: makeFakeRegistry() as never,
			config: { setEnabled: vi.fn(), get: vi.fn() } as never,
			resolveWorktreeCwd: vi.fn(async () => {
				throw new Error("unknown workspace");
			}),
			runWhisperCommand: vi.fn(),
			probes: {
				agentClis: vi.fn(async () => ({}) as never),
				invalidate: vi.fn(),
			},
			getWebContents: () => null,
		});
		await expect(
			ipcMain.invoke(PLUGINS_WHISPER_COMMAND, {
				kind: "collab-recover",
				workspaceId: "nope",
				worktreeId: "nope",
			}),
		).rejects.toThrow();
	});

	it("plugins:agentClis returns probe-service results; reprobe + toggle invalidate the cache", async () => {
		const ipcMain = makeFakeIpcMain();
		const registry = makeFakeRegistry();
		const agentClis = vi.fn(async () => ({
			claude: { kind: "found", path: "/bin/claude", version: "1.2.3" },
			codex: { kind: "not-found" },
		}));
		const invalidate = vi.fn();
		registerPluginIpc({
			ipcMain: ipcMain as never,
			registry: registry as never,
			config: { setEnabled: vi.fn(), get: vi.fn() } as never,
			resolveWorktreeCwd: vi.fn(async () => "/resolved"),
			runWhisperCommand: vi.fn(),
			probes: { agentClis: agentClis as never, invalidate },
			getWebContents: () => null,
		});
		const result = await ipcMain.invoke(PLUGINS_AGENT_CLIS);
		expect(result).toEqual(await agentClis());
		await ipcMain.invoke(PLUGINS_REPROBE);
		expect(invalidate).toHaveBeenCalledTimes(1);
		await ipcMain.invoke(PLUGINS_SET_ENABLED, { id: "whisper", enabled: true });
		expect(invalidate).toHaveBeenCalledTimes(2);
	});

	it("pushes registry snapshot changes to the renderer", () => {
		const ipcMain = makeFakeIpcMain();
		const registry = makeFakeRegistry();
		const webContents = { send: vi.fn() };
		registerPluginIpc({
			ipcMain: ipcMain as never,
			registry: registry as never,
			config: { setEnabled: vi.fn(), get: vi.fn() } as never,
			resolveWorktreeCwd: vi.fn(async () => "/resolved"),
			runWhisperCommand: vi.fn(),
			probes: {
				agentClis: vi.fn(async () => ({}) as never),
				invalidate: vi.fn(),
			},
			getWebContents: () => webContents as never,
		});
		registry.emit([{ id: "whisper" }]);
		expect(webContents.send).toHaveBeenCalledWith(PLUGINS_STATE_CHANGED, [
			{ id: "whisper" },
		]);
	});
});
