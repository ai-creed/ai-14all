import { app } from "electron";
import { fileURLToPath } from "node:url";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";
import { registerAppLifecycle } from "./lifecycle.js";

app.whenReady().then(() => {
	const mainWindow = createMainWindow();
	const { dispose } = registerIpcHandlers(mainWindow);

	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(
			fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
		);
	}
	registerAppLifecycle({
		onMainWindowClosed: (listener) => mainWindow.on("closed", listener),
		onWillQuit: (listener) => app.on("will-quit", listener),
		onWindowAllClosed: (listener) => app.on("window-all-closed", listener),
		quit: () => app.quit(),
		dispose,
	});
});
