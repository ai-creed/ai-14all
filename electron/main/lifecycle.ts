import type { UpdateQuitGuard } from "./services/update-service.js";

type RegisterAppLifecycleOptions = {
	onMainWindowClosed: (listener: () => void) => void;
	onWillQuit: (listener: () => void) => void;
	onWindowAllClosed: (listener: () => void) => void;
	quit: () => void;
	dispose: () => void;
	platform?: string;
};

export function registerAppLifecycle({
	onMainWindowClosed,
	onWillQuit,
	onWindowAllClosed,
	quit,
	dispose,
	platform = process.platform,
}: RegisterAppLifecycleOptions): void {
	let disposed = false;

	const disposeOnce = () => {
		if (disposed) return;
		disposed = true;
		dispose();
	};

	onMainWindowClosed(disposeOnce);
	onWillQuit(disposeOnce);
	onWindowAllClosed(() => {
		if (platform !== "darwin") {
			quit();
		}
	});
}

type RegisterHideOnCloseOptions = {
	// Intercept the window's `close`; call preventDefault to keep it alive.
	onClose: (listener: (event: { preventDefault(): void }) => void) => void;
	// Fires when the app is activated (e.g. the macOS Dock icon is clicked).
	onActivate: (listener: () => void) => void;
	// True once a real quit is underway; then the close is allowed to destroy.
	isQuitting: () => boolean;
	hide: () => void;
	show: () => void;
	isDestroyed: () => boolean;
	platform?: string;
};

// macOS convention: closing the window with the red traffic-light button hides
// the app rather than tearing it down, and clicking the Dock icon brings it
// back. Without this, closing destroys the single main window and disposes all
// services, leaving a hollow process that the Dock cannot revive (see #31).
export function registerHideOnClose({
	onClose,
	onActivate,
	isQuitting,
	hide,
	show,
	isDestroyed,
	platform = process.platform,
}: RegisterHideOnCloseOptions): void {
	if (platform !== "darwin") return;

	onClose((event) => {
		if (isQuitting()) return; // real quit: allow the window to be destroyed
		event.preventDefault();
		hide();
	});
	onActivate(() => {
		if (!isDestroyed()) show();
	});
}

export type QuitStateOptions = {
	// A real quit is underway (app "before-quit").
	onBeforeQuit: (listener: () => void) => void;
	// A native/emulated update quit is beginning: the native autoUpdater's
	// "before-quit-for-update". During quitAndInstall() the window `close`
	// events fire BEFORE app "before-quit", so a flag fed only by before-quit
	// is still false when hide-on-close and the close gate inspect it — this
	// event is the earliest true "an update quit is genuinely beginning"
	// signal (electron-updater emulates it on Windows/Linux right before
	// app.quit()).
	onBeforeQuitForUpdate: (listener: () => void) => void;
};

export type QuitState = {
	isQuitting: () => boolean;
	isUpdateQuitArmed: () => boolean;
	markUpdateQuitResuming: () => void;
	resetAbortedUpdateQuit: () => void;
};

// Owns the "is a quit underway" flag consulted by hide-on-close and the
// close gate, with both flip sources. An update quit whose close sweep was
// prevented is suspended, not dead: Electron's native updater keeps its
// WindowList observer registered, so destroying the last window later
// completes the install. `isUpdateQuitArmed` tracks that suspended state.
export function createQuitState(opts: QuitStateOptions): QuitState {
	let quitting = false;
	let updateQuitArmed = false;
	opts.onBeforeQuit(() => {
		quitting = true;
	});
	opts.onBeforeQuitForUpdate(() => {
		quitting = true;
		updateQuitArmed = true;
	});
	return {
		isQuitting: () => quitting,
		isUpdateQuitArmed: () => updateQuitArmed,
		// Re-assert quitting so a resumed update quit's window close passes
		// hide-on-close and reaches the gate.
		markUpdateQuitResuming: () => {
			quitting = true;
		},
		// A close prompt raised by an update-quit sweep was answered "don't
		// close": clear quitting so red-X hides again. The armed native
		// observer is untouched — the next successful quit still installs.
		resetAbortedUpdateQuit: () => {
			if (!updateQuitArmed) return;
			quitting = false;
		},
	};
}

// Once an update quit is armed, re-invoking updater.quitAndInstall() would
// register Electron's WindowList observer a second time (an observer-
// invariant violation). Resuming instead closes the window through the
// normal close path: the armed observer (macOS) or window-all-closed →
// app.quit (Windows) finishes the install. Marking quitting BEFORE closing
// is load-bearing — hide-on-close must let that close through.
export function createUpdateQuitGuard(
	quitState: QuitState,
	closeMainWindow: () => void,
): UpdateQuitGuard {
	return {
		isUpdateQuitArmed: quitState.isUpdateQuitArmed,
		resumeUpdateQuit: () => {
			quitState.markUpdateQuitResuming();
			closeMainWindow();
		},
	};
}
