import { describe, expect, it, vi } from "vitest";
import { registerAppLifecycle } from "../../../electron/main/lifecycle.js";

type AppLike = {
	on: (event: string, listener: () => void) => void;
	quit: () => void;
};

type WindowLike = {
	on: (event: string, listener: () => void) => void;
};

describe("registerAppLifecycle", () => {
	it("disposes terminals when the main window closes", () => {
		const appListeners = new Map<string, () => void>();
		const windowListeners = new Map<string, () => void>();
		const app: AppLike = {
			on: vi.fn((event: string, listener: () => void) => {
				appListeners.set(event, listener);
			}),
			quit: vi.fn(),
		};
		const mainWindow: WindowLike = {
			on: vi.fn((event: string, listener: () => void) => {
				windowListeners.set(event, listener);
			}),
		};
		const dispose = vi.fn();

		registerAppLifecycle(app, mainWindow, dispose);
		windowListeners.get("closed")?.();

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("quits the app when all windows close on non-macOS", () => {
		const appListeners = new Map<string, () => void>();
		const windowListeners = new Map<string, () => void>();
		const app: AppLike = {
			on: vi.fn((event: string, listener: () => void) => {
				appListeners.set(event, listener);
			}),
			quit: vi.fn(),
		};
		const mainWindow: WindowLike = {
			on: vi.fn((event: string, listener: () => void) => {
				windowListeners.set(event, listener);
			}),
		};

		registerAppLifecycle(app, mainWindow, vi.fn(), "linux");
		appListeners.get("window-all-closed")?.();

		expect(app.quit).toHaveBeenCalledTimes(1);
	});

	it("does not quit the app when all windows close on macOS", () => {
		const appListeners = new Map<string, () => void>();
		const windowListeners = new Map<string, () => void>();
		const app: AppLike = {
			on: vi.fn((event: string, listener: () => void) => {
				appListeners.set(event, listener);
			}),
			quit: vi.fn(),
		};
		const mainWindow: WindowLike = {
			on: vi.fn((event: string, listener: () => void) => {
				windowListeners.set(event, listener);
			}),
		};

		registerAppLifecycle(app, mainWindow, vi.fn(), "darwin");
		appListeners.get("window-all-closed")?.();

		expect(app.quit).not.toHaveBeenCalled();
	});
});
