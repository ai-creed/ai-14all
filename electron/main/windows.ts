import { BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

export function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
}
