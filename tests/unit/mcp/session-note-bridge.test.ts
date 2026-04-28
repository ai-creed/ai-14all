import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
	SessionNoteBridge,
	RendererNotReadyError,
} from "../../../services/mcp/session-note-bridge";
import {
	NOTE_BRIDGE_READY,
	NOTE_BRIDGE_GOODBYE,
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
