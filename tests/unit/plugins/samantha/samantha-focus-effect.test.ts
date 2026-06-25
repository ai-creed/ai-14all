import { describe, expect, it, vi } from "vitest";
import { createFocusWorktreeEffect } from "../../../../services/plugins/samantha/samantha-focus-effect";

function make(focusRaisesWindow: boolean) {
	const send = vi.fn();
	const raiseWindow = vi.fn();
	const effect = createFocusWorktreeEffect({
		send,
		raiseWindow,
		getFocusRaisesWindow: () => focusRaisesWindow,
	});
	return { effect, send, raiseWindow };
}

describe("createFocusWorktreeEffect", () => {
	it("always sends the focus IPC and raises the window when the knob is true", () => {
		const { effect, send, raiseWindow } = make(true);
		effect("wt1");
		expect(send).toHaveBeenCalledWith({ worktreeId: "wt1" });
		expect(raiseWindow).toHaveBeenCalledOnce();
	});

	it("sends the focus IPC but does NOT raise the window when the knob is false", () => {
		const { effect, send, raiseWindow } = make(false);
		effect("wt1");
		expect(send).toHaveBeenCalledWith({ worktreeId: "wt1" });
		expect(raiseWindow).not.toHaveBeenCalled();
	});
});
