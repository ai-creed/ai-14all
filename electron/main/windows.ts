import { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

export function createMainWindow(): BrowserWindow {
	const mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		show: !process.env.AI14ALL_E2E,
		webPreferences: {
			preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});

	mainWindow.maximize();
	return mainWindow;
}
