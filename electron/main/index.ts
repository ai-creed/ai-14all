import { app } from "electron";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";

app.whenReady().then(() => {
  const mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
