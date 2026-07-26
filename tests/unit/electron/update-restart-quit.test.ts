import { describe, expect, it, vi } from "vitest";
import { registerHideOnClose } from "../../../electron/main/lifecycle.js";
import { createCloseGate } from "../../../electron/main/close-gate.js";
import { startUpdateService } from "../../../electron/main/services/update-service.js";
import type { UpdaterLike } from "../../../electron/main/services/update-service.js";

// Reproduction for docs/bugreports/bug-macos-updater-restart-now-minimizes.md:
// on macOS, pressing "Restart now" hides the window instead of quitting and
// installing the downloaded update.
//
// The fake updater below models the documented Squirrel.Mac quit sequence.
// electron-updater's MacUpdater delegates quitAndInstall() to Electron's
// native autoUpdater (MacUpdater.js:16 `require("electron").autoUpdater`,
// MacUpdater.js:229 `this.nativeUpdater.quitAndInstall()`), whose contract is:
//
//  - autoUpdater 'before-quit-for-update' (electron.d.ts): "When this API is
//    called, the `before-quit` event is not emitted before all windows are
//    closed."
//  - app 'before-quit' (electron.d.ts): "If application quit was initiated by
//    `autoUpdater.quitAndInstall()`, then `before-quit` is emitted _after_
//    emitting `close` event on all windows and closing them."
//
// So each window receives a cancellable `close` FIRST; `before-quit` (and the
// install) only happens once every window actually closed. A close that calls
// event.preventDefault() aborts the whole quit and the app keeps running.

type CloseEvent = { preventDefault(): void };

function makeFakeApp() {
	const listeners = new Map<string, Array<() => void>>();
	return {
		on(event: string, listener: () => void) {
			const existing = listeners.get(event) ?? [];
			existing.push(listener);
			listeners.set(event, existing);
		},
		emit(event: string) {
			for (const listener of listeners.get(event) ?? []) listener();
		},
	};
}

function makeFakeWindow() {
	const closeListeners: Array<(event: CloseEvent) => void> = [];
	let destroyed = false;
	const win = {
		on(_event: "close", listener: (event: CloseEvent) => void) {
			closeListeners.push(listener);
			return win;
		},
		webContents: { send: vi.fn() },
		destroy() {
			destroyed = true;
		},
		isDestroyed: () => destroyed,
		emitClose(): { defaultPrevented: boolean } {
			let defaultPrevented = false;
			for (const listener of closeListeners) {
				listener({
					preventDefault: () => {
						defaultPrevented = true;
					},
				});
			}
			return { defaultPrevented };
		},
		markClosed() {
			destroyed = true;
		},
	};
	return win;
}

// Wires the REAL production pieces (createCloseGate, registerHideOnClose,
// startUpdateService) together exactly as electron/main/index.ts does. The
// quit-flag lines are mirrored from index.ts because that wiring lives inline
// in the app entry and cannot be imported; the fix should extract it into a
// testable module and this harness should then consume the extracted seam.
function wireMainProcessLikeIndexTs() {
	const app = makeFakeApp();
	const win = makeFakeWindow();
	const hide = vi.fn();
	let installStarted = false;

	// Squirrel.Mac quitAndInstall per the documented sequence above.
	const updater: UpdaterLike = {
		autoDownload: false,
		autoInstallOnAppQuit: false,
		on() {
			return updater;
		},
		checkForUpdates: () => Promise.resolve(undefined),
		quitAndInstall() {
			app.emit("before-quit-for-update");
			const { defaultPrevented } = win.emitClose();
			if (defaultPrevented) return; // quit aborted — app keeps running
			win.markClosed();
			app.emit("before-quit");
			installStarted = true; // Squirrel installs and relaunches
		},
	};

	// index.ts:797 — the flag hide-on-close consults.
	let isQuitting = false;

	// index.ts:799-800 — close-gate attaches its window `close` listener first.
	const closeGate = createCloseGate();
	closeGate.attach(win, { isQuitting: () => isQuitting });

	// index.ts:145-156 — real update service over the (fake) updater.
	const updateService = startUpdateService({
		updater,
		currentVersion: "1.2.3",
		isPackaged: true,
		platform: "darwin",
		arch: "arm64",
		send: () => {},
		logger: { warn: () => {}, info: () => {} },
	});

	// index.ts:833-834 — the ONLY place the flag flips today.
	app.on("before-quit", () => {
		isQuitting = true;
	});

	// index.ts:859-869 — hide-on-close registers its `close` listener second.
	registerHideOnClose({
		onClose: (listener) => win.on("close", listener),
		onActivate: () => {},
		isQuitting: () => isQuitting,
		hide,
		show: () => {},
		isDestroyed: () => win.isDestroyed(),
		platform: "darwin",
	});

	return {
		// index.ts:816 + ipc.ts:666-667 — the "update:install" IPC path the
		// renderer's "Restart now" button ends in.
		installUpdate: () => updateService.installUpdate(),
		hide,
		installStarted: () => installStarted,
		isWindowDestroyed: () => win.isDestroyed(),
	};
}

describe("macOS Restart now → quitAndInstall vs hide-on-close", () => {
	it("quits and installs the update instead of hiding the window", () => {
		const h = wireMainProcessLikeIndexTs();

		// User presses "Restart now" (UpdateBanner.tsx → desktop-client
		// system.installUpdate() → ipc "update:install").
		h.installUpdate();

		// The window must be allowed to close so Squirrel.Mac can install;
		// hiding it is the reported bug (app keeps running the old version).
		expect(h.hide).not.toHaveBeenCalled();
		expect(h.installStarted()).toBe(true);
		expect(h.isWindowDestroyed()).toBe(true);
	});

	it("keeps failing the same way on a second Restart now press (updater state is not consumed)", () => {
		const h = wireMainProcessLikeIndexTs();

		h.installUpdate();
		h.installUpdate();

		expect(h.installStarted()).toBe(true);
	});
});
