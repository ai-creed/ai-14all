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
import type { UsageHost } from "./services/usage-host.js";
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
	ReadGitCommitFileDiffSchema,
	DiscardGitChangeSchema,
	GetGitRemoteStatusSchema,
	PushGitBranchSchema,
	ListWorktreesSchema,
	PreviewCreateWorktreeSchema,
	CreateWorktreeSchema,
	PreviewRemoveWorktreeSchema,
	RemoveWorktreeSchema,
	ListRemoteBranchesSchema,
	RefreshRemoteSchema,
	LogShellEventSchema,
	ListWorktreeFilesSchema,
	SetEditorDirtySchema,
	ConfirmCloseSchema,
	DIAGNOSTICS_ATTENTION_EVENT,
} from "../../shared/contracts/commands.js";
import type { DiagnosticsAttentionLogEvent } from "../../shared/contracts/commands.js";
import {
	AttentionLogEventSchema,
	type AttentionLogEvent,
} from "../../services/diagnostics/agent-attention-logger.js";
import type { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import type { ShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";
import type { AgentAttentionLogger } from "../../services/diagnostics/agent-attention-logger.js";
import type { ReviewCommentService } from "../../services/review/review-comment-service.js";
import type { WorktreePathResolver } from "../../services/review/worktree-path-resolver.js";
import {
	REVIEW_LIST,
	REVIEW_CREATE,
	REVIEW_MARK_ADDRESSED,
	REVIEW_REOPEN,
	REVIEW_DELETE,
	REVIEW_REBASE,
	REVIEW_UPDATE,
	REVIEW_BULK_REMOVE_ADDRESSED,
	REVIEW_COMMENT_CHANGED,
	ReviewListRequestSchema,
	ReviewCreateRequestSchema,
	ReviewMarkAddressedRequestSchema,
	ReviewReopenRequestSchema,
	ReviewDeleteRequestSchema,
	ReviewRebaseRequestSchema,
	ReviewUpdateRequestSchema,
	ReviewBulkRemoveAddressedRequestSchema,
} from "../../shared/contracts/review-comments.js";
import { WorktreeService } from "../../services/worktrees/worktree-service.js";
import { TerminalService } from "../../services/terminals/terminal-service.js";
import { FileService } from "../../services/files/file-service.js";
import { GitService } from "../../services/git/git-service.js";
import { homedir } from "node:os";
import { bootstrapWorktreeMirror } from "../code-nav/refresh/bootstrap-worktree-mirror.js";
import chokidar from "chokidar";
import { CortexIndexService } from "../code-nav/cortex-index-service.js";
import { CortexKeyResolver } from "../code-nav/cortex-key-resolver.js";
import { CortexRefreshController } from "../code-nav/refresh/cortex-refresh.js";
import {
	WorktreeWatcher,
	type WatcherKeys,
} from "../code-nav/watch/worktree-watcher.js";
import { registerCodeNavIpc } from "../code-nav/ipc/register.js";
import type { WorktreeKeys } from "../code-nav/cortex-index-service.js";
import type { TerminalEventHandlers } from "../../services/terminals/terminal-service.js";
import type {
	TerminalOutputEvent,
	TerminalExitEvent,
	TerminalStateEvent,
	TerminalErrorEvent,
} from "../../shared/contracts/events.js";

// `shared/` cannot import from `services/`, so the renderer-facing attention
// event union is mirrored in shared/contracts/commands.ts. This bidirectional
// compile-time assertion (this module imports both layers) guarantees the
// mirror and the canonical union/schema can never drift apart.
type _AttentionEventMirrorInSync = [DiagnosticsAttentionLogEvent] extends [
	AttentionLogEvent,
]
	? [AttentionLogEvent] extends [DiagnosticsAttentionLogEvent]
		? true
		: never
	: never;
const _attentionEventMirrorInSync: _AttentionEventMirrorInSync = true;
void _attentionEventMirrorInSync;

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
		agentAttentionLogger,
		review,
		usageHost,
		installUpdate,
		closeGate,
		getCortexEnabled,
	}: {
		workspacePersistence: WorkspacePersistenceService;
		workspaceRegistry: WorkspaceRegistryService;
		worktreeService: WorktreeService;
		shellEventLog?: ShellEventLogService;
		agentAttentionLogger?: AgentAttentionLogger;
		review: {
			service: ReviewCommentService;
			mcpStatus: {
				readonly port: number | null;
				readonly bindError: string | null;
				getUrl: () => string | null;
			};
			worktreePathResolver: WorktreePathResolver;
		};
		usageHost?: UsageHost;
		installUpdate?: () => void;
		closeGate?: import("./close-gate.js").CloseGate;
		getCortexEnabled: () => boolean;
	},
): {
	dispose: () => void;
	terminalService: TerminalService;
} {
	const reviewCommentService = review.service;
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

	// shellEventLog is intentionally NOT threaded into TerminalService here:
	// production previously constructed it without one, so passing it now would
	// silently enable a large new stream of shell-event-log records. Only the
	// agent-attention logger (Task 10 lifecycle emits) is injected.
	const terminalService = new TerminalService(
		terminalEventHandlers,
		undefined,
		agentAttentionLogger,
	);

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
			const { workspaceId, name, baseBranch } =
				PreviewCreateWorktreeSchema.parse(raw);
			return worktreeService.previewCreateWorktree(
				workspaceRegistry.get(workspaceId),
				name,
				baseBranch,
			);
		},
	);

	ipcMain.handle("repository:createWorktree", async (_event, raw: unknown) => {
		const { workspaceId, name, baseBranch } = CreateWorktreeSchema.parse(raw);
		const result = await worktreeService.createWorktree(
			workspaceRegistry.get(workspaceId),
			name,
			baseBranch,
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

	ipcMain.handle(
		"repository:listRemoteBranches",
		async (_event, raw: unknown) => {
			const { workspaceId } = ListRemoteBranchesSchema.parse(raw);
			return worktreeService.listRemoteBranches(
				workspaceRegistry.get(workspaceId),
			);
		},
	);

	ipcMain.handle("repository:refreshRemote", async (_event, raw: unknown) => {
		const { workspaceId } = RefreshRemoteSchema.parse(raw);
		return worktreeService.refreshRemote(workspaceRegistry.get(workspaceId));
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
		const { workspaceId, worktreeId, relativePath } = ReadFileSchema.parse(raw);
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

	ipcMain.handle("files:listWorktree", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, includeIgnored } =
			ListWorktreeFilesSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return fileService.listWorktreeFiles(worktree.path, { includeIgnored });
	});

	// --- App-level close-gate ---

	ipcMain.on("app:setEditorDirty", (_event, raw: unknown) => {
		if (!closeGate) return;
		const parsed = SetEditorDirtySchema.safeParse(raw);
		if (!parsed.success) return;
		closeGate.setDirty(parsed.data);
	});

	ipcMain.on("app:confirmClose", (_event, raw: unknown) => {
		if (!closeGate) return;
		const parsed = ConfirmCloseSchema.safeParse(raw);
		if (!parsed.success) return;
		closeGate.confirmClose(parsed.data);
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

	ipcMain.handle("git:readCommitFileDiff", async (_event, raw: unknown) => {
		const { workspaceId, worktreeId, sha, file } =
			ReadGitCommitFileDiffSchema.parse(raw);
		const repository = workspaceRegistry.get(workspaceId);
		const worktree = await worktreeService.findWorktree(repository, worktreeId);
		return gitService.readCommitFileDiff(worktree.path, sha, file);
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

	ipcMain.handle("update:install", () => {
		installUpdate?.();
	});

	// --- Diagnostics ---

	ipcMain.handle("diagnostics:logShellEvent", (_event, raw: unknown) => {
		const parsed = LogShellEventSchema.safeParse(raw);
		if (!parsed.success) return;
		shellEventLog?.log(parsed.data);
	});

	// One-way (`ipcRenderer.send`): fire-and-forget so the renderer never
	// blocks on disk. Untrusted payloads are Zod-validated against the
	// canonical schema; invalid payloads are silently dropped, and the
	// logger may be absent (mode `off` / not constructed) — guard with `?.`.
	ipcMain.on(DIAGNOSTICS_ATTENTION_EVENT, (_event, raw: unknown) => {
		const parsed = AttentionLogEventSchema.safeParse(raw);
		if (!parsed.success) return;
		agentAttentionLogger?.append(parsed.data).catch(() => {});
	});

	ipcMain.handle("diagnostics:getAgentAttentionStatus", () => ({
		mode: agentAttentionLogger?.getMode() ?? "off",
		logsDir: agentAttentionLogger?.getLogsDir() ?? "",
	}));

	// --- Token telemetry ---

	ipcMain.handle("usage:setEnabled", (_event, enabled: unknown) => {
		usageHost?.setEnabled(Boolean(enabled));
	});
	ipcMain.handle("usage:setBudgets", (_event, raw: unknown) => {
		const r = (raw ?? {}) as {
			fiveHourBudget?: number | null;
			weeklyBudget?: number | null;
		};
		usageHost?.setBudgets(r.fiveHourBudget ?? null, r.weeklyBudget ?? null);
	});
	ipcMain.handle("usage:setWeeklyReset", (_event, raw: unknown) => {
		const r = (raw ?? {}) as {
			weeklyResetDay?: number;
			weeklyResetHour?: number;
		};
		if (
			typeof r.weeklyResetDay === "number" &&
			typeof r.weeklyResetHour === "number"
		) {
			usageHost?.setWeeklyReset(r.weeklyResetDay, r.weeklyResetHour);
		}
	});
	ipcMain.handle("usage:setIncludeUntracked", (_event, v: unknown) => {
		usageHost?.setIncludeUntracked(Boolean(v));
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

	ipcMain.handle(REVIEW_UPDATE, async (_event, raw: unknown) => {
		const { commentId, body } = ReviewUpdateRequestSchema.parse(raw);
		return reviewCommentService.update(commentId, { body });
	});

	ipcMain.handle(REVIEW_BULK_REMOVE_ADDRESSED, async (_event, raw: unknown) => {
		const input = ReviewBulkRemoveAddressedRequestSchema.parse(raw);
		return reviewCommentService.bulkRemoveAddressed(input);
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

	// ---------------------------------------------------------------------------
	// code-nav: IPC + watcher + refresh pipeline
	// ---------------------------------------------------------------------------
	const cortexCacheRoot =
		process.env.AI14ALL_CORTEX_CACHE_ROOT ??
		join(homedir(), ".cache", "ai-cortex", "v1");
	const codeNavCacheRoot =
		process.env.AI14ALL_CODE_NAV_CACHE_ROOT ??
		join(homedir(), ".cache", "ai-14all", "code-nav");
	const cortexIndex = new CortexIndexService({
		cacheRoot: codeNavCacheRoot,
	});
	const cortexKeyResolver = new CortexKeyResolver({ cortexCacheRoot });
	const refresh = new CortexRefreshController({
		cortexIndex,
		cortexCacheRoot,
		codeNavCacheRoot,
		emit: (ev, payload) => mainWindow.webContents.send(ev, payload),
		toast: (msg) =>
			mainWindow.webContents.send("app:toast", { kind: "warn", message: msg }),
		isCortexEnabled: getCortexEnabled,
	});
	const watchKeys = new Map<
		string,
		{ keys: WorktreeKeys; ids: { workspaceId: string; worktreeId: string } }
	>();
	const watcher = new WorktreeWatcher({
		chokidar: chokidar as unknown as WorktreeWatcher["opts"]["chokidar"],
		debounceMs: 500,
		onBatch: ({ keys: { worktreePath }, changedFiles }) => {
			const entry = watchKeys.get(worktreePath);
			if (!entry) return;
			// The controller already toasts on failure and rejects; swallow here
			// so a failed background re-index (e.g. ai-cortex CLI error) doesn't
			// surface as an unhandled promise rejection.
			void refresh.refresh(entry.keys, entry.ids, changedFiles).catch(() => {});
		},
	});
	const disposeCodeNavIpc = registerCodeNavIpc({
		workspaceRegistry,
		worktreeService,
		cortexIndex,
		cortexKeyResolver,
		isCortexEnabled: getCortexEnabled,
		refreshController: {
			refresh: async (keys, ids, changed) =>
				refresh.refresh(keys, ids, changed),
		},
		watcherController: {
			watch: (keys, ids) => {
				// First-time bootstrap: seed the mirror from an existing cortex `.db`
				// (no CLI spawn). Shares the refresh marker discipline so an
				// absent/old/unsupported cortex is recorded for getWorktreeStatus.
				bootstrapWorktreeMirror(
					{
						cortexCacheRoot,
						codeNavCacheRoot,
						cortexIndex,
						mirrorPathForKeys: (r, w) => cortexIndex.dbPathForKeys(r, w),
						emit: (ev, payload) => mainWindow.webContents.send(ev, payload),
					},
					keys,
					ids,
				);
				watchKeys.set(keys.worktreePath, { keys, ids });
				watcher.watch({
					worktreePath: keys.worktreePath,
				} satisfies WatcherKeys);
			},
			unwatch: (keys) => {
				watchKeys.delete(keys.worktreePath);
				watcher.unwatch({ worktreePath: keys.worktreePath });
			},
		},
	});

	return {
		dispose: () => {
			offReview();
			terminalService.dispose();
			disposeCodeNavIpc();
			watcher.dispose();
			cortexIndex.dispose();
		},
		terminalService,
	};
}
