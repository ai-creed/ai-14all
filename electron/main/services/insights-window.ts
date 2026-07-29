// The detached insights window (design spec §2 decision 4): a SINGLETON
// BrowserWindow created by main over IPC — never `window.open()` from the
// renderer — sharing the same preload bridge and navigation guard as the
// main window. `open()` focuses the existing window if one is already live
// instead of spawning a second one.
//
// Lifecycle coupling to the main window/app quit is NOT this module's job —
// it lives in electron/main/index.ts, where `mainWindow` and `app` exist:
// the singleton must be force-closed via `close(false)` on the main
// window's `closed` event AND on `app.on("before-quit")`, or (a) macOS's
// hide-on-close (electron/main/lifecycle.ts) can leave the dashboard open
// against a hidden main window, and (b) on Windows/Linux the dashboard
// BrowserWindow keeps Electron from ever seeing "all windows closed",
// leaving the app un-quittable after the main window is gone. index.ts's
// notifyMain callback additionally `show()`s + `focus()`s the main window
// on a `reattach: true` close, so a reattach from the dashboard is visible
// even if the main window was hidden (not closed) at the time.
//
// Preload/renderer path depth: this module is a plain static import of
// electron/main/index.ts (not a separate electron.vite.config.ts main
// rollupOptions.input entry like usage-worker.ts/insights-worker.ts), so it
// bundles INTO out/main/index.js rather than emitting its own
// out/main/services/insights-window.js. `import.meta.url` at runtime is
// therefore the bundled out/main/index.js's URL — the SAME depth
// electron/main/windows.ts (also bundled into that same file) resolves
// "../preload/index.cjs" and "../renderer/index.html" from. Verified against
// the emitted out/ layout (`out/main/index.js`, `out/preload/index.cjs`,
// `out/renderer/dashboard.html`) before committing.
import { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { installNavigationGuard } from "./navigation-guard.js";

export function createInsightsWindowService(
	notifyMain: (payload: { reattach: boolean }) => void,
	// Sizing (spec §2 decision 4, v5 full-size hosts): the caller (index.ts)
	// supplies the main window's current size so the dashboard opens
	// app-sized — the two-monitor cockpit gets an app-width dashboard, not a
	// 1120×720 default. Optional + nullable so a destroyed main window (or a
	// caller without one) degrades to the fixed fallback.
	getDefaultSize?: () => { width: number; height: number } | null,
): { open(): void; close(reattach: boolean): void } {
	let win: BrowserWindow | null = null;
	let closingForReattach = false;
	// Last user-set size, captured when a window closes; wins over
	// getDefaultSize on reopen. In-memory only — detached state is not
	// persisted across restarts (decision 3), so its size isn't either.
	let lastSize: { width: number; height: number } | null = null;

	function open(): void {
		if (win && !win.isDestroyed()) {
			win.focus();
			return;
		}
		// Reset stale intent from a prior close cycle: without this, a leftover
		// `true` from an earlier reattach could mislabel THIS new window's own
		// eventual close (e.g. a plain OS-chrome close) as a reattach.
		closingForReattach = false;
		const size = lastSize ?? getDefaultSize?.() ?? null;
		win = new BrowserWindow({
			width: size?.width ?? 1120,
			height: size?.height ?? 720,
			title: "ai-14all — insights",
			show: !process.env.AI14ALL_E2E,
			webPreferences: {
				preload: fileURLToPath(
					new URL("../preload/index.cjs", import.meta.url),
				),
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
			},
		});
		installNavigationGuard(win.webContents); // same guard, byte-identical policy
		if (process.env.ELECTRON_RENDERER_URL) {
			void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/dashboard.html`);
		} else {
			void win.loadFile(
				fileURLToPath(new URL("../renderer/dashboard.html", import.meta.url)),
			);
		}
		// 'close' fires while the window is still live (Electron ordering:
		// close → closed), so this is the last point its bounds are readable —
		// 'closed' is too late (the native window is gone).
		win.on("close", () => {
			if (!win || win.isDestroyed()) return;
			const bounds = win.getBounds();
			lastSize = { width: bounds.width, height: bounds.height };
		});
		win.on("closed", () => {
			// Snapshot + clear state BEFORE notifying: notifyMain sends a
			// synchronous IPC message that main can react to by re-entering
			// open()/close() (e.g. reopening the overlay), so `win` and
			// `closingForReattach` must already read "no window open" before
			// that happens, not after.
			const reattach = closingForReattach;
			win = null;
			closingForReattach = false;
			notifyMain({ reattach });
		});
	}

	function close(reattach: boolean): void {
		if (!win || win.isDestroyed()) return;
		closingForReattach = reattach;
		win.close();
	}

	return { open, close };
}
