import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
	SessionNoteBridge,
	RendererNotReadyError,
	BridgeTimeoutError,
	RendererGoneError,
	BridgeDisposedError,
} from "../../../services/mcp/session-note-bridge";
import {
	NOTE_BRIDGE_READY,
	NOTE_BRIDGE_GOODBYE,
	NOTE_BRIDGE_REPLY,
} from "../../../shared/contracts/note-bridge";

// Fake ipcMain — emits events the same way Electron's ipcMain does.
function makeFakeIpcMain() {
	const ee = new EventEmitter();
	return {
		on: (channel: string, handler: (_: unknown, ...args: unknown[]) => void) =>
			ee.on(channel, handler),
		removeListener: (
			channel: string,
			handler: (...args: unknown[]) => void,
		) => ee.removeListener(channel, handler),
		listenerCount: (channel: string) => ee.listenerCount(channel),
		emit: (channel: string, ...args: unknown[]) =>
			ee.emit(channel, {} as unknown, ...args),
	};
}

function makeFakeWebContents() {
	return { send: vi.fn() };
}

describe("SessionNoteBridge — readiness", () => {
	let ipc: ReturnType<typeof makeFakeIpcMain>;
	let wc: ReturnType<typeof makeFakeWebContents>;

	beforeEach(() => {
		ipc = makeFakeIpcMain();
		wc = makeFakeWebContents();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("rejects with RendererNotReadyError before mcp:note:ready", async () => {
		const bridge = new SessionNoteBridge(() => wc as unknown as Electron.WebContents, {
			ipcMain: ipc as unknown as Electron.IpcMain,
		});
		await expect(bridge.read("wt-1")).rejects.toBeInstanceOf(
			RendererNotReadyError,
		);
		expect(wc.send).not.toHaveBeenCalled();
		bridge.dispose();
	});

	it("rejects RendererNotReadyError if getWebContents returns null", async () => {
		const bridge = new SessionNoteBridge(() => null, {
			ipcMain: ipc as unknown as Electron.IpcMain,
		});
		ipc.emit(NOTE_BRIDGE_READY); // ready, but no webContents
		await expect(bridge.read("wt-1")).rejects.toBeInstanceOf(
			RendererNotReadyError,
		);
		bridge.dispose();
	});

	it("flips ready on mcp:note:ready and back on mcp:note:goodbye", async () => {
		const bridge = new SessionNoteBridge(() => wc as unknown as Electron.WebContents, {
			ipcMain: ipc as unknown as Electron.IpcMain,
		});
		ipc.emit(NOTE_BRIDGE_READY);
		// After ready: a request is dispatched (we don't care about reply for this test —
		// it will time out, which we'll cover later). Just assert the IPC send happened.
		const pending = bridge.read("wt-1").catch(() => undefined);
		expect(wc.send).toHaveBeenCalledTimes(1);
		ipc.emit(NOTE_BRIDGE_GOODBYE);
		await pending; // pending request was rejected by goodbye

		await expect(bridge.read("wt-1")).rejects.toBeInstanceOf(
			RendererNotReadyError,
		);
		bridge.dispose();
	});
});

describe("SessionNoteBridge — request/reply", () => {
	let ipc: ReturnType<typeof makeFakeIpcMain>;
	let wc: ReturnType<typeof makeFakeWebContents>;
	let bridge: SessionNoteBridge;

	beforeEach(() => {
		ipc = makeFakeIpcMain();
		wc = makeFakeWebContents();
		bridge = new SessionNoteBridge(() => wc as unknown as Electron.WebContents, {
			ipcMain: ipc as unknown as Electron.IpcMain,
			timeoutMs: 50,
		});
		ipc.emit(NOTE_BRIDGE_READY);
	});

	afterEach(() => {
		bridge.dispose();
	});

	it("append: resolves with note + appendedSection from reply", async () => {
		const promise = bridge.append("wt-1", "Idea", "body");
		expect(wc.send).toHaveBeenCalledTimes(1);
		const [, sentReq] = wc.send.mock.calls[0];
		const id = (sentReq as { id: string }).id;
		ipc.emit(NOTE_BRIDGE_REPLY, {
			id,
			ok: true,
			op: "append",
			note: "## Idea — 2026-04-28 14:32\n\nbody",
			appendedSection: "## Idea — 2026-04-28 14:32",
		});
		await expect(promise).resolves.toEqual({
			note: "## Idea — 2026-04-28 14:32\n\nbody",
			appendedSection: "## Idea — 2026-04-28 14:32",
		});
	});

	it("read: resolves with note from reply", async () => {
		const promise = bridge.read("wt-1");
		const [, sentReq] = wc.send.mock.calls[0];
		const id = (sentReq as { id: string }).id;
		ipc.emit(NOTE_BRIDGE_REPLY, {
			id,
			ok: true,
			op: "read",
			note: "existing",
		});
		await expect(promise).resolves.toEqual({ note: "existing" });
	});

	it("rejects with no_session error from reply", async () => {
		const promise = bridge.read("wt-missing");
		const [, sentReq] = wc.send.mock.calls[0];
		const id = (sentReq as { id: string }).id;
		ipc.emit(NOTE_BRIDGE_REPLY, {
			id,
			ok: false,
			error: "no_session",
			message: "no session for worktreeId",
		});
		await expect(promise).rejects.toMatchObject({
			message: "no session for worktreeId",
			code: "no_session",
		});
	});

	it("rejects BridgeTimeoutError after timeoutMs with no reply", async () => {
		await expect(bridge.read("wt-1")).rejects.toBeInstanceOf(
			BridgeTimeoutError,
		);
	});

	it("drops replies for unknown ids without throwing", async () => {
		const promise = bridge.read("wt-1");
		const [, sentReq] = wc.send.mock.calls[0];
		const realId = (sentReq as { id: string }).id;
		// Unknown id
		expect(() =>
			ipc.emit(NOTE_BRIDGE_REPLY, {
				id: "unknown",
				ok: true,
				op: "read",
				note: "x",
			}),
		).not.toThrow();
		// Real id still resolves correctly
		ipc.emit(NOTE_BRIDGE_REPLY, {
			id: realId,
			ok: true,
			op: "read",
			note: "y",
		});
		await expect(promise).resolves.toEqual({ note: "y" });
	});

	it("goodbye rejects in-flight requests with RendererGoneError", async () => {
		const promise = bridge.read("wt-1");
		ipc.emit(NOTE_BRIDGE_GOODBYE);
		await expect(promise).rejects.toBeInstanceOf(RendererGoneError);
	});
});

describe("SessionNoteBridge — dispose", () => {
	it("rejects pending requests with BridgeDisposedError, removes listeners, idempotent", async () => {
		const ipc = makeFakeIpcMain();
		const wc = makeFakeWebContents();
		const bridge = new SessionNoteBridge(
			() => wc as unknown as Electron.WebContents,
			{
				ipcMain: ipc as unknown as Electron.IpcMain,
				timeoutMs: 5000,
			},
		);
		ipc.emit(NOTE_BRIDGE_READY);
		const promise = bridge.read("wt-1");

		expect(ipc.listenerCount(NOTE_BRIDGE_READY)).toBe(1);
		expect(ipc.listenerCount(NOTE_BRIDGE_GOODBYE)).toBe(1);
		expect(ipc.listenerCount(NOTE_BRIDGE_REPLY)).toBe(1);

		bridge.dispose();

		expect(ipc.listenerCount(NOTE_BRIDGE_READY)).toBe(0);
		expect(ipc.listenerCount(NOTE_BRIDGE_GOODBYE)).toBe(0);
		expect(ipc.listenerCount(NOTE_BRIDGE_REPLY)).toBe(0);

		await expect(promise).rejects.toBeInstanceOf(BridgeDisposedError);

		// Idempotent
		expect(() => bridge.dispose()).not.toThrow();
	});
});
