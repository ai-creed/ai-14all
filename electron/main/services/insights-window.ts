// The detached insights window (design spec §2 decision 4): a SINGLETON
// BrowserWindow created by main over IPC — never `window.open()` from the
// renderer — sharing the same preload bridge and navigation guard as the
// main window. `open()` focuses the existing window if one is already live
// instead of spawning a second one.
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
): { open(): void; close(reattach: boolean): void } {
	let win: BrowserWindow | null = null;
	let closingForReattach = false;

	function open(): void {
		if (win && !win.isDestroyed()) {
			win.focus();
			return;
		}
		win = new BrowserWindow({
			width: 1120,
			height: 720,
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
		win.on("closed", () => {
			notifyMain({ reattach: closingForReattach });
			closingForReattach = false;
			win = null;
		});
	}

	function close(reattach: boolean): void {
		if (!win || win.isDestroyed()) return;
		closingForReattach = reattach;
		win.close();
	}

	return { open, close };
}
