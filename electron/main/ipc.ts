import { dialog, ipcMain } from "electron";
import { consumeE2eGitFault } from "./e2e-git-faults.js";
import type { BrowserWindow } from "electron";
import {
	PickRepositoryRootSchema,
	OpenRepositoryWorkspaceSchema,
	CreateTerminalSessionSchema,
	SendTerminalInputSchema,
	ResizeTerminalSessionSchema,
	StopTerminalSessionSchema,
	ListFilesSchema,
	ReadFileSchema,
	ListGitChangesSchema,
	ReadGitDiffSchema,
	ListScopedFilesSchema,
	ReadGitSummarySchema,
	ReadWorkspaceRestoreStateSchema,
	WriteWorkspaceRestoreStateSchema,
	ReadGitCommitHistorySchema,
	ReadGitCommitDetailSchema,
	ListWorktreesSchema,
	PreviewCreateWorktreeSchema,
	CreateWorktreeSchema,
	PreviewRemoveWorktreeSchema,
	RemoveWorktreeSchema,
} from "../../shared/contracts/commands.js";
import type { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import { WorktreeService } from "../../services/worktrees/worktree-service.js";
import { TerminalService } from "../../services/terminals/terminal-service.js";
import { FileService } from "../../services/files/file-service.js";
import { GitService } from "../../services/git/git-service.js";
import type { TerminalEventHandlers } from "../../services/terminals/terminal-service.js";
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
// File and git commands delegate to FileService and GitService respectively.
// ---------------------------------------------------------------------------
export function registerIpcHandlers(
	mainWindow: BrowserWindow,
	{
		workspacePersistence,
		workspaceRegistry,
	}: {
		workspacePersistence: WorkspacePersistenceService;
		workspaceRegistry: WorkspaceRegistryService;
	},
): {
	dispose: () => void;
} {
	const worktreeService = new WorktreeService();
	const fileService = new FileService();
	const gitService = new GitService();

	const safeSend = <T extends object>(channel: string, payload: T) => {
		if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
			return;
		}
		mainWindow.webContents.send(channel, payload);
	};

	// --- Terminal service with event fan-out to renderer ---

	const terminalEventHandlers: TerminalEventHandlers = {
		onOutput(sessionId, data) {
			const payload: TerminalOutputEvent = { sessionId, data };
			safeSend("terminal/output", payload);
		},
		onExit(sessionId, exitCode) {
			const payload: TerminalExitEvent = { sessionId, exitCode };
			safeSend("terminal/exit", payload);
		},
		onState(sessionId, status) {
			const payload: TerminalStateEvent = { sessionId, status };
			safeSend("terminal/state", payload);
		},
		onError(sessionId, message) {
			const payload: TerminalErrorEvent = { sessionId, message };
			safeSend("terminal/error", payload);
		},
	};

	const terminalService = new TerminalService(terminalEventHandlers);

	// --- Repository ---

	ipcMain.handle("repository:pickRoot", async (_event, raw: unknown) => {
		PickRepositoryRootSchema.parse(raw);

		if (process.env.AI14ALL_E2E && process.env.AI14ALL_E2E_PICK_PATH) {
			return process.env.AI14ALL_E2E_PICK_PATH;
		}

		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ["openDirectory"],
		});

		if (result.canceled || result.filePaths.length === 0) {
			return null;
		}

		return result.filePaths[0] ?? null;
	});

	ipcMain.handle("workspace:openRepository", async (_event, raw: unknown) => {
		const { path } = OpenRepositoryWorkspaceSchema.parse(raw);
		const repository = await worktreeService.setRepositoryRoot(path);
		const proposedWorkspaceId = repository.repoId
			? `workspace:${repository.repoId}`
			: `workspace:${repository.rootPath}`;
		return workspaceRegistry.register({ workspaceId: proposedWorkspaceId, repository });
	});

	ipcMain.handle("repository:listWorktrees", async (_event, raw: unknown) => {
		const { workspaceId } = ListWorktreesSchema.parse(raw);
		return worktreeService.listWorktrees(workspaceRegistry.get(workspaceId));
	});

	ipcMain.handle("repository:previewCreateWorktree", async (_event, raw: unknown) => {
		const { workspaceId, name } = PreviewCreateWorktreeSchema.parse(raw);
		return worktreeService.previewCreateWorktree(workspaceRegistry.get(workspaceId), name);
	});

	ipcMain.handle("repository:createWorktree", async (_event, raw: unknown) => {
		const { workspaceId, name } = CreateWorktreeSchema.parse(raw);
		return worktreeService.createWorktree(workspaceRegistry.get(workspaceId), name);
	});

	ipcMain.handle("repository:previewRemoveWorktree", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = PreviewRemoveWorktreeSchema.parse(raw);
		return worktreeService.previewRemoveWorktree(workspaceRegistry.get(workspaceId), worktreeId);
	});

	ipcMain.handle("repository:removeWorktree", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = RemoveWorktreeSchema.parse(raw);
		await worktreeService.removeWorktree(workspaceRegistry.get(workspaceId), worktreeId);
	});

	// --- Terminals ---

	ipcMain.handle("terminals:create", (_event, raw: unknown) => {
		const { workspaceId, worktreeId, cwd } = CreateTerminalSessionSchema.parse(raw);
		return terminalService.create(workspaceId, worktreeId, cwd);
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

	ipcMain.handle("files:listScoped", (_event, raw: unknown) => {
		const { worktreePath, relativeRoots } = ListScopedFilesSchema.parse(raw);
		return fileService.listScopedFiles(worktreePath, relativeRoots);
	});

	// --- Git ---

	ipcMain.handle("git:listChanges", (_event, raw: unknown) => {
		const { worktreePath } = ListGitChangesSchema.parse(raw);
		return gitService.listChangedFiles(worktreePath);
	});

	ipcMain.handle("git:readDiff", (_event, raw: unknown) => {
		const { worktreePath, relativePath } = ReadGitDiffSchema.parse(raw);
		return gitService.readDiff(worktreePath, relativePath);
	});

	ipcMain.handle("git:readSummary", (_event, raw: unknown) => {
		const { worktreePath } = ReadGitSummarySchema.parse(raw);
		if (consumeE2eGitFault("readSummaryFailuresRemaining")) {
			throw new Error("synthetic e2e summary failure");
		}
		return gitService.readSummary(worktreePath);
	});

	ipcMain.handle("git:readCommitHistory", (_event, raw: unknown) => {
		const { worktreePath } = ReadGitCommitHistorySchema.parse(raw);
		return gitService.readCommitHistory(worktreePath);
	});

	ipcMain.handle("git:readCommitDetail", (_event, raw: unknown) => {
		const { worktreePath, sha } = ReadGitCommitDetailSchema.parse(raw);
		return gitService.readCommitDetail(worktreePath, sha);
	});

	// --- Workspace ---

	ipcMain.handle("workspace:readRestoreState", (_event, raw: unknown) => {
		ReadWorkspaceRestoreStateSchema.parse(raw ?? {}); // no-op validation for symmetry with other handlers
		return workspacePersistence.readState();
	});

	ipcMain.handle("workspace:writeRestoreState", (_event, raw: unknown) => {
		const { state } = WriteWorkspaceRestoreStateSchema.parse(raw);
		return workspacePersistence.writeState(state);
	});

	return { dispose: () => terminalService.dispose() };
}
