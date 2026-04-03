import { app } from "electron";
import { fileURLToPath } from "node:url";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";

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

	app.on("will-quit", () => dispose());
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
