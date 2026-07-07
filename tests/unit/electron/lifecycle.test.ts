import { describe, expect, it, vi } from "vitest";
import {
	registerAppLifecycle,
	registerHideOnClose,
} from "../../../electron/main/lifecycle.js";

describe("registerAppLifecycle", () => {
	it("disposes terminals when the main window closes", () => {
		let onMainWindowClosed: (() => void) | undefined;
		let onWillQuit: (() => void) | undefined;
		let onWindowAllClosed: (() => void) | undefined;
		const dispose = vi.fn();

		registerAppLifecycle({
			onMainWindowClosed: (listener) => {
				onMainWindowClosed = listener;
			},
			onWillQuit: (listener) => {
				onWillQuit = listener;
			},
			onWindowAllClosed: (listener) => {
				onWindowAllClosed = listener;
			},
			quit: vi.fn(),
			dispose,
		});
		onMainWindowClosed?.();

		expect(dispose).toHaveBeenCalledTimes(1);
		onWillQuit?.();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(onWindowAllClosed).toBeTypeOf("function");
	});

	it("quits the app when all windows close on non-macOS", () => {
		let onWindowAllClosed: (() => void) | undefined;
		const quit = vi.fn();

		registerAppLifecycle({
			onMainWindowClosed: vi.fn(),
			onWillQuit: vi.fn(),
			onWindowAllClosed: (listener) => {
				onWindowAllClosed = listener;
			},
			quit,
			dispose: vi.fn(),
			platform: "linux",
		});
		onWindowAllClosed?.();

		expect(quit).toHaveBeenCalledTimes(1);
	});

	it("does not quit the app when all windows close on macOS", () => {
		let onWindowAllClosed: (() => void) | undefined;
		const quit = vi.fn();

		registerAppLifecycle({
			onMainWindowClosed: vi.fn(),
			onWillQuit: vi.fn(),
			onWindowAllClosed: (listener) => {
				onWindowAllClosed = listener;
			},
			quit,
			dispose: vi.fn(),
			platform: "darwin",
		});
		onWindowAllClosed?.();

		expect(quit).not.toHaveBeenCalled();
	});
});

type HideOnCloseHarness = {
	emitClose: () => { defaultPrevented: boolean };
	emitActivate: () => void;
	hide: ReturnType<typeof vi.fn>;
	show: ReturnType<typeof vi.fn>;
};

function wireHideOnClose(opts: {
	platform: string;
	isQuitting: () => boolean;
	isDestroyed?: () => boolean;
}): HideOnCloseHarness {
	let closeListener: ((event: { preventDefault(): void }) => void) | undefined;
	let activateListener: (() => void) | undefined;
	const hide = vi.fn();
	const show = vi.fn();

	registerHideOnClose({
		platform: opts.platform,
		isQuitting: opts.isQuitting,
		onClose: (listener) => {
			closeListener = listener;
		},
		onActivate: (listener) => {
			activateListener = listener;
		},
		hide,
		show,
		isDestroyed: opts.isDestroyed ?? (() => false),
	});

	return {
		emitClose: () => {
			let defaultPrevented = false;
			closeListener?.({
				preventDefault: () => {
					defaultPrevented = true;
				},
			});
			return { defaultPrevented };
		},
		emitActivate: () => activateListener?.(),
		hide,
		show,
	};
}

describe("registerHideOnClose", () => {
	it("hides the window instead of closing it on macOS when not quitting", () => {
		const h = wireHideOnClose({
			platform: "darwin",
			isQuitting: () => false,
		});
		const { defaultPrevented } = h.emitClose();
		expect(defaultPrevented).toBe(true);
		expect(h.hide).toHaveBeenCalledTimes(1);
	});

	it("shows the window again when the app is activated (Dock click)", () => {
		const h = wireHideOnClose({
			platform: "darwin",
			isQuitting: () => false,
		});
		h.emitClose();
		h.emitActivate();
		expect(h.show).toHaveBeenCalledTimes(1);
	});

	it("does not show a destroyed window on activate", () => {
		const h = wireHideOnClose({
			platform: "darwin",
			isQuitting: () => false,
			isDestroyed: () => true,
		});
		h.emitActivate();
		expect(h.show).not.toHaveBeenCalled();
	});

	it("allows the close (real destroy) when the app is quitting", () => {
		const h = wireHideOnClose({
			platform: "darwin",
			isQuitting: () => true,
		});
		const { defaultPrevented } = h.emitClose();
		expect(defaultPrevented).toBe(false);
		expect(h.hide).not.toHaveBeenCalled();
	});

	it("registers no hide/activate handlers off macOS", () => {
		const h = wireHideOnClose({
			platform: "linux",
			isQuitting: () => false,
		});
		expect(h.emitClose().defaultPrevented).toBe(false);
		h.emitActivate();
		expect(h.hide).not.toHaveBeenCalled();
		expect(h.show).not.toHaveBeenCalled();
	});
});
