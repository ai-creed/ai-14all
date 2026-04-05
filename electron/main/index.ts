import { app } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";
import { registerAppLifecycle } from "./lifecycle.js";
import { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";

app.setName("ai-14all");

app.whenReady().then(() => {
	const mainWindow = createMainWindow();
	const workspacePersistence = new WorkspacePersistenceService(
		process.env.AI14ALL_WORKSPACE_STATE_PATH ??
			join(app.getPath("userData"), "workspace-state.json"),
	);
	const { dispose } = registerIpcHandlers(mainWindow, { workspacePersistence });

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
