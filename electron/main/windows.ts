import { app, BrowserWindow, nativeImage } from "electron";
import { fileURLToPath } from "node:url";

export function createMainWindow(): BrowserWindow {
	const iconPath = fileURLToPath(
		new URL("../../assets/ai-14all-icon.png", import.meta.url),
	);
	const appIcon = nativeImage.createFromPath(iconPath);

	if (process.platform === "darwin" && !appIcon.isEmpty()) {
		app.dock?.setIcon(appIcon);
	}

	const mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		show: !process.env.AI14ALL_E2E,
		title: "ai-14all",
		icon: appIcon.isEmpty() ? undefined : appIcon,
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
