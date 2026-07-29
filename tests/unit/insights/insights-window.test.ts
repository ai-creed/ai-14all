// @vitest-environment node
//
// Detached-window sizing (design spec §2 decision 4, v5 full-size hosts):
// the singleton opens at the MAIN window's current size — so the
// two-monitor cockpit gets an app-width dashboard, not a 1120×720 postage
// stamp — remembers a user resize for reopens within the session, and only
// falls back to 1120×720 when the main window's bounds are unavailable.
// The BrowserWindow is faked per-file (the documented tests/stubs/electron.ts
// override pattern) so we can capture constructor options and replay the
// Electron close → closed event ordering.
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
	type Listener = () => void;
	class FakeBrowserWindow {
		static instances: FakeBrowserWindow[] = [];
		options: { width?: number; height?: number };
		bounds: { x: number; y: number; width: number; height: number };
		focus = vi.fn();
		webContents = {};
		private listeners = new Map<string, Listener[]>();
		private destroyed = false;

		constructor(options: { width?: number; height?: number }) {
			this.options = options;
			this.bounds = {
				x: 0,
				y: 0,
				width: options.width ?? 0,
				height: options.height ?? 0,
			};
			FakeBrowserWindow.instances.push(this);
		}
		on(event: string, cb: Listener): this {
			const list = this.listeners.get(event) ?? [];
			list.push(cb);
			this.listeners.set(event, list);
			return this;
		}
		emit(event: string): void {
			for (const cb of this.listeners.get(event) ?? []) cb();
		}
		isDestroyed(): boolean {
			return this.destroyed;
		}
		getBounds() {
			return { ...this.bounds };
		}
		async loadURL(): Promise<void> {}
		async loadFile(): Promise<void> {}
		// Mirrors Electron's ordering: 'close' fires while the window is still
		// live (bounds readable), 'closed' after destruction.
		close(): void {
			this.emit("close");
			this.destroyed = true;
			this.emit("closed");
		}
	}
	return { FakeBrowserWindow };
});

vi.mock("electron", () => ({ BrowserWindow: h.FakeBrowserWindow }));
vi.mock("../../../electron/main/services/navigation-guard.js", () => ({
	installNavigationGuard: vi.fn(),
}));

import { createInsightsWindowService } from "../../../electron/main/services/insights-window.js";

const FakeWin = h.FakeBrowserWindow;
const lastWin = () => {
	const win = FakeWin.instances.at(-1);
	if (!win) throw new Error("no BrowserWindow was constructed");
	return win;
};

afterEach(() => {
	FakeWin.instances.length = 0;
	vi.clearAllMocks();
});

describe("insights window sizing (spec §2 decision 4, v5)", () => {
	it("first open inherits the main window's size via getDefaultSize", () => {
		const svc = createInsightsWindowService(
			() => {},
			() => ({ width: 2560, height: 1400 }),
		);
		svc.open();
		expect(lastWin().options.width).toBe(2560);
		expect(lastWin().options.height).toBe(1400);
	});

	it("falls back to 1120×720 when getDefaultSize returns null (main window gone)", () => {
		const svc = createInsightsWindowService(
			() => {},
			() => null,
		);
		svc.open();
		expect(lastWin().options.width).toBe(1120);
		expect(lastWin().options.height).toBe(720);
	});

	it("falls back to 1120×720 when no getDefaultSize is provided", () => {
		const svc = createInsightsWindowService(() => {});
		svc.open();
		expect(lastWin().options.width).toBe(1120);
		expect(lastWin().options.height).toBe(720);
	});

	it("reopen uses the remembered user-resized size, not the default", () => {
		const svc = createInsightsWindowService(
			() => {},
			() => ({ width: 2000, height: 1000 }),
		);
		svc.open();
		const first = lastWin();
		expect(first.options.width).toBe(2000);
		// The user resizes, then closes via OS chrome.
		first.bounds = { x: 40, y: 40, width: 1600, height: 900 };
		first.close();
		svc.open();
		const second = lastWin();
		expect(second).not.toBe(first);
		expect(second.options.width).toBe(1600);
		expect(second.options.height).toBe(900);
	});

	it("reattach-close also remembers the size for the next open", () => {
		const svc = createInsightsWindowService(
			() => {},
			() => ({ width: 2000, height: 1000 }),
		);
		svc.open();
		const first = lastWin();
		first.bounds = { x: 0, y: 0, width: 1440, height: 810 };
		svc.close(true); // reattach path calls win.close() internally
		svc.open();
		expect(lastWin().options.width).toBe(1440);
		expect(lastWin().options.height).toBe(810);
	});

	it("open() while a window is live focuses it and constructs nothing", () => {
		const svc = createInsightsWindowService(
			() => {},
			() => ({ width: 2000, height: 1000 }),
		);
		svc.open();
		svc.open();
		expect(FakeWin.instances).toHaveLength(1);
		expect(lastWin().focus).toHaveBeenCalledTimes(1);
	});
});
