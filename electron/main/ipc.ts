import { dialog, ipcMain } from "electron";
import { openExternalUrl } from "./services/openExternal.js";
import { consumeE2eGitFault } from "./e2e-git-faults.js";
import { consumeE2eTerminalCreateDelay } from "./e2e-terminal-create-delay.js";
import type { BrowserWindow } from "electron";
import {
	PickRepositoryRootSchema,
	OpenRepositoryWorkspaceSchema,
	CreateTerminalSessionSchema,
	SendTerminalInputSchema,
	ResizeTerminalSessionSchema,
	StopTerminalSessionSchema,
	ListTerminalSessionsSchema,
	ListFilesSchema,
	ReadFileSchema,
	OpenFileForEditSchema,
	SaveFileSchema,
	ListGitChangesSchema,
	ReadGitDiffSchema,
	ListScopedFilesSchema,
	ReadGitSummarySchema,
	ReadWorkspaceRestoreStateSchema,
	WriteWorkspaceRestoreStateSchema,
	ReadGitCommitHistorySchema,
	ReadGitCommitDetailSchema,
	DiscardGitChangeSchema,
	GetGitRemoteStatusSchema,
	PushGitBranchSchema,
	ListWorktreesSchema,
	PreviewCreateWorktreeSchema,
	CreateWorktreeSchema,
	PreviewRemoveWorktreeSchema,
	RemoveWorktreeSchema,
	LogShellEventSchema,
	ListTrackedFilesSchema,
} from "../../shared/contracts/commands.js";
import type { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import type { ShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";
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
		shellEventLog,
	}: {
		workspacePersistence: WorkspacePersistenceService;
		workspaceRegistry: WorkspaceRegistryService;
		shellEventLog?: ShellEventLogService;
	},
): {
	dispose: () => void;
} {
	const worktreeService = new WorktreeService();
	const fileService = new FileService();
	const gitService = new GitService();

	const safeSend = <T extends object>(channel: string, payload: T) => {
		if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
			shellEventLog?.log({
				source: "main",
				event: "terminal-handler-dropped",
				windowId: null,
				data: { channel },
			});
			return;
		}
		shellEventLog?.log({
			source: "main",
			event: "terminal-handler-forwarded",
			windowId: mainWindow.id,
			data: { channel },
		});
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
		return workspaceRegistry.register({
			workspaceId: proposedWorkspaceId,
			repository,
		});
	});

	ipcMain.handle("repository:listWorktrees", async (_event, raw: unknown) => {
		const { workspaceId } = ListWorktreesSchema.parse(raw);
		return worktreeService.listWorktrees(workspaceRegistry.get(workspaceId));
	});

	ipcMain.handle(
		"repository:previewCreateWorktree",
		async (_event, raw: unknown) => {
			const { workspaceId, name } = PreviewCreateWorktreeSchema.parse(raw);
			return worktreeService.previewCreateWorktree(
				workspaceRegistry.get(workspaceId),
				name,
			);
		},
	);

	ipcMain.handle("repository:createWorktree", async (_event, raw: unknown) => {
		const { workspaceId, name } = CreateWorktreeSchema.parse(raw);
		return worktreeService.createWorktree(
			workspaceRegistry.get(workspaceId),
			name,
		);
	});

	ipcMain.handle(
		"repository:previewRemoveWorktree",
		async (_event, raw: unknown) => {
			const { workspaceId, worktreeId } =
				PreviewRemoveWorktreeSchema.parse(raw);
			return worktreeService.previewRemoveWorktree(
				workspaceRegistry.get(workspaceId),
				worktreeId,
			);
		},
	);

	ipcMain.handle("repository:removeWorktree", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = RemoveWorktreeSchema.parse(raw);
		await worktreeService.removeWorktree(
			workspaceRegistry.get(workspaceId),
			worktreeId,
		);
	});

	// --- Terminals ---

	ipcMain.handle("terminals:create", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, cwd } =
			CreateTerminalSessionSchema.parse(raw);
		shellEventLog?.log({
			source: "main",
			event: "terminal-create-request",
			windowId: mainWindow.id,
			data: { workspaceId, worktreeId, cwd },
		});
		await consumeE2eTerminalCreateDelay();
		return terminalService.create(workspaceId, worktreeId, cwd);
	});

	ipcMain.handle("terminals:list", (_event, raw: unknown) => {
		const { workspaceId } = ListTerminalSessionsSchema.parse(raw);
		shellEventLog?.log({
			source: "main",
			event: "main-session-list-request",
			windowId: mainWindow.id,
			data: { workspaceId },
		});
		const sessions = terminalService.listSessions(workspaceId);
		shellEventLog?.log({
			source: "main",
			event: "main-session-list-response",
			windowId: mainWindow.id,
			data: { workspaceId, liveBackendSessionIds: sessions.map((s) => s.id) },
		});
		return sessions;
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
		shellEventLog?.log({
			source: "main",
			event: "terminal-stop-request",
			windowId: mainWindow.id,
			data: { terminalSessionId: sessionId },
		});
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

	ipcMain.handle("files:openForEdit", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, relativePath } =
			OpenFileForEditSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.openForEdit(worktree.path, relativePath);
	});

	ipcMain.handle("files:save", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, relativePath, content, expectedMtimeMs } =
			SaveFileSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.saveFile(
			worktree.path,
			relativePath,
			content,
			expectedMtimeMs,
		);
	});

	ipcMain.handle("files:listScoped", (_event, raw: unknown) => {
		const { worktreePath, relativeRoots } = ListScopedFilesSchema.parse(raw);
		return fileService.listScopedFiles(worktreePath, relativeRoots);
	});

	ipcMain.handle("files:listTracked", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = ListTrackedFilesSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.listTrackedFiles(worktree.path);
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

	ipcMain.handle("git:discardChange", (_event, raw: unknown) => {
		const { worktreePath, relativePath } = DiscardGitChangeSchema.parse(raw);
		return gitService.discardChange(worktreePath, relativePath);
	});

	ipcMain.handle("git:getRemoteStatus", (_event, raw: unknown) => {
		const { worktreePath } = GetGitRemoteStatusSchema.parse(raw);
		return gitService.getRemoteStatus(worktreePath);
	});

	ipcMain.handle("git:pushBranch", (_event, raw: unknown) => {
		const { worktreePath, force } = PushGitBranchSchema.parse(raw);
		return gitService.pushBranch(worktreePath, force);
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

	// --- System ---

	ipcMain.handle("system:openExternal", async (_event, raw: unknown) => {
		if (
			typeof raw !== "object" ||
			raw === null ||
			typeof (raw as { url?: unknown }).url !== "string"
		) {
			throw new Error("system:openExternal expects { url: string }");
		}
		await openExternalUrl((raw as { url: string }).url);
	});

	// --- Diagnostics ---

	ipcMain.handle("diagnostics:logShellEvent", (_event, raw: unknown) => {
		const parsed = LogShellEventSchema.safeParse(raw);
		if (!parsed.success) return;
		shellEventLog?.log(parsed.data);
	});

	return { dispose: () => terminalService.dispose() };
}
