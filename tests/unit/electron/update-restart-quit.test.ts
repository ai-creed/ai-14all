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
//
// Updater modes:
//  - "quits": Squirrel is ready; quitAndInstall() runs the native quit
//    sequence synchronously.
//  - "deferred": models MacUpdater.js:236-250 — the renderer-facing
//    `update-downloaded` (the banner) fires BEFORE native Squirrel finishes
//    fetching the update (MacUpdater.js:214-220), so a Restart now press
//    defers: quitAndInstall() returns and the native quit only runs later,
//    when the harness calls completeDeferredQuit().
//  - "errors": permanent updater failure — the native quit never begins; only
//    the `error` event the service subscribes to fires. (NOT the same as
//    "deferred": a deferred quit later SUCCEEDS and emits
//    'before-quit-for-update'.)

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
function wireMainProcessLikeIndexTs(
	opts: { updaterMode?: "quits" | "deferred" | "errors" } = {},
) {
	const app = makeFakeApp();
	const win = makeFakeWindow();
	const hide = vi.fn();
	let installStarted = false;
	let nativeReady = opts.updaterMode !== "deferred";
	let pendingNativeQuit = false;
	const updaterListeners = new Map<string, (...args: unknown[]) => void>();

	const runNativeQuitSequence = () => {
		app.emit("before-quit-for-update");
		const { defaultPrevented } = win.emitClose();
		if (defaultPrevented) return; // quit aborted — app keeps running
		win.markClosed();
		app.emit("before-quit");
		installStarted = true; // Squirrel installs and relaunches
	};

	const updater: UpdaterLike = {
		autoDownload: false,
		autoInstallOnAppQuit: false,
		on(event, listener) {
			updaterListeners.set(event, listener);
			return updater;
		},
		checkForUpdates: () => Promise.resolve(undefined),
		quitAndInstall() {
			if (opts.updaterMode === "errors") {
				updaterListeners.get("error")?.(new Error("squirrel failure"));
				return;
			}
			if (!nativeReady) {
				// MacUpdater.js:236-250 — wait for native update-downloaded.
				pendingNativeQuit = true;
				return;
			}
			runNativeQuitSequence();
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
		closeGate,
		win,
		installStarted: () => installStarted,
		isWindowDestroyed: () => win.isDestroyed(),
		// Native Squirrel finished fetching: the deferred quit (if any) starts
		// now, and any later quitAndInstall() runs synchronously
		// (squirrelDownloadedUpdate latches true, MacUpdater.js:22-24, 236-240).
		completeDeferredQuit: () => {
			nativeReady = true;
			if (pendingNativeQuit) {
				pendingNativeQuit = false;
				runNativeQuitSequence();
			}
		},
		emitUpdaterError: () =>
			updaterListeners.get("error")?.(new Error("squirrel failure")),
		// True once the renderer was asked to confirm discarding dirty buffers
		// (the close-gate's existing `app:requestClose` round-trip).
		confirmationRequested: () =>
			win.webContents.send.mock.calls.some((c) => c[0] === "app:requestClose"),
	};
}

const DIRTY_BUFFER = {
	workspaceId: "ws",
	worktreeId: "wt",
	relativePath: "notes.md",
	dirty: true,
};

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

describe("Restart now with dirty editor buffers (close-gate interplay)", () => {
	// Confirmation must be coordinated with the ACTUAL native quit: a close
	// prevented mid-quit aborts the Squirrel quit, and the gate's plain
	// confirm path only destroys the window (close-gate.ts:111-121) — it
	// cannot resume the aborted install. These tests assert the required
	// end-to-end behavior via the gate's existing `app:requestClose` renderer
	// round-trip; if the fix confirms through a different channel, re-point
	// the harness responder at it.
	it("asks for confirmation and installs after the user confirms", () => {
		const h = wireMainProcessLikeIndexTs();
		h.closeGate.setDirty(DIRTY_BUFFER);
		h.win.webContents.send.mockImplementation((channel: string) => {
			if (channel === "app:requestClose") {
				h.closeGate.confirmClose({ proceed: true }); // renderer: user confirms
			}
		});

		h.installUpdate();

		expect(h.confirmationRequested()).toBe(true);
		expect(h.installStarted()).toBe(true);
	});

	it("cancelling the confirmation aborts the restart and leaves the app fully usable", () => {
		const h = wireMainProcessLikeIndexTs();
		h.closeGate.setDirty(DIRTY_BUFFER);
		h.win.webContents.send.mockImplementation((channel: string) => {
			if (channel === "app:requestClose") {
				h.closeGate.confirmClose({ proceed: false }); // renderer: user cancels
			}
		});

		h.installUpdate();

		expect(h.confirmationRequested()).toBe(true);
		expect(h.installStarted()).toBe(false);
		expect(h.isWindowDestroyed()).toBe(false);
		// Cancelling must not hide the window out from under the user…
		expect(h.hide).not.toHaveBeenCalled();
		// …and must not leave lifecycle state stuck: a later red-X close still
		// hides instead of destroying (the #31 macOS contract).
		const redX = h.win.emitClose();
		expect(redX.defaultPrevented).toBe(true);
		expect(h.isWindowDestroyed()).toBe(false);
	});
});

describe("Restart now pressed before Squirrel is natively ready (deferred quit)", () => {
	// The banner can appear BEFORE native Squirrel has fetched the update
	// (MacUpdater.js:214-220), so the press → native-quit gap is unbounded
	// (MacUpdater.js:236-250). No consent or quit state may exist during that
	// gap: the interval must behave like normal app usage, and the eventual
	// native quit must work with the state found AT THAT MOMENT.
	it("installs when the native quit finally arrives, even after an unrelated red-X hide in between", () => {
		const h = wireMainProcessLikeIndexTs({ updaterMode: "deferred" });

		h.installUpdate(); // defers — Squirrel still fetching

		// The waiting interval is normal UX: red-X hides as always.
		const redX = h.win.emitClose();
		expect(redX.defaultPrevented).toBe(true);
		expect(h.isWindowDestroyed()).toBe(false);

		h.completeDeferredQuit();

		expect(h.installStarted()).toBe(true);
		expect(h.isWindowDestroyed()).toBe(true);
	});

	it("edits made during the wait get a FRESH confirmation when the native quit starts", () => {
		const h = wireMainProcessLikeIndexTs({ updaterMode: "deferred" });
		h.installUpdate(); // buffers clean at press time — no consent to give yet

		h.closeGate.setDirty(DIRTY_BUFFER); // user keeps working during the wait
		h.win.webContents.send.mockImplementation((channel: string) => {
			if (channel === "app:requestClose") {
				h.closeGate.confirmClose({ proceed: true });
			}
		});

		h.completeDeferredQuit();

		expect(h.confirmationRequested()).toBe(true);
		expect(h.installStarted()).toBe(true);
	});

	it("cancelling that fresh confirmation aborts cleanly and red-X still hides", () => {
		const h = wireMainProcessLikeIndexTs({ updaterMode: "deferred" });
		h.installUpdate();

		h.closeGate.setDirty(DIRTY_BUFFER);
		h.win.webContents.send.mockImplementation((channel: string) => {
			if (channel === "app:requestClose") {
				h.closeGate.confirmClose({ proceed: false });
			}
		});

		h.completeDeferredQuit();

		expect(h.confirmationRequested()).toBe(true);
		expect(h.installStarted()).toBe(false);
		expect(h.isWindowDestroyed()).toBe(false);
		// Lifecycle state must not be stuck after the aborted update quit.
		const redX = h.win.emitClose();
		expect(redX.defaultPrevented).toBe(true);
		expect(h.isWindowDestroyed()).toBe(false);
	});
});

describe("updater failure must not corrupt lifecycle state (regression pins)", () => {
	// Pass today and must STAY green through the fix: the quitting signal may
	// only flip when a native quit is genuinely beginning — never at
	// button-press time, and never while a deferred quit is still waiting.
	it("after a permanently failing Restart now, the red-X close still hides the window", () => {
		const h = wireMainProcessLikeIndexTs({ updaterMode: "errors" });

		h.installUpdate();

		const redX = h.win.emitClose();
		expect(redX.defaultPrevented).toBe(true);
		expect(h.isWindowDestroyed()).toBe(false);
		expect(h.hide).toHaveBeenCalled();
	});

	it("an updater error during the deferred wait leaves red-X hiding intact", () => {
		const h = wireMainProcessLikeIndexTs({ updaterMode: "deferred" });

		h.installUpdate();
		h.emitUpdaterError();

		const redX = h.win.emitClose();
		expect(redX.defaultPrevented).toBe(true);
		expect(h.isWindowDestroyed()).toBe(false);
		expect(h.hide).toHaveBeenCalled();
	});
});
