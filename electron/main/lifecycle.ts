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
