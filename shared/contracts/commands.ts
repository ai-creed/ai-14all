import { z } from "zod";
import type { Repository } from "../models/repository.js";
import type { Worktree } from "../models/worktree.js";
import type { TerminalSession } from "../models/terminal-session.js";
import type { FileView } from "../models/file-view.js";
import type {
  TerminalOutputEvent,
  TerminalExitEvent,
  TerminalStateEvent,
  TerminalErrorEvent,
} from "./events.js";

// --- Zod schemas for command payloads ---

export const SetRepositoryRootSchema = z.object({
  path: z.string(),
});

export const ListWorktreesSchema = z.object({});

export const CreateTerminalSessionSchema = z.object({
  worktreeId: z.string(),
  cwd: z.string(),
});

export const SendTerminalInputSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
});

export const ResizeTerminalSessionSchema = z.object({
  sessionId: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const StopTerminalSessionSchema = z.object({
  sessionId: z.string(),
});

export const ListFilesSchema = z.object({
  worktreePath: z.string(),
});

export const ReadFileSchema = z.object({
  worktreePath: z.string(),
  relativePath: z.string(),
});

// --- The API surface exposed to the renderer via the preload bridge ---

export type OneForAllDesktopApi = {
  repository: {
    setRoot(path: string): Promise<Repository>;
    listWorktrees(): Promise<Worktree[]>;
  };
  terminals: {
    create(worktreeId: string, cwd: string): Promise<TerminalSession>;
    sendInput(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stop(sessionId: string): Promise<void>;
    onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
    onState(listener: (event: TerminalStateEvent) => void): () => void;
    onError(listener: (event: TerminalErrorEvent) => void): () => void;
  };
  files: {
    list(worktreePath: string): Promise<string[]>;
    read(worktreePath: string, relativePath: string): Promise<FileView>;
  };
};
