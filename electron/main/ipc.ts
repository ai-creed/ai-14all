import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  SetRepositoryRootSchema,
  CreateTerminalSessionSchema,
  SendTerminalInputSchema,
  ResizeTerminalSessionSchema,
  StopTerminalSessionSchema,
  ListFilesSchema,
  ReadFileSchema,
} from "../../shared/contracts/commands.js";
import { WorktreeService } from "../../services/worktrees/worktree-service.js";
import { TerminalService } from "../../services/terminals/terminal-service.js";
import { FileService } from "../../services/files/file-service.js";
import type { TerminalEventHandlers } from "../../services/terminals/terminal-service.js";
import type { Repository } from "../../shared/models/repository.js";
import type {
  TerminalOutputEvent,
  TerminalExitEvent,
  TerminalStateEvent,
  TerminalErrorEvent,
} from "../../shared/contracts/events.js";

// ---------------------------------------------------------------------------
// registerIpcHandlers
//
// Registers ipcMain.handle entries for every command exposed via the preload
// bridge. Terminal commands delegate to the PTY-backed TerminalService.
// File commands remain stubs until Task 7.
// ---------------------------------------------------------------------------
export function registerIpcHandlers(mainWindow: BrowserWindow): { dispose: () => void } {
  const worktreeService = new WorktreeService();
  const fileService = new FileService();
  let currentRepository: Repository | null = null;

  // --- Terminal service with event fan-out to renderer ---

  const terminalEventHandlers: TerminalEventHandlers = {
    onOutput(sessionId, data) {
      const payload: TerminalOutputEvent = { sessionId, data };
      mainWindow.webContents.send("terminal/output", payload);
    },
    onExit(sessionId, exitCode) {
      const payload: TerminalExitEvent = { sessionId, exitCode };
      mainWindow.webContents.send("terminal/exit", payload);
    },
    onState(sessionId, status) {
      const payload: TerminalStateEvent = { sessionId, status };
      mainWindow.webContents.send("terminal/state", payload);
    },
    onError(sessionId, message) {
      const payload: TerminalErrorEvent = { sessionId, message };
      mainWindow.webContents.send("terminal/error", payload);
    },
  };

  const terminalService = new TerminalService(terminalEventHandlers);

  // --- Repository ---

  ipcMain.handle("repository:setRoot", async (_event, raw: unknown) => {
    const { path } = SetRepositoryRootSchema.parse(raw);
    const repo = await worktreeService.setRepositoryRoot(path);
    currentRepository = repo;
    return repo;
  });

  ipcMain.handle("repository:listWorktrees", async () => {
    if (currentRepository === null) {
      throw new Error("No repository root has been set. Call repository:setRoot first.");
    }
    return worktreeService.listWorktrees(currentRepository);
  });

  // --- Terminals ---

  ipcMain.handle("terminals:create", (_event, raw: unknown) => {
    const { worktreeId, cwd } = CreateTerminalSessionSchema.parse(raw);
    return terminalService.create(worktreeId, cwd);
  });

  ipcMain.handle("terminals:sendInput", (_event, raw: unknown) => {
    const { sessionId, data } = SendTerminalInputSchema.parse(raw);
    terminalService.sendInput(sessionId, data);
  });

  ipcMain.handle("terminals:resize", (_event, raw: unknown) => {
    const { sessionId, cols, rows } = ResizeTerminalSessionSchema.parse(raw);
    terminalService.resize(sessionId, cols, rows);
  });

  ipcMain.handle("terminals:stop", (_event, raw: unknown) => {
    const { sessionId } = StopTerminalSessionSchema.parse(raw);
    terminalService.stop(sessionId);
  });

  // --- Files ---

  ipcMain.handle("files:list", (_event, raw: unknown) => {
    const { worktreePath } = ListFilesSchema.parse(raw);
    return fileService.listFiles(worktreePath);
  });

  ipcMain.handle("files:read", (_event, raw: unknown) => {
    const { worktreePath, relativePath } = ReadFileSchema.parse(raw);
    return fileService.readFile(worktreePath, relativePath);
  });

  return { dispose: () => terminalService.dispose() };
}
