import { app, BrowserWindow, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import type { ShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";

export function createMainWindow(
	shellEventLog?: ShellEventLogService,
): BrowserWindow {
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

	const windowId = mainWindow.id;

	shellEventLog?.log({
		source: "main",
		event: "window-created",
		windowId,
		data: {},
	});
	mainWindow.on("focus", () =>
		shellEventLog?.log({
			source: "main",
			event: "window-focus",
			windowId,
			reasonKind: "window_lifecycle",
			reason: "app_focus",
			data: {},
		}),
	);
	mainWindow.on("blur", () =>
		shellEventLog?.log({
			source: "main",
			event: "window-blur",
			windowId,
			reasonKind: "window_lifecycle",
			reason: "app_blur",
			data: {},
		}),
	);
	mainWindow.on("closed", () =>
		shellEventLog?.log({
			source: "main",
			event: "window-close",
			windowId,
			data: {},
		}),
	);
	mainWindow.webContents.on("did-start-loading", () =>
		shellEventLog?.log({
			source: "main",
			event: "window-webcontents-did-start-loading",
			windowId,
			data: {},
		}),
	);
	mainWindow.webContents.on("did-finish-load", () =>
		shellEventLog?.log({
			source: "main",
			event: "window-webcontents-did-finish-load",
			windowId,
			data: {},
		}),
	);
	mainWindow.webContents.on("render-process-gone", (_evt, details) =>
		shellEventLog?.log({
			source: "main",
			event: "window-webcontents-render-process-gone",
			windowId,
			reasonKind: "window_lifecycle",
			reason: "renderer_process_gone",
			data: details as unknown as Record<string, unknown>,
		}),
	);
	mainWindow.webContents.once("destroyed", () =>
		shellEventLog?.log({
			source: "main",
			event: "window-webcontents-destroyed",
			windowId,
			reasonKind: "window_lifecycle",
			reason: "webcontents_destroyed",
			data: {},
		}),
	);

	mainWindow.maximize();
	return mainWindow;
}
