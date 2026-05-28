import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCloseGate,
	type CloseGateWindow,
} from "../../../electron/main/close-gate";

type CapturedListener = (event: { preventDefault(): void }) => void;

function makeFakeWindow(): {
	window: CloseGateWindow;
	send: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	emitClose: () => { defaultPrevented: boolean };
} {
	let listener: CapturedListener | null = null;
	const send = vi.fn();
	const destroy = vi.fn();
	const window: CloseGateWindow = {
		on(event, l) {
			if (event === "close") listener = l;
			return window;
		},
		webContents: { send },
		destroy,
	};
	return {
		window,
		send,
		destroy,
		emitClose: () => {
			let defaultPrevented = false;
			listener?.({
				preventDefault: () => {
					defaultPrevented = true;
				},
			});
			return { defaultPrevented };
		},
	};
}

describe("close-gate", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows the default close when no editor is dirty", () => {
		const gate = createCloseGate();
		const { window, emitClose, destroy, send } = makeFakeWindow();
		gate.attach(window);
		expect(emitClose().defaultPrevented).toBe(false);
		expect(send).not.toHaveBeenCalled();
		expect(destroy).not.toHaveBeenCalled();
	});

	it("prevents close and sends app:requestClose when dirty", () => {
		const gate = createCloseGate();
		const { window, emitClose, send, destroy } = makeFakeWindow();
		gate.attach(window);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: true,
		});
		const { defaultPrevented } = emitClose();
		expect(defaultPrevented).toBe(true);
		expect(send).toHaveBeenCalledWith("app:requestClose", {
			keys: ["ws|wt|a.md"],
		});
		expect(destroy).not.toHaveBeenCalled();
	});

	it("destroys the window when renderer replies with proceed=true", () => {
		const gate = createCloseGate();
		const { window, emitClose, destroy } = makeFakeWindow();
		gate.attach(window);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: true,
		});
		emitClose();
		gate.confirmClose({ proceed: true });
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("does not destroy when renderer replies with proceed=false", () => {
		const gate = createCloseGate();
		const { window, emitClose, destroy } = makeFakeWindow();
		gate.attach(window);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: true,
		});
		emitClose();
		gate.confirmClose({ proceed: false });
		expect(destroy).not.toHaveBeenCalled();
	});

	it("destroys the window when the renderer does not reply within the safety timeout", () => {
		const gate = createCloseGate({ replyTimeoutMs: 1000 });
		const { window, emitClose, destroy } = makeFakeWindow();
		gate.attach(window);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: true,
		});
		emitClose();
		expect(destroy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(999);
		expect(destroy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("clears the dirty entry on dirty:false and lets next close proceed", () => {
		const gate = createCloseGate();
		const { window, emitClose, send } = makeFakeWindow();
		gate.attach(window);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: true,
		});
		expect(gate.isAnyDirty()).toBe(true);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: false,
		});
		expect(gate.isAnyDirty()).toBe(false);
		expect(emitClose().defaultPrevented).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});

	it("blocks duplicate close events while a confirmation is pending", () => {
		const gate = createCloseGate();
		const { window, emitClose, send, destroy } = makeFakeWindow();
		gate.attach(window);
		gate.setDirty({
			workspaceId: "ws",
			worktreeId: "wt",
			relativePath: "a.md",
			dirty: true,
		});
		emitClose();
		const second = emitClose();
		expect(second.defaultPrevented).toBe(true);
		expect(send).toHaveBeenCalledTimes(1); // not duplicated
		expect(destroy).not.toHaveBeenCalled();
	});
});
