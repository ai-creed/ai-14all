import { app } from "electron";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";

app.whenReady().then(() => {
  const mainWindow = createMainWindow();
  const { dispose } = registerIpcHandlers(mainWindow);
  app.on("will-quit", () => dispose());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
