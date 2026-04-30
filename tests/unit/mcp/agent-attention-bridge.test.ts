import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
	AgentAttentionBridge,
	BridgeDisposedError,
	BridgeTimeoutError,
	RendererGoneError,
	RendererNotReadyError,
} from "../../../services/mcp/agent-attention-bridge";
import {
	AGENT_ATTENTION_BRIDGE_GOODBYE,
	AGENT_ATTENTION_BRIDGE_READY,
	AGENT_ATTENTION_BRIDGE_REPLY,
} from "../../../shared/contracts/agent-attention-bridge";

function makeFakeIpcMain() {
	const ee = new EventEmitter();
	return {
		on: (channel: string, handler: (_: unknown, ...args: unknown[]) => void) =>
			ee.on(channel, handler),
		removeListener: (channel: string, handler: (...args: unknown[]) => void) =>
			ee.removeListener(channel, handler),
		listenerCount: (channel: string) => ee.listenerCount(channel),
		emit: (channel: string, ...args: unknown[]) =>
			ee.emit(channel, {} as unknown, ...args),
	};
}

function makeFakeWebContents() {
	return { send: vi.fn() };
}

const basePayload = {
	worktreeId: "w1",
	state: "ready" as const,
	summary: "x",
	nextAction: null,
	reportedAt: 1,
};

describe("AgentAttentionBridge — readiness", () => {
	let ipc: ReturnType<typeof makeFakeIpcMain>;
	let wc: ReturnType<typeof makeFakeWebContents>;

	beforeEach(() => {
		ipc = makeFakeIpcMain();
		wc = makeFakeWebContents();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("rejects with RendererNotReadyError before READY", async () => {
		const bridge = new AgentAttentionBridge(
			() => wc as unknown as Electron.WebContents,
			{ ipcMain: ipc as unknown as Electron.IpcMain },
		);
		await expect(bridge.report(basePayload)).rejects.toBeInstanceOf(
			RendererNotReadyError,
		);
		expect(wc.send).not.toHaveBeenCalled();
		bridge.dispose();
	});

	it("rejects RendererNotReadyError if getWebContents returns null", async () => {
		const bridge = new AgentAttentionBridge(() => null, {
			ipcMain: ipc as unknown as Electron.IpcMain,
		});
		ipc.emit(AGENT_ATTENTION_BRIDGE_READY);
		await expect(bridge.report(basePayload)).rejects.toBeInstanceOf(
			RendererNotReadyError,
		);
		bridge.dispose();
	});

	it("flips ready on READY and back on GOODBYE", async () => {
		const bridge = new AgentAttentionBridge(
			() => wc as unknown as Electron.WebContents,
			{ ipcMain: ipc as unknown as Electron.IpcMain },
		);
		ipc.emit(AGENT_ATTENTION_BRIDGE_READY);
		const pending = bridge.report(basePayload).catch(() => undefined);
		expect(wc.send).toHaveBeenCalledTimes(1);
		ipc.emit(AGENT_ATTENTION_BRIDGE_GOODBYE);
		await pending;

		await expect(bridge.report(basePayload)).rejects.toBeInstanceOf(
			RendererNotReadyError,
		);
		bridge.dispose();
	});
});

describe("AgentAttentionBridge — request/reply", () => {
	let ipc: ReturnType<typeof makeFakeIpcMain>;
	let wc: ReturnType<typeof makeFakeWebContents>;
	let bridge: AgentAttentionBridge;

	beforeEach(() => {
		ipc = makeFakeIpcMain();
		wc = makeFakeWebContents();
		bridge = new AgentAttentionBridge(
			() => wc as unknown as Electron.WebContents,
			{
				ipcMain: ipc as unknown as Electron.IpcMain,
				timeoutMs: 50,
			},
		);
		ipc.emit(AGENT_ATTENTION_BRIDGE_READY);
	});

	afterEach(() => {
		bridge.dispose();
	});

	it("resolves with undefined on ok reply", async () => {
		const promise = bridge.report(basePayload);
		expect(wc.send).toHaveBeenCalledTimes(1);
		const [, sentReq] = wc.send.mock.calls[0];
		const id = (sentReq as { id: string }).id;
		ipc.emit(AGENT_ATTENTION_BRIDGE_REPLY, { id, ok: true });
		await expect(promise).resolves.toBeUndefined();
	});

	it("rejects with error from error reply", async () => {
		const promise = bridge.report(basePayload);
		const [, sentReq] = wc.send.mock.calls[0];
		const id = (sentReq as { id: string }).id;
		ipc.emit(AGENT_ATTENTION_BRIDGE_REPLY, {
			id,
			ok: false,
			error: "some_error",
			message: "something went wrong",
		});
		await expect(promise).rejects.toMatchObject({
			message: "something went wrong",
			code: "some_error",
		});
	});

	it("rejects BridgeTimeoutError after timeoutMs with no reply", async () => {
		await expect(bridge.report(basePayload)).rejects.toBeInstanceOf(
			BridgeTimeoutError,
		);
	});

	it("drops replies for unknown ids without throwing", async () => {
		const promise = bridge.report(basePayload);
		const [, sentReq] = wc.send.mock.calls[0];
		const realId = (sentReq as { id: string }).id;
		expect(() =>
			ipc.emit(AGENT_ATTENTION_BRIDGE_REPLY, {
				id: "unknown",
				ok: true,
			}),
		).not.toThrow();
		ipc.emit(AGENT_ATTENTION_BRIDGE_REPLY, { id: realId, ok: true });
		await expect(promise).resolves.toBeUndefined();
	});

	it("goodbye rejects in-flight requests with RendererGoneError", async () => {
		const promise = bridge.report(basePayload);
		ipc.emit(AGENT_ATTENTION_BRIDGE_GOODBYE);
		await expect(promise).rejects.toBeInstanceOf(RendererGoneError);
	});
});

describe("AgentAttentionBridge — dispose", () => {
	it("rejects pending requests with BridgeDisposedError, removes listeners, idempotent", async () => {
		const ipc = makeFakeIpcMain();
		const wc = makeFakeWebContents();
		const bridge = new AgentAttentionBridge(
			() => wc as unknown as Electron.WebContents,
			{
				ipcMain: ipc as unknown as Electron.IpcMain,
				timeoutMs: 5000,
			},
		);
		ipc.emit(AGENT_ATTENTION_BRIDGE_READY);
		const promise = bridge.report(basePayload);

		expect(ipc.listenerCount(AGENT_ATTENTION_BRIDGE_READY)).toBe(1);
		expect(ipc.listenerCount(AGENT_ATTENTION_BRIDGE_GOODBYE)).toBe(1);
		expect(ipc.listenerCount(AGENT_ATTENTION_BRIDGE_REPLY)).toBe(1);

		bridge.dispose();

		expect(ipc.listenerCount(AGENT_ATTENTION_BRIDGE_READY)).toBe(0);
		expect(ipc.listenerCount(AGENT_ATTENTION_BRIDGE_GOODBYE)).toBe(0);
		expect(ipc.listenerCount(AGENT_ATTENTION_BRIDGE_REPLY)).toBe(0);

		await expect(promise).rejects.toBeInstanceOf(BridgeDisposedError);

		// Idempotent
		expect(() => bridge.dispose()).not.toThrow();
	});
});
