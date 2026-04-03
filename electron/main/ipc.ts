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

// ---------------------------------------------------------------------------
// registerIpcHandlers
//
// Registers ipcMain.handle entries for every command exposed via the preload
// bridge. Implementations are stubs until the real services land in Tasks 3,
// 5, and 7.
// ---------------------------------------------------------------------------
export function registerIpcHandlers(_mainWindow: BrowserWindow): void {
  // --- Repository ---

  ipcMain.handle("repository:setRoot", (_event, raw: unknown) => {
    const { path } = SetRepositoryRootSchema.parse(raw);
    // TODO (Task 3): delegate to RepositoryService
    throw new Error(`repository:setRoot not yet implemented (path=${path})`);
  });

  ipcMain.handle("repository:listWorktrees", () => {
    // TODO (Task 3): delegate to RepositoryService
    throw new Error("repository:listWorktrees not yet implemented");
  });

  // --- Terminals ---

  ipcMain.handle("terminals:create", (_event, raw: unknown) => {
    const { worktreeId, cwd } = CreateTerminalSessionSchema.parse(raw);
    // TODO (Task 5): delegate to TerminalService
    throw new Error(
      `terminals:create not yet implemented (worktreeId=${worktreeId}, cwd=${cwd})`,
    );
  });

  ipcMain.handle("terminals:sendInput", (_event, raw: unknown) => {
    const { sessionId, data } = SendTerminalInputSchema.parse(raw);
    // TODO (Task 5): delegate to TerminalService
    throw new Error(
      `terminals:sendInput not yet implemented (sessionId=${sessionId}, data=${data})`,
    );
  });

  ipcMain.handle("terminals:resize", (_event, raw: unknown) => {
    const { sessionId, cols, rows } = ResizeTerminalSessionSchema.parse(raw);
    // TODO (Task 5): delegate to TerminalService
    throw new Error(
      `terminals:resize not yet implemented (sessionId=${sessionId}, cols=${cols}, rows=${rows})`,
    );
  });

  ipcMain.handle("terminals:stop", (_event, raw: unknown) => {
    const { sessionId } = StopTerminalSessionSchema.parse(raw);
    // TODO (Task 5): delegate to TerminalService
    throw new Error(
      `terminals:stop not yet implemented (sessionId=${sessionId})`,
    );
  });

  // --- Files ---

  ipcMain.handle("files:list", (_event, raw: unknown) => {
    const { worktreePath } = ListFilesSchema.parse(raw);
    // TODO (Task 7): delegate to FileService
    throw new Error(
      `files:list not yet implemented (worktreePath=${worktreePath})`,
    );
  });

  ipcMain.handle("files:read", (_event, raw: unknown) => {
    const { worktreePath, relativePath } = ReadFileSchema.parse(raw);
    // TODO (Task 7): delegate to FileService
    throw new Error(
      `files:read not yet implemented (worktreePath=${worktreePath}, relativePath=${relativePath})`,
    );
  });
}
