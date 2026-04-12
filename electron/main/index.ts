import { app, Menu } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";
import { registerAppLifecycle } from "./lifecycle.js";
import { buildApplicationMenu } from "./menu.js";
import { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import { createShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";

app.setName("ai-14all");

if (process.env.AI14ALL_USER_DATA_PATH) {
	app.setPath("userData", process.env.AI14ALL_USER_DATA_PATH);
}

app.whenReady().then(() => {
	const shellEventLog = createShellEventLogService({
		userDataPath: app.getPath("userData"),
		isPackaged: app.isPackaged,
		appVersion: app.getVersion(),
	});
	shellEventLog.log({
		source: "main",
		event: "app-log-start",
		windowId: null,
		data: { version: app.getVersion(), isPackaged: app.isPackaged },
	});

	const mainWindow = createMainWindow(shellEventLog);
	Menu.setApplicationMenu(buildApplicationMenu(mainWindow));
	const workspacePersistence = new WorkspacePersistenceService(
		process.env.AI14ALL_WORKSPACE_STATE_PATH ??
			join(app.getPath("userData"), "workspace-state.json"),
	);
	const workspaceRegistry = new WorkspaceRegistryService();
	const { dispose } = registerIpcHandlers(mainWindow, { workspacePersistence, workspaceRegistry, shellEventLog });

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
