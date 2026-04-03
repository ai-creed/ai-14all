type AppLifecycle = {
	on: (event: any, listener: any) => unknown;
	quit: () => void;
};

type WindowLifecycle = {
	on: (event: any, listener: any) => unknown;
};

export function registerAppLifecycle(
	app: AppLifecycle,
	mainWindow: WindowLifecycle,
	dispose: () => void,
	platform = process.platform,
): void {
	let disposed = false;

	const disposeOnce = () => {
		if (disposed) return;
		disposed = true;
		dispose();
	};

	mainWindow.on("closed", disposeOnce);
	app.on("will-quit", disposeOnce);
	app.on("window-all-closed", () => {
		if (platform !== "darwin") {
			app.quit();
		}
	});
}
