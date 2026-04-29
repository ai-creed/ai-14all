import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { AgentSkillInstaller } from "../../services/review/agent-skill-installer/index.js";
import {
	AGENT_INSTALL_LIST,
	AGENT_INSTALL_DO,
	AGENT_INSTALL_UNINSTALL,
	AGENT_INSTALL_PICK_CLI,
	AGENT_INSTALL_SET_OVERRIDE,
	InstallRequestSchema,
	UninstallRequestSchema,
	PickCliPathRequestSchema,
	SetCliOverrideRequestSchema,
} from "../../shared/contracts/agent-install.js";
import { openExternalUrl } from "./services/open-external.js";
import { consumeE2eGitFault } from "./e2e-git-faults.js";
import { consumeE2eTerminalCreateDelay } from "./e2e-terminal-create-delay.js";
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
import { WorkspacePersistenceCoordinator } from "../../services/workspace/workspace-persistence-coordinator.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import type { ShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";
import type { ReviewCommentService } from "../../services/review/review-comment-service.js";
import type { WorktreePathResolver } from "../../services/review/worktree-path-resolver.js";
import {
	REVIEW_LIST,
	REVIEW_CREATE,
	REVIEW_MARK_ADDRESSED,
	REVIEW_REOPEN,
	REVIEW_DELETE,
	REVIEW_REBASE,
	REVIEW_COMMENT_CHANGED,
	ReviewListRequestSchema,
	ReviewCreateRequestSchema,
	ReviewMarkAddressedRequestSchema,
	ReviewReopenRequestSchema,
	ReviewDeleteRequestSchema,
	ReviewRebaseRequestSchema,
} from "../../shared/contracts/review-comments.js";
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
		worktreeService,
		shellEventLog,
		review,
	}: {
		workspacePersistence: WorkspacePersistenceService;
		workspaceRegistry: WorkspaceRegistryService;
		worktreeService: WorktreeService;
		shellEventLog?: ShellEventLogService;
		review: {
			service: ReviewCommentService;
			mcpStatus: {
				readonly port: number | null;
				readonly bindError: string | null;
				getUrl: () => string | null;
			};
			worktreePathResolver: WorktreePathResolver;
		};
	},
): {
	dispose: () => void;
	flushPersistence: () => Promise<void>;
} {
	const reviewCommentService = review.service;
	const fileService = new FileService();
	const gitService = new GitService();
	const persistenceCoordinator = new WorkspacePersistenceCoordinator(
		workspacePersistence,
	);

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
		const result = await worktreeService.createWorktree(
			workspaceRegistry.get(workspaceId),
			name,
		);
		await review.worktreePathResolver.refresh();
		return result;
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
		await reviewCommentService.removeByWorktree(worktreeId);
		await review.worktreePathResolver.refresh();
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

	ipcMain.handle("files:list", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = ListFilesSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.listFiles(worktree.path);
	});

	ipcMain.handle("files:read", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, relativePath } =
			ReadFileSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.readFile(worktree.path, relativePath);
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

	ipcMain.handle("files:listScoped", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, relativeRoots } =
			ListScopedFilesSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.listScopedFiles(worktree.path, relativeRoots);
	});

	ipcMain.handle("files:listTracked", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = ListTrackedFilesSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.listTrackedFiles(worktree.path);
	});

	// --- Git ---

	ipcMain.handle("git:listChanges", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = ListGitChangesSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.listChangedFiles(worktree.path);
	});

	ipcMain.handle("git:readDiff", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, relativePath } =
			ReadGitDiffSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.readDiff(worktree.path, relativePath);
	});

	ipcMain.handle("git:readSummary", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = ReadGitSummarySchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		if (consumeE2eGitFault("readSummaryFailuresRemaining")) {
			throw new Error("synthetic e2e summary failure");
		}
		return gitService.readSummary(worktree.path);
	});

	ipcMain.handle("git:readCommitHistory", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = ReadGitCommitHistorySchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.readCommitHistory(worktree.path);
	});

	ipcMain.handle("git:readCommitDetail", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, sha } =
			ReadGitCommitDetailSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.readCommitDetail(worktree.path, sha);
	});

	ipcMain.handle("git:discardChange", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, relativePath } =
			DiscardGitChangeSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.discardChange(worktree.path, relativePath);
	});

	ipcMain.handle("git:getRemoteStatus", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId } = GetGitRemoteStatusSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.getRemoteStatus(worktree.path);
	});

	ipcMain.handle("git:pushBranch", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, force } = PushGitBranchSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.pushBranch(worktree.path, force);
	});

	// --- Workspace ---

	ipcMain.handle("workspace:readRestoreState", (_event, raw: unknown) => {
		ReadWorkspaceRestoreStateSchema.parse(raw ?? {}); // no-op validation for symmetry with other handlers
		return workspacePersistence.readState();
	});

	ipcMain.handle("workspace:writeRestoreState", (_event, raw: unknown) => {
		const { state } = WriteWorkspaceRestoreStateSchema.parse(raw);
		persistenceCoordinator.enqueueWrite(state);
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

	// --- Review Comments ---

	ipcMain.handle(REVIEW_LIST, async (_event, raw: unknown) => {
		const { worktreeId } = ReviewListRequestSchema.parse(raw);
		return { comments: reviewCommentService.listByWorktree(worktreeId) };
	});

	ipcMain.handle(REVIEW_CREATE, async (_event, raw: unknown) => {
		const input = ReviewCreateRequestSchema.parse(raw);
		const comment = await reviewCommentService.create(input);
		return { comment };
	});

	ipcMain.handle(REVIEW_MARK_ADDRESSED, async (_event, raw: unknown) => {
		const { commentId } = ReviewMarkAddressedRequestSchema.parse(raw);
		return reviewCommentService.markAddressed(commentId);
	});

	ipcMain.handle(REVIEW_REOPEN, async (_event, raw: unknown) => {
		const { commentId } = ReviewReopenRequestSchema.parse(raw);
		const comment = await reviewCommentService.reopen(commentId);
		return { comment };
	});

	ipcMain.handle(REVIEW_DELETE, async (_event, raw: unknown) => {
		const { commentId } = ReviewDeleteRequestSchema.parse(raw);
		const deleted = await reviewCommentService.delete(commentId);
		return { deleted };
	});

	ipcMain.handle(REVIEW_REBASE, async (_event, raw: unknown) => {
		const { mapping } = ReviewRebaseRequestSchema.parse(raw);
		await reviewCommentService.rebaseWorktreeIds(
			new Map(Object.entries(mapping)),
		);
		return { ok: true as const };
	});

	const offReview = reviewCommentService.onChange((kind) => {
		safeSend(REVIEW_COMMENT_CHANGED, { kind });
	});

	// --- Agent Install ---

	const installer = new AgentSkillInstaller({
		home: app.getPath("home"),
		resourcesPath: app.isPackaged
			? process.resourcesPath
			: join(app.getAppPath(), "assets"),
		userDataPath: app.getPath("userData"),
		getMcpUrl: () => review.mcpStatus.getUrl(),
	});

	ipcMain.handle(AGENT_INSTALL_LIST, async () => {
		const { providers } = await installer.listProviders();
		return {
			providers,
			mcp: {
				port: review.mcpStatus.port,
				bindError: review.mcpStatus.bindError,
			},
		};
	});

	ipcMain.handle(AGENT_INSTALL_DO, async (_e, raw) => {
		const { providerIds } = InstallRequestSchema.parse(raw);
		const results = await installer.install(providerIds);
		return { results };
	});

	ipcMain.handle(AGENT_INSTALL_UNINSTALL, async (_e, raw) => {
		const { providerIds } = UninstallRequestSchema.parse(raw);
		const results = await installer.uninstall(providerIds);
		return { results };
	});

	ipcMain.handle(AGENT_INSTALL_PICK_CLI, async (e, raw) => {
		const { providerId } = PickCliPathRequestSchema.parse(raw);
		// Use the sender's window so the dialog parents correctly even if the
		// user focused another window after opening the modal.
		const senderWindow = BrowserWindow.fromWebContents(e.sender) ?? undefined;
		const opts = {
			properties: ["openFile" as const],
			message: `Locate ${providerId === "claude-code" ? "Claude Code" : "Codex"} CLI`,
		};
		const result = senderWindow
			? await dialog.showOpenDialog(senderWindow, opts)
			: await dialog.showOpenDialog(opts);
		if (result.canceled || result.filePaths.length === 0) {
			return { canceled: true, path: null };
		}
		return { canceled: false, path: result.filePaths[0] };
	});

	ipcMain.handle(AGENT_INSTALL_SET_OVERRIDE, async (_e, raw) => {
		const { providerId, path } = SetCliOverrideRequestSchema.parse(raw);
		const { providers } = await installer.setOverride(providerId, path);
		return {
			providers,
			mcp: {
				port: review.mcpStatus.port,
				bindError: review.mcpStatus.bindError,
			},
		};
	});

	return {
		dispose: () => {
			offReview();
			terminalService.dispose();
		},
		flushPersistence: () => persistenceCoordinator.flush(),
	};
}
