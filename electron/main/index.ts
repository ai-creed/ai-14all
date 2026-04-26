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
import { startUpdateNotifier } from "./services/updateNotifier.js";
import { ReviewCommentStore } from "../../services/review/review-comment-store.js";
import { ReviewCommentService } from "../../services/review/review-comment-service.js";
import { WorktreeService } from "../../services/worktrees/worktree-service.js";
import {
	loadOrPickPort,
	writeLivenessFile,
	deleteLivenessFile,
} from "../../services/review/mcp-port-config.js";
import { ReviewMcpServer } from "../../services/review/review-mcp-server.js";
import { createWorktreePathResolver } from "../../services/review/worktree-path-resolver.js";

app.setName("ai-14all");

if (process.env.AI14ALL_USER_DATA_PATH) {
	app.setPath("userData", process.env.AI14ALL_USER_DATA_PATH);
}

app.whenReady().then(async () => {
	const shellEventLog = createShellEventLogService({
		userDataPath: app.getPath("userData"),
		isPackaged: app.isPackaged,
		appVersion: app.getVersion(),
	});
	shellEventLog.log({
		source: "main",
		event: "app-log-start",
		windowId: null,
		data: { version: app.getVersion(), isPackaged: app.isPackaged },
	});

	const mainWindow = createMainWindow(shellEventLog);
	startUpdateNotifier({
		currentVersion: app.getVersion(),
		webContents: mainWindow.webContents,
		isPackaged: app.isPackaged,
	});
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

	const worktreePathResolver = await createWorktreePathResolver(buildResolverEntries);

	const offRegistry = workspaceRegistry.onChange(() => {
		void worktreePathResolver.refresh();
	});

	let mcpServer: ReviewMcpServer | null = null;
	let mcpPort: number | null = null;
	let mcpBindError: string | null = null;

	try {
		const desiredPort = await loadOrPickPort(portConfigPath, {
			rangeStart: 51000,
			rangeEnd: 51999,
		});
		mcpServer = new ReviewMcpServer(reviewCommentService, worktreePathResolver, {
			port: desiredPort,
			host: "127.0.0.1",
		});
		mcpPort = await mcpServer.start();
		await writeLivenessFile(livenessPath, mcpPort);
	} catch (err) {
		mcpBindError = (err as Error).message;
		console.error("[review-mcp] bind failure", err);
	}

	const reviewMcpStatus = {
		get port() { return mcpPort; },
		get bindError() { return mcpBindError; },
		getUrl(): string | null {
			return mcpPort === null ? null : `http://127.0.0.1:${mcpPort}/mcp`;
		},
	};

	const { dispose } = registerIpcHandlers(mainWindow, {
		workspacePersistence,
		workspaceRegistry,
		worktreeService,
		shellEventLog,
		review: {
			service: reviewCommentService,
			mcpStatus: reviewMcpStatus,
			worktreePathResolver,
		},
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(
			fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
		);
	}
	app.on("before-quit", () => {
		offRegistry();
		void deleteLivenessFile(livenessPath);
		void mcpServer?.stop().catch(() => {});
	});

	registerAppLifecycle({
		onMainWindowClosed: (listener) => mainWindow.on("closed", listener),
		onWillQuit: (listener) => app.on("will-quit", listener),
		onWindowAllClosed: (listener) => app.on("window-all-closed", listener),
		quit: () => app.quit(),
		dispose,
	});
});
