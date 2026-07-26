import { describe, expect, it, vi } from "vitest";
import {
	registerAppLifecycle,
	registerHideOnClose,
} from "../../../electron/main/lifecycle.js";
import { createCloseGate } from "../../../electron/main/close-gate.js";
import { startUpdateService } from "../../../electron/main/services/update-service.js";
import type { UpdaterLike } from "../../../electron/main/services/update-service.js";

// Reproduction for docs/bugreports/bug-macos-updater-restart-now-minimizes.md:
// on macOS, pressing "Restart now" hides the window instead of quitting and
// installing the downloaded update.
//
// The fake models Electron's REAL native updater lifecycle, verified against
// the Electron 41 source and runtime (review round 5):
//
//  - electron-updater's MacUpdater delegates quitAndInstall() to Electron's
//    native autoUpdater (MacUpdater.js:16, 229), deferring while Squirrel has
//    not yet fetched the update (MacUpdater.js:214-220, 236-250).
//  - The native QuitAndInstall (shell/browser/api/electron_api_auto_updater.cc)
//    emits 'before-quit-for-update', then — if windows remain — registers a
//    WindowList observer and closes all windows; `before-quit` only follows
//    once every window actually closed (electron.d.ts contract). A close that
//    calls event.preventDefault() aborts the sweep BUT LEAVES THE OBSERVER
//    REGISTERED: when the last window is later closed or destroyed,
//    OnWindowAllClosed re-enters QuitAndInstall and the install proceeds
//    (independently reproduced in the Electron 41 runtime).
//  - Calling quitAndInstall() again while that observer is registered
//    violates Electron's observer invariant — base/observer_list.h NOTREACHED
//    "Observers can only be added once!" (independently reproduced) — modeled
//    here as the observerDoubleAdds counter, which correct code must keep 0.
//
// Updater modes: "quits" (Squirrel ready, native sequence runs on press),
// "deferred" (press precedes native readiness; completeDeferredQuit() runs it
// later), "errors" (permanent failure — the native quit never begins).

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
	let observerRegistered = false;
	let observerDoubleAdds = 0;
	const updaterListeners = new Map<string, (...args: unknown[]) => void>();

	// Electron 41 native layer (electron_api_auto_updater.cc QuitAndInstall).
	const nativeQuitAndInstall = () => {
		app.emit("before-quit-for-update");
		if (win.isDestroyed()) {
			// Window list empty → Squirrel installs and relaunches.
			app.emit("before-quit");
			installStarted = true;
			return;
		}
		if (observerRegistered) {
			observerDoubleAdds += 1; // NOTREACHED in the real runtime
		}
		observerRegistered = true; // WindowList::AddObserver
		const { defaultPrevented } = win.emitClose(); // CloseAllWindows
		if (defaultPrevented) return; // sweep aborted; observer STAYS registered
		win.markClosed();
		nativeOnWindowAllClosed();
	};
	const nativeOnWindowAllClosed = () => {
		if (!observerRegistered) return;
		observerRegistered = false; // WindowList::RemoveObserver
		nativeQuitAndInstall(); // re-enter with an empty window list → install
	};

	// electron-updater MacUpdater wrapper (MacUpdater.js:227-252).
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
			nativeQuitAndInstall(); // MacUpdater.js:229
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

	// A gate-initiated destroy() removes the window from the WindowList just
	// like a completed close does — the native observer must see it.
	const destroy = win.destroy;
	win.destroy = () => {
		destroy();
		nativeOnWindowAllClosed();
	};

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
		// now (squirrelDownloadedUpdate latches true, MacUpdater.js:22-24).
		completeDeferredQuit: () => {
			nativeReady = true;
			if (pendingNativeQuit) {
				pendingNativeQuit = false;
				nativeQuitAndInstall();
			}
		},
		emitUpdaterError: () =>
			updaterListeners.get("error")?.(new Error("squirrel failure")),
		observerDoubleAdds: () => observerDoubleAdds,
		// Cmd+Q analog: app.quit() → before-quit → close windows (cancellable).
		realQuit: () => {
			app.emit("before-quit");
			if (!win.isDestroyed()) {
				const { defaultPrevented } = win.emitClose();
				if (defaultPrevented) return;
				win.markClosed();
				nativeOnWindowAllClosed();
			}
		},
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

	it("repeated Restart now presses never double-register the native window observer", () => {
		const h = wireMainProcessLikeIndexTs();

		h.installUpdate();
		h.installUpdate();

		// Today the second press re-enters native QuitAndInstall while its
		// WindowList observer from the first (aborted) attempt is still
		// registered — the NOTREACHED invariant violation. The fix must make
		// this unreachable (single-flight install / armed-resume guard).
		expect(h.observerDoubleAdds()).toBe(0);
		expect(h.installStarted()).toBe(true);
	});
});

describe("Restart now with dirty editor buffers (close-gate interplay)", () => {
	// With the quitting flag fixed, the update-quit close sweep reaches the
	// gate, which prompts and — on proceed — destroys the window via its
	// EXISTING path (close-gate.ts:111-121). That destroy empties the window
	// list, and Electron's still-registered updater observer completes the
	// install (round-5 verified continuation). No retry may be issued: these
	// tests also require zero observer double-registrations.
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
		expect(h.observerDoubleAdds()).toBe(0);
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

	it("after cancelling, a second Restart now press re-prompts and installs without double-registering", () => {
		const h = wireMainProcessLikeIndexTs();
		h.closeGate.setDirty(DIRTY_BUFFER);
		let reply = false;
		h.win.webContents.send.mockImplementation((channel: string) => {
			if (channel === "app:requestClose") {
				h.closeGate.confirmClose({ proceed: reply });
			}
		});

		h.installUpdate(); // desired: prompt → user cancels
		reply = true;
		h.installUpdate(); // desired: prompt again → proceed → install

		// The second press must resume via the already-registered native
		// observer (close the window through the normal gate flow), NEVER by
		// re-invoking native quitAndInstall.
		expect(h.confirmationRequested()).toBe(true);
		expect(h.installStarted()).toBe(true);
		expect(h.observerDoubleAdds()).toBe(0);
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

describe("native observer continuation (regression pin)", () => {
	// Green today and must stay green: after an aborted updater quit the
	// native WindowList observer stays registered, so the NEXT successful
	// quit completes the install — this is the mechanism behind the
	// reporter's observed force-quit-then-reopen workaround, and it validates
	// the harness's observer model against real behavior.
	it("an aborted update quit still installs on the next real quit", () => {
		const h = wireMainProcessLikeIndexTs();

		h.installUpdate(); // today: hide-on-close aborts the sweep
		h.realQuit(); // clean buffers: quit proceeds, last window closes

		expect(h.installStarted()).toBe(true);
		expect(h.observerDoubleAdds()).toBe(0);
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

// ---------------------------------------------------------------------------
// Windows/Linux (BaseUpdater) composition. The post-confirmation continuation
// is DIFFERENT there and must be preserved: BaseUpdater.quitAndInstall() runs
// install() FIRST — spawning the installer and latching quitAndInstallCalled
// (BaseUpdater.js:12-15, 41-61) — then emits 'before-quit-for-update' and
// calls app.quit() (BaseUpdater.js:17-21; its setImmediate is collapsed to
// synchronous here). Re-invoking quitAndInstall() after an aborted quit is
// explicitly ignored ("install call ignored: quitAndInstallCalled is set to
// true", BaseUpdater.js:42-45) and never calls app.quit() again. The
// continuation that works today is the close-gate's destroy-on-proceed
// followed by window-all-closed → app.quit() (registerAppLifecycle,
// lifecycle.ts:28-32). These pins are green today and must STAY green through
// the fix.

function wireWin32MainProcessLikeIndexTs() {
	const app = makeFakeApp();
	const win = makeFakeWindow();
	let installerSpawned = false;
	let quitAndInstallCalled = false;
	let quitCompleted = false;

	// app.quit(): before-quit, then close all windows (cancellable); if none
	// remain, will-quit → process exit and the spawned installer proceeds.
	const appQuit = () => {
		app.emit("before-quit");
		if (!win.isDestroyed()) {
			const { defaultPrevented } = win.emitClose();
			if (defaultPrevented) return; // quit aborted — app keeps running
			win.markClosed();
		}
		quitCompleted = true;
	};

	const updater: UpdaterLike = {
		autoDownload: false,
		autoInstallOnAppQuit: false,
		on() {
			return updater;
		},
		checkForUpdates: () => Promise.resolve(undefined),
		quitAndInstall() {
			if (quitAndInstallCalled) return; // BaseUpdater.js:42-45
			quitAndInstallCalled = true;
			installerSpawned = true; // BaseUpdater.js:54-61 (doInstall)
			app.emit("before-quit-for-update"); // BaseUpdater.js:19 (emulated)
			appQuit(); // BaseUpdater.js:20
		},
	};

	// index.ts:797 + 833-834 — same flag, same single writer.
	let isQuitting = false;

	// index.ts:799-800 — the close gate attaches on every platform.
	const closeGate = createCloseGate();
	closeGate.attach(win, { isQuitting: () => isQuitting });

	const updateService = startUpdateService({
		updater,
		currentVersion: "1.2.3",
		isPackaged: true,
		platform: "win32",
		arch: "x64",
		send: () => {},
		logger: { warn: () => {}, info: () => {} },
	});

	app.on("before-quit", () => {
		isQuitting = true;
	});

	// index.ts:851-857 — on non-darwin, window-all-closed re-enters app.quit().
	let windowAllClosed: (() => void) | undefined;
	registerAppLifecycle({
		onMainWindowClosed: () => {},
		onWillQuit: () => {},
		onWindowAllClosed: (listener) => {
			windowAllClosed = listener;
		},
		quit: appQuit,
		dispose: () => {},
		platform: "win32",
	});
	const destroy = win.destroy;
	win.destroy = () => {
		destroy();
		windowAllClosed?.();
	};

	// index.ts:859-869 — registered but inert off macOS (lifecycle.ts:61).
	registerHideOnClose({
		onClose: (listener) => win.on("close", listener),
		onActivate: () => {},
		isQuitting: () => isQuitting,
		hide: () => {},
		show: () => {},
		isDestroyed: () => win.isDestroyed(),
		platform: "win32",
	});

	return {
		installUpdate: () => updateService.installUpdate(),
		win,
		closeGate,
		installerSpawned: () => installerSpawned,
		quitCompleted: () => quitCompleted,
		confirmationRequested: () =>
			win.webContents.send.mock.calls.some((c) => c[0] === "app:requestClose"),
	};
}

describe("Windows (BaseUpdater) restart continuation must be preserved (regression pins)", () => {
	it("clean buffers: Restart now spawns the installer and completes the quit", () => {
		const h = wireWin32MainProcessLikeIndexTs();

		h.installUpdate();

		expect(h.installerSpawned()).toBe(true);
		expect(h.quitCompleted()).toBe(true);
	});

	it("dirty buffers: confirm resumes the quit via destroy → window-all-closed → app.quit, never by re-running install", () => {
		const h = wireWin32MainProcessLikeIndexTs();
		h.closeGate.setDirty(DIRTY_BUFFER);
		h.win.webContents.send.mockImplementation((channel: string) => {
			if (channel === "app:requestClose") {
				h.closeGate.confirmClose({ proceed: true });
			}
		});

		h.installUpdate();

		expect(h.confirmationRequested()).toBe(true);
		expect(h.installerSpawned()).toBe(true);
		expect(h.quitCompleted()).toBe(true);
	});
});
