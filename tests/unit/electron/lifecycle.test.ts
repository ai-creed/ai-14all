import { describe, expect, it, vi } from "vitest";
import { registerAppLifecycle } from "../../../electron/main/lifecycle.js";

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
