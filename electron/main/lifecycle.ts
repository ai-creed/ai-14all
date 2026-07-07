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
