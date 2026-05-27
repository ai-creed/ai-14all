import { app, Menu } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";
import { registerAppLifecycle } from "./lifecycle.js";
import { buildApplicationMenu } from "./menu.js";
import { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import { createShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";
import {
	AgentAttentionLogger,
	type AgentAttentionLogMode,
} from "../../services/diagnostics/agent-attention-logger.js";
import electronUpdater from "electron-updater";
import { startUpdateService } from "./services/update-service.js";
import { UsageHost } from "./services/usage-host.js";
import type { KnownWorktree } from "../../shared/models/usage.js";
import { ReviewCommentStore } from "../../services/review/review-comment-store.js";
import { ReviewCommentService } from "../../services/review/review-comment-service.js";
import { WorktreeService } from "../../services/worktrees/worktree-service.js";
import {
	loadOrPickPort,
	writeLivenessFile,
	deleteLivenessFile,
} from "../../services/review/mcp-port-config.js";
import { Ai14allMcpServer } from "../../services/mcp/ai14all-mcp-server.js";
import { SessionNoteBridge } from "../../services/mcp/session-note-bridge.js";
import { AgentAttentionBridge } from "../../services/mcp/agent-attention-bridge.js";
import { createWorktreePathResolver } from "../../services/review/worktree-path-resolver.js";

app.setName("ai-14all");

if (process.env.AI14ALL_USER_DATA_PATH) {
	app.setPath("userData", process.env.AI14ALL_USER_DATA_PATH);
}

app.whenReady().then(async () => {
	const debugMode = process.env.AI14ALL_DEBUG;
	const shellEventLogMode =
		debugMode === "full"
			? ("full" as const)
			: debugMode === "1"
				? ("sampled" as const)
				: undefined;
	const shellEventLog = createShellEventLogService({
		userDataPath: app.getPath("userData"),
		isPackaged: app.isPackaged,
		appVersion: app.getVersion(),
		mode: shellEventLogMode,
	});

	// Agent-attention diagnostics logger. Opt-in only via the
	// AI14ALL_AGENT_ATTENTION_LOG env var, mirroring the AI14ALL_DEBUG pattern
	// used for the shell-event log above. Default is `off` (nothing written).
	const agentAttentionEnv = process.env.AI14ALL_AGENT_ATTENTION_LOG;
	const agentAttentionLogMode: AgentAttentionLogMode =
		agentAttentionEnv === "full"
			? "full"
			: agentAttentionEnv === "sampled" || agentAttentionEnv === "1"
				? "sampled"
				: "off";
	const agentAttentionLogger = new AgentAttentionLogger({
		logsDir: app.getPath("logs"),
		mode: agentAttentionLogMode,
	});
	shellEventLog.log({
		source: "main",
		event: "app-log-start",
		windowId: null,
		data: { version: app.getVersion(), isPackaged: app.isPackaged },
	});

	const mainWindow = createMainWindow(shellEventLog);
	const { autoUpdater } = electronUpdater;
	const updateService = startUpdateService({
		updater: autoUpdater,
		currentVersion: app.getVersion(),
		isPackaged: app.isPackaged,
		send: (channel, payload) => {
			if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
				mainWindow.webContents.send(channel, payload);
			}
		},
	});

	// Token telemetry: gated utilityProcess that reads ~/.claude and ~/.codex logs
	// and pushes UsageSnapshots to the renderer. Enabled by default.
	const usageHost = new UsageHost({
		userDataDir: app.getPath("userData"),
		launchMs: Date.now(),
		send: (channel, payload) => {
			if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
				mainWindow.webContents.send(channel, payload);
			}
		},
	});
	usageHost.start();
	Menu.setApplicationMenu(buildApplicationMenu(mainWindow));
	const workspacePersistence = new WorkspacePersistenceService(
		process.env.AI14ALL_WORKSPACE_STATE_PATH ??
			join(app.getPath("userData"), "workspace-state.json"),
	);
	const workspaceRegistry = new WorkspaceRegistryService();
	const reviewUserDir = join(app.getPath("userData"), "ai-14all");
	const reviewCommentStore = new ReviewCommentStore(
		join(reviewUserDir, "review-comments.json"),
	);
	const reviewCommentService = new ReviewCommentService(reviewCommentStore);
	await reviewCommentService.init();

	const worktreeService = new WorktreeService();

	const portConfigPath = join(reviewUserDir, "mcp-config.json");
	const livenessPath = join(reviewUserDir, "mcp-port");

	const buildResolverEntries = async () => {
		const entries: { id: string; path: string }[] = [];
		for (const repo of workspaceRegistry.listRepositories()) {
			try {
				const worktrees = await worktreeService.listWorktrees(repo);
				for (const wt of worktrees) entries.push({ id: wt.id, path: wt.path });
			} catch (err) {
				console.warn(
					"[review-mcp] could not list worktrees for repo",
					repo.rootPath,
					err,
				);
			}
		}
		return entries;
	};

	const worktreePathResolver =
		await createWorktreePathResolver(buildResolverEntries);

	// Feed the worktree registry to the telemetry host so transcript cwds map to
	// real worktrees (and the popover's Active scope populates). Refreshed on
	// registry changes below.
	const refreshUsageWorktrees = async () => {
		const known: KnownWorktree[] = [];
		for (const repo of workspaceRegistry.listRepositories()) {
			try {
				const worktrees = await worktreeService.listWorktrees(repo);
				for (const wt of worktrees) {
					known.push({
						worktreeId: wt.id,
						workspaceId: wt.repositoryId,
						title: wt.label,
						path: wt.path,
					});
				}
			} catch {
				/* repo unreadable — skip */
			}
		}
		usageHost.setKnownWorktrees(known);
		usageHost.setActiveWorktrees(known.map((w) => w.worktreeId));
	};
	void refreshUsageWorktrees();

	const sessionNoteBridge = new SessionNoteBridge(() => mainWindow.webContents);
	const agentAttentionBridge = new AgentAttentionBridge(
		() => mainWindow.webContents,
	);

	const offRegistry = workspaceRegistry.onChange(() => {
		void worktreePathResolver.refresh();
		void refreshUsageWorktrees();
	});

	let mcpServer: Ai14allMcpServer | null = null;
	let mcpPort: number | null = null;
	let mcpBindError: string | null = null;

	try {
		const desiredPort = await loadOrPickPort(portConfigPath, {
			rangeStart: 51000,
			rangeEnd: 51999,
		});
		mcpServer = new Ai14allMcpServer(
			reviewCommentService,
			worktreePathResolver,
			sessionNoteBridge,
			agentAttentionBridge,
			{ port: desiredPort, host: "127.0.0.1" },
			agentAttentionLogger,
		);
		mcpPort = await mcpServer.start();
		await writeLivenessFile(livenessPath, mcpPort);
	} catch (err) {
		mcpBindError = (err as Error).message;
		console.error("[review-mcp] bind failure", err);
	}

	const reviewMcpStatus = {
		get port() {
			return mcpPort;
		},
		get bindError() {
			return mcpBindError;
		},
		getUrl(): string | null {
			return mcpPort === null ? null : `http://127.0.0.1:${mcpPort}/mcp`;
		},
	};

	const { dispose } = registerIpcHandlers(mainWindow, {
		workspacePersistence,
		workspaceRegistry,
		worktreeService,
		shellEventLog,
		agentAttentionLogger,
		review: {
			service: reviewCommentService,
			mcpStatus: reviewMcpStatus,
			worktreePathResolver,
		},
		usageHost,
		installUpdate: () => updateService.installUpdate(),
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(
			fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
		);
	}
	app.on("before-quit", () => {
		updateService.dispose();
		offRegistry();
		void deleteLivenessFile(livenessPath);
		void mcpServer?.stop().catch(() => {});
		sessionNoteBridge.dispose();
		agentAttentionBridge.dispose();
		usageHost.stop();
	});

	registerAppLifecycle({
		onMainWindowClosed: (listener) => mainWindow.on("closed", listener),
		onWillQuit: (listener) => app.on("will-quit", listener),
		onWindowAllClosed: (listener) => app.on("window-all-closed", listener),
		quit: () => app.quit(),
		dispose,
	});
});
