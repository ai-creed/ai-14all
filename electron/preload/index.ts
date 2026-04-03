import { contextBridge, ipcRenderer } from "electron";
import type { OneForAllDesktopApi } from "../../shared/contracts/commands.js";
import type {
  TerminalOutputEvent,
  TerminalExitEvent,
  TerminalStateEvent,
  TerminalErrorEvent,
} from "../../shared/contracts/events.js";

// Helper: register a one-way listener on an ipcRenderer channel and return an
// unsubscribe function (matching the onXxx pattern in the API type).
function onChannel<T>(
  channel: string,
  listener: (event: T) => void,
): () => void {
  const handler = (_: Electron.IpcRendererEvent, payload: T) =>
    listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: OneForAllDesktopApi = {
  repository: {
    setRoot(path) {
      return ipcRenderer.invoke("repository:setRoot", { path });
    },
    listWorktrees() {
      return ipcRenderer.invoke("repository:listWorktrees");
    },
  },
  terminals: {
    create(worktreeId, cwd) {
      return ipcRenderer.invoke("terminals:create", { worktreeId, cwd });
    },
    sendInput(sessionId, data) {
      return ipcRenderer.invoke("terminals:sendInput", { sessionId, data });
    },
    resize(sessionId, cols, rows) {
      return ipcRenderer.invoke("terminals:resize", { sessionId, cols, rows });
    },
    stop(sessionId) {
      return ipcRenderer.invoke("terminals:stop", { sessionId });
    },
    onOutput(listener: (event: TerminalOutputEvent) => void) {
      return onChannel("terminal/output", listener);
    },
    onExit(listener: (event: TerminalExitEvent) => void) {
      return onChannel("terminal/exit", listener);
    },
    onState(listener: (event: TerminalStateEvent) => void) {
      return onChannel("terminal/state", listener);
    },
    onError(listener: (event: TerminalErrorEvent) => void) {
      return onChannel("terminal/error", listener);
    },
  },
  files: {
    list(worktreePath) {
      return ipcRenderer.invoke("files:list", { worktreePath });
    },
    read(worktreePath, relativePath) {
      return ipcRenderer.invoke("files:read", { worktreePath, relativePath });
    },
  },
};

contextBridge.exposeInMainWorld("oneforall", api);
