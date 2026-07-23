import { app, ipcMain, Menu, safeStorage } from "electron";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { watch } from "chokidar";
import { createMainWindow } from "./windows.js";
import { registerIpcHandlers } from "./ipc.js";
import { createCloseGate } from "./close-gate.js";
import { registerAppLifecycle, registerHideOnClose } from "./lifecycle.js";
import { buildApplicationMenu } from "./menu.js";
import { WorkspacePersistenceService } from "../../services/workspace/workspace-persistence-service.js";
import { SettingsService } from "../../services/settings/settings-service.js";
import type { PersistedSettingsV1 } from "../../shared/models/persisted-settings.js";
import { WorkspaceRegistryService } from "../../services/workspace/workspace-registry-service.js";
import { createShellEventLogService } from "../../services/diagnostics/shell-event-log-service.js";
import {
	AgentAttentionLogger,
	type AgentAttentionLogMode,
} from "../../services/diagnostics/agent-attention-logger.js";
import electronUpdater from "electron-updater";
import { startUpdateService } from "./services/update-service.js";
import { UsageHost, USAGE_SNAPSHOT_CHANNEL } from "./services/usage-host.js";
import { createUsageSettingsBridge } from "./services/usage-settings-bridge.js";
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
import { AgentResumeBridge } from "../../services/mcp/agent-resume-bridge.js";
import { createWorktreePathResolver } from "../../services/review/worktree-path-resolver.js";
import { createPluginConfigStore } from "../../services/plugins/plugin-config.js";
import { createCapabilityProbeService } from "../../services/plugins/capability-probe-service.js";
import { createPluginRegistry } from "../../services/plugins/plugin-registry.js";
import {
	registerPluginIpc,
	pushWhisperState,
	pushSamanthaHealth,
	pushSamanthaFocusWorktree,
} from "../../services/plugins/plugin-ipc.js";
import { resolveBinary } from "../../services/plugins/binary-resolver.js";
import { augmentGuiLaunchPath } from "../../services/plugins/shell-path.js";
import { probeWhisper } from "../../services/plugins/whisper/whisper-env-probe.js";
import { createWhisperDriver } from "../../services/plugins/whisper/whisper-driver.js";
import { createCortexDriver } from "../../services/plugins/cortex/cortex-driver.js";
import { probeCortex } from "../../services/plugins/cortex/cortex-probe.js";
import { createSamanthaDriver } from "../../services/plugins/samantha/samantha-driver.js";
import { createFocusWorktreeEffect } from "../../services/plugins/samantha/samantha-focus-effect.js";
import type { WebSocketCtor } from "../../services/plugins/samantha/samantha-command-client.js";
import { createSamanthaConnectorClient } from "../../services/plugins/samantha/samantha-connector-client.js";
import { WhisperStoreReader } from "../../services/plugins/whisper/whisper-store-reader.js";
import { createWhisperCollabWatcher } from "../../services/plugins/whisper/whisper-collab-watcher.js";
import type { WorktreeIdentity } from "../../services/plugins/samantha/observe-types.js";
import { createWhisperCommandRunner } from "../../services/plugins/whisper/whisper-command-runner.js";
import { PluginCommandLogger } from "../../services/diagnostics/plugin-command-logger.js";
import { ActingAuditLogger } from "../../services/diagnostics/acting-audit-logger.js";
import { PtyInspectService } from "../../services/pty-inspect/pty-inspect-service.js";
import { createActingTokenVerifier } from "../../services/plugins/samantha/acting-token-verifier.js";
import type { WhisperCommand } from "../../shared/contracts/plugins.js";
import { createSessionSliceStore } from "../../services/plugins/samantha/session-slice-source.js";
import { createSessionReportProvider } from "../../services/plugins/samantha/session-report-provider.js";
import type { XbpHostService } from "../../services/xbp/xbp-host-service.js";
import {
	createWorkflowResolver,
	createXbpActingExecutor,
} from "../../services/xbp/xbp-acting-executor.js";
import { registerXbpIpc, PHONE_BRIDGE_STATUS_CHANGED } from "./xbp-ipc.js";
import { createXbpHostIfEnabled } from "./xbp-boot.js";
import { isPhoneBridgeEnabled } from "../../shared/models/persisted-settings.js";
import { XbpPushTokenStore } from "../../services/xbp/xbp-push-token-store.js";
import { createPushTokenHandlers } from "../../services/xbp/xbp-push-token-handlers.js";
import { createPushWakeWatcher } from "../../services/xbp/push-wake-watcher.js";
import { PushWakeStateStore } from "../../services/xbp/push-wake-state-store.js";
import { createPushWakeSender } from "../../services/xbp/push-wake-sender.js";
import { PushWakeAuditLogger } from "../../services/diagnostics/push-wake-audit-logger.js";
import { isPushWakeEnabled } from "../../shared/models/persisted-settings.js";

app.setName("ai-14all");

if (process.env.AI14ALL_USER_DATA_PATH) {
	app.setPath("userData", process.env.AI14ALL_USER_DATA_PATH);
}

app.whenReady().then(async () => {
	// macOS apps launched from Finder/Dock inherit only the bare GUI PATH
	// (/usr/bin:/bin:...), so Homebrew/npm CLIs — and the `node` that their
	// `#!/usr/bin/env node` shebangs need — are unreachable to execFile. That
	// makes plugin probes (e.g. `whisper env --json`) fail to spawn and report
	// "not installed" even when the tool is installed. Repair PATH from a login
	// shell once, before any probe spawns a child.
	await augmentGuiLaunchPath({
		platform: process.platform,
		isPackaged: app.isPackaged,
	});

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
		platform: process.platform,
		arch: process.arch,
		send: (channel, payload) => {
			if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
				mainWindow.webContents.send(channel, payload);
			}
		},
	});

	// Shared with SettingsService below: its legacy seed source must read the SAME
	// resolved workspace-state file WorkspacePersistenceService uses — including
	// the AI14ALL_WORKSPACE_STATE_PATH env seam e2e tests rely on.
	const workspaceStatePath =
		process.env.AI14ALL_WORKSPACE_STATE_PATH ??
		join(app.getPath("userData"), "workspace-state.json");
	const workspacePersistence = new WorkspacePersistenceService(
		workspaceStatePath,
	);
	const settingsService = new SettingsService(
		join(app.getPath("userData"), "settings.json"),
		workspaceStatePath,
	);
	// Sync read for the preload's settings.initial/initialFirstRun. Must be
	// registered before the first window loads (loadFile/loadURL below triggers
	// the preload). ipcMain.on + a promise does NOT satisfy sendSync — the
	// renderer unblocks on the synchronous return — so this uses SettingsService's
	// sync twin. The full { settings, firstRun } result is returned (not just
	// `.settings`) because this sendSync call is the ONLY point that can ever
	// observe firstRun: true — it seeds the settings file as a side effect, so
	// any later async settings:read always sees firstRun: false.
	ipcMain.on("settings:readSync", (event) => {
		try {
			event.returnValue = settingsService.readStateSync();
		} catch {
			event.returnValue = null;
		}
	});

	// Token telemetry: gated utilityProcess that reads ~/.claude and ~/.codex logs
	// and pushes UsageSnapshots to the renderer. Enabled by default. The settings
	// bridge loads the persisted usage UI settings once (async) and exposes a sync
	// snapshot for the host's loadSettings plus an async read-modify-write persist.
	// Broadcasts settings:changed on every bridge-driven persist (usage popover
	// writes bypass the settings:write IPC handler's own broadcast — see the
	// bridge's `onPersisted` doc comment) so the Settings dialog's usage
	// telemetry checkbox/toggles stay in sync within the same session.
	const broadcastSettingsChanged = (settings: PersistedSettingsV1) => {
		if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
			mainWindow.webContents.send("settings:changed", settings);
		}
	};
	const usageSettings = await createUsageSettingsBridge(
		settingsService,
		broadcastSettingsChanged,
	);
	const usageHost = new UsageHost({
		userDataDir: app.getPath("userData"),
		launchMs: Date.now(),
		send: (channel, payload) => {
			if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
				mainWindow.webContents.send(channel, payload);
			}
		},
		loadSettings: () => usageSettings.settings,
		persistSettings: usageSettings.persist, // returns Promise<void>; host fires it without awaiting
	});
	usageHost.start();
	// E2E seam: the fixture snapshot is emitted inside start() before loadFile() is
	// called, so webContents.send() has no renderer to deliver to and the message is
	// dropped. Re-send the cached last snapshot once the page has fully loaded so the
	// preload's buffered-channel once-handler can capture it.
	mainWindow.webContents.on("did-finish-load", () => {
		const last = usageHost.getLastSnapshot();
		if (
			last &&
			!mainWindow.isDestroyed() &&
			!mainWindow.webContents.isDestroyed()
		) {
			mainWindow.webContents.send(USAGE_SNAPSHOT_CHANNEL, last);
		}
	});
	Menu.setApplicationMenu(buildApplicationMenu(mainWindow));
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

	// --- Ecosystem plugin subsystem (registry, config, whisper driver) ---
	const pluginConfig = createPluginConfigStore({
		configPath: join(app.getPath("userData"), "config.toml"),
		watch: (path, onEvent) => {
			const watcher = watch(path, { ignoreInitial: true });
			watcher.on("all", onEvent);
			return () => void watcher.close();
		},
	});

	const whisperStateRoot =
		process.env.AI14ALL_WHISPER_STATE_ROOT ?? join(homedir(), ".ai-whisper");

	// Spec §3.4: the single probe owner — agent CLIs + cached plugin probes.
	const capabilityProbes = createCapabilityProbeService();

	const getWhisperBinary = () =>
		resolveBinary("whisper", {
			installPath: pluginConfig.get("whisper").installPath,
		});

	const pluginCommandLogger = new PluginCommandLogger({
		logsDir: join(app.getPath("userData"), "logs"),
	});

	const whisperCommandRunner = createWhisperCommandRunner({
		getBinary: getWhisperBinary,
		audit: pluginCommandLogger,
	});

	const whisperDriver = createWhisperDriver({
		getStateRoot: () => whisperStateRoot,
		getBinary: getWhisperBinary,
		probeImpl: () =>
			// Routed through the capability probe service so registry re-probes hit
			// the cache instead of spawning a fresh child process every time.
			capabilityProbes.probePlugin("whisper", async () => {
				const binary = await getWhisperBinary();
				if (binary === null) return { kind: "not-installed" };
				return probeWhisper(binary);
			}),
		resolveWorktreeId: (workspaceRoot) =>
			worktreePathResolver.resolve(workspaceRoot),
		pushState: (states) =>
			pushWhisperState(() => mainWindow.webContents, states),
		// E2e seam: the live-socket scenario sets this to 60s so a fast UI update
		// can only have come from the event-socket path, not from polling.
		// NaN/empty guard: a malformed value must fall back to the driver
		// default, not become setInterval(NaN) or setInterval(0).
		pollIntervalMs:
			process.env.AI14ALL_WHISPER_POLL_MS &&
			Number.isFinite(Number(process.env.AI14ALL_WHISPER_POLL_MS)) &&
			Number(process.env.AI14ALL_WHISPER_POLL_MS) > 0
				? Number(process.env.AI14ALL_WHISPER_POLL_MS)
				: undefined,
		// Re-snapshot the lens when the known-worktree set changes so a collab in
		// a just-loaded worktree appears immediately. The resolver self-heals on a
		// miss, so this stays correct regardless of listener order vs the resolver
		// refresh wired below.
		subscribeWorktreeChanges: (onChange) =>
			workspaceRegistry.onChange(onChange),
	});

	const getCortexBinary = () =>
		resolveBinary("ai-cortex", {
			installPath: pluginConfig.get("cortex").installPath,
		});

	const cortexDriver = createCortexDriver({
		probeImpl: () =>
			// Routed through the capability probe service so registry re-probes hit
			// the cache instead of spawning a fresh child every time (like whisper).
			// probeCortex handles the null binary -> not-installed.
			capabilityProbes.probePlugin("cortex", async () =>
				probeCortex(await getCortexBinary()),
			),
		// Toggle on -> registry start(); toggle off -> registry stop(). Either way,
		// broadcast so the renderer re-queries code-nav status and the gate flips.
		onAvailabilityChanged: () => {
			if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
				mainWindow.webContents.send("code-nav:availabilityChanged", {});
		},
	});

	// Read-only whisper snapshot reader for the observe document (separate from
	// the whisper driver's own watcher; we never write to state.db).
	const samanthaWhisperWatcher = createWhisperCollabWatcher({
		reader: new WhisperStoreReader(join(whisperStateRoot, "state.db")),
		resolveWorktreeId: (workspaceRoot) =>
			worktreePathResolver.resolve(workspaceRoot),
	});

	// Build worktreeId -> identity (repo/branch/path) across all registered repos.
	const getSamanthaIdentities = async (): Promise<
		Record<string, WorktreeIdentity>
	> => {
		const out: Record<string, WorktreeIdentity> = {};
		for (const repository of workspaceRegistry.listRepositories()) {
			for (const wt of await worktreeService.listWorktrees(repository)) {
				out[wt.id] = {
					repo: repository.name,
					branch: wt.branchName,
					path: wt.path,
				};
			}
		}
		return out;
	};

	if (typeof globalThis.WebSocket !== "function") {
		// Planned fallback per the spec's Dependencies section: if this ever fires,
		// add `ws` as a PRODUCTION dependency and pass its client as webSocketImpl.
		throw new Error(
			"globalThis.WebSocket is unavailable in the Electron main runtime",
		);
	}

	const samanthaFocusWorktree = createFocusWorktreeEffect({
		send: (payload) =>
			pushSamanthaFocusWorktree(() => mainWindow.webContents, payload),
		raiseWindow: () => {
			if (!mainWindow.isDestroyed()) {
				mainWindow.show();
				mainWindow.focus();
			}
		},
		getFocusRaisesWindow: () =>
			pluginConfig.get("samantha").behavior?.focusRaisesWindow ?? true,
	});

	const actingAuditLogger = new ActingAuditLogger({
		logsDir: join(app.getPath("userData"), "logs"),
	});

	// Late-bound terminal sendInput: TerminalService is created later inside
	// registerIpcHandlers; the driver only calls this at command-dispatch time,
	// long after startup wiring completes.
	let actingSendInput: ((sessionId: string, data: string) => void) | null =
		null;

	const actingTokenPath =
		process.env.SAMANTHA_ACTING_TOKEN_PATH ??
		join(homedir(), ".ai-samantha", "connector-token");
	const actingTokenVerifier = createActingTokenVerifier({
		readSecret: () => {
			try {
				return readFileSync(actingTokenPath, "utf8").trim() || null;
			} catch {
				return null;
			}
		},
	});

	const resolveWorktreeRef = async (
		worktreeId: string,
	): Promise<{ workspaceId: string; cwd: string } | null> => {
		for (const { workspaceId, repository } of workspaceRegistry.listEntries()) {
			try {
				const worktree = await worktreeService.findWorktree(
					repository,
					worktreeId,
				);
				return { workspaceId, cwd: worktree.path };
			} catch {
				// not in this repository; keep scanning.
			}
		}
		return null;
	};

	// Composition seam (XBP PTY inspect, spec §§1.2/3-4): constructed here —
	// after resolveWorktreeRef, before the XBP host below — because the host
	// (and XbpPeerSession inside it) is built synchronously at startup, while
	// TerminalService only exists later inside registerIpcHandlers. Injected
	// into both: the host now, TerminalService via attachTerminalService()
	// once registerIpcHandlers returns it.
	const ptyInspectService = new PtyInspectService({
		logsDir: join(app.getPath("userData"), "logs"),
		resolveWorktree: resolveWorktreeRef,
	});

	// Shared slice store — single source of truth for both Samantha driver and
	// the XBP session-report provider so neither path drifts from the other.
	const samanthaSliceSource = createSessionSliceStore();

	// Shared getters — declared once so both consumers are structurally guaranteed
	// to use the same implementation (a future edit cannot change one without the other).
	const getReviewCount = (worktreeId: string) =>
		reviewCommentService.listOpenByWorktree(worktreeId).length;
	const getWhisperStates = () => samanthaWhisperWatcher.snapshot();

	// Shared acting gate — one enable/kill control governs both acting channels
	// (samantha connector + XBP lifecycle capabilities), per spec decision 5.
	const isActingEnabled = () =>
		pluginConfig.get("samantha").behavior?.actingEnabled ?? false;

	const xbpSessionReport = createSessionReportProvider({
		getIdentities: getSamanthaIdentities,
		getReviewCount,
		getWhisperStates,
		getSessionSlice: () => samanthaSliceSource.get(),
	});

	const samanthaDriver = createSamanthaDriver({
		client: createSamanthaConnectorClient({}),
		getIdentities: getSamanthaIdentities,
		getReviewCount,
		getWhisperStates,
		sliceSource: samanthaSliceSource,
		subscribeReviews: (cb) => reviewCommentService.onChange(() => cb()),
		subscribeWorktrees: (cb) => workspaceRegistry.onChange(cb),
		pushHealth: (health) =>
			pushSamanthaHealth(() => mainWindow.webContents, health),
		focusWorktree: samanthaFocusWorktree,
		webSocketImpl: globalThis.WebSocket as unknown as WebSocketCtor,
		log: (message, error) => console.error(message, error),
		isActingEnabled,
		verifyActingToken: (token) => actingTokenVerifier.verify(token),
		auditAct: (entry) => actingAuditLogger.append(entry),
		runManagedInstruction: async (worktreeId, decision) => {
			const ref = await resolveWorktreeRef(worktreeId);
			if (ref === null) return { ok: false, detail: "worktree not resolved" };
			const command: WhisperCommand =
				decision.kind === "collab-tell"
					? {
							kind: "collab-tell",
							workspaceId: ref.workspaceId,
							worktreeId,
							target: decision.target,
							instruction: decision.instruction,
						}
					: {
							kind: "workflow-resume",
							workspaceId: ref.workspaceId,
							worktreeId,
							workflowId: decision.workflowId,
							message: decision.message,
						};
			const r = await whisperCommandRunner.run(command, ref.cwd);
			return {
				ok: r.ok,
				detail: r.ok
					? "delivered"
					: r.stderr.slice(0, 200) || `exit ${r.exitCode}`,
			};
		},
		sendUnmanagedInput: (sessionId, data) => {
			if (actingSendInput === null)
				return { ok: false, detail: "terminal service not ready" };
			try {
				// The session in the slice snapshot may have closed before dispatch;
				// TerminalService.sendInput throws on an unknown session. Honor the
				// {ok,detail} contract so ActGuard records a result audit, not a throw.
				actingSendInput(sessionId, data.endsWith("\n") ? data : `${data}\n`);
			} catch (error) {
				return {
					ok: false,
					detail: error instanceof Error ? error.message : "send failed",
				};
			}
			return { ok: true, detail: "sent" };
		},
	});

	const xbpActingExecutor = createXbpActingExecutor({
		isActingEnabled,
		resolveWorkflow: createWorkflowResolver({
			getWhisperStates,
			resolveWorktreeRef,
		}),
		runWhisperCommand: (command, cwd) => whisperCommandRunner.run(command, cwd),
		auditAct: (entry) => actingAuditLogger.append(entry),
	});

	// Spec §1: the XBP host service starts BEFORE the plugin registry boots, so a
	// phone that connects during early startup finds the bridge already live. All
	// mainWindow/webContents references below are lazy + null-safe so this block is
	// safe to run regardless of when the window is created.
	const { settings: persistedSettings } = settingsService.readStateSync();
	const xbpDir = join(app.getPath("userData"), "ai-14all", "xbp");

	// --- Arc B push-wake: token store, handlers, watcher (spec Deliverables 1-5)
	const pushTokenStore = new XbpPushTokenStore({
		dir: xbpDir,
		secureStorage: safeStorage,
	});
	// readStateSync per call: register/deregister and a 3 s tick — negligible
	// I/O, and it picks up settings edits without extra plumbing.
	const isPushWakeOn = () =>
		isPushWakeEnabled(settingsService.readStateSync().settings);
	const pushTokenHandlers = createPushTokenHandlers({
		isPushWakeEnabled: isPushWakeOn,
		store: pushTokenStore,
	});

	let xbpService: XbpHostService | null = null;
	xbpService = await createXbpHostIfEnabled({
		enabled: isPhoneBridgeEnabled(persistedSettings),
		options: {
			dir: xbpDir,
			secureStorage: safeStorage,
			getSessionReport: xbpSessionReport,
			acting: xbpActingExecutor,
			pushTokenStore,
			pushTokenHandlers,
			ptyInspect: ptyInspectService,
			initialRelayBaseUrl: persistedSettings.phoneBridge.relayBaseUrl,
			subscribeChanges: (cb) => {
				const offReviews = reviewCommentService.onChange(() => cb());
				const offWorktrees = workspaceRegistry.onChange(cb);
				const offSlice = samanthaSliceSource.subscribe(cb);
				return () => {
					offReviews();
					offWorktrees();
					offSlice();
				};
			},
			onStatusChange: () =>
				mainWindow?.webContents?.send(
					PHONE_BRIDGE_STATUS_CHANGED,
					xbpService?.getStatus(),
				),
		},
		onStartError: (err) =>
			console.error("[xbp] failed to start host service", err),
	});

	const xbpIpc = registerXbpIpc({
		ipcMain,
		getService: () => xbpService,
		getWebContents: () => mainWindow?.webContents,
	});

	const pushWakeAudit = new PushWakeAuditLogger({
		logsDir: join(app.getPath("userData"), "logs"),
	});
	const pushWakeWatcher = createPushWakeWatcher({
		getStates: getWhisperStates,
		stateStore: new PushWakeStateStore({ dir: xbpDir }),
		isEnabled: () =>
			(xbpService?.getStatus().enabled ?? false) && isPushWakeOn(),
		hasToken: () => pushTokenStore.exists(),
		send: createPushWakeSender({
			loadToken: () => {
				try {
					return pushTokenStore.load()?.expoPushToken ?? null;
				} catch {
					return null; // safeStorage unavailable → behave as no token
				}
			},
			clearToken: () => pushTokenStore.clear(),
		}).send,
		audit: (entry) => pushWakeAudit.append(entry),
	});
	pushWakeWatcher.start();

	const pluginRegistry = createPluginRegistry(
		[whisperDriver, cortexDriver, samanthaDriver],
		pluginConfig,
		{
			// ai-whisper's `collab mount` (and other flows) shell out to the POSIX
			// `tty` binary, which doesn't exist on Windows — it hard-crashes there.
			// Gate the whole plugin off on win32 until that's fixed upstream so it
			// can't be enabled and the launcher never issues `whisper collab mount`.
			// See docs/windows-known-issues.md #1.
			unsupported:
				process.platform === "win32"
					? { whisper: "not supported on Windows yet" }
					: undefined,
			// Samantha is an unreleased integration. Keep it out of the Plugins
			// panel in packaged/release builds so it can't be seen or enabled,
			// while staying visible in dev/unpackaged builds so we can build and
			// test it. Remove this gate when Samantha ships.
			hidden: app.isPackaged ? ["samantha"] : [],
		},
	);
	void pluginRegistry.boot();
	const pluginIpc = registerPluginIpc({
		ipcMain,
		registry: pluginRegistry,
		config: pluginConfig,
		// Privileged IPC Trust Boundary: ids in, path resolved here. Both
		// resolvers throw on unknown ids; the rejection propagates to the
		// renderer (no `if (!x)` checks, per AGENTS.md).
		resolveWorktreeCwd: async (workspaceId, worktreeId) => {
			const repository = workspaceRegistry.get(workspaceId);
			const worktree = await worktreeService.findWorktree(
				repository,
				worktreeId,
			);
			return worktree.path;
		},
		runWhisperCommand: (cmd, cwd) => whisperCommandRunner.run(cmd, cwd),
		probes: {
			agentClis: () => capabilityProbes.probeAgentClis(),
			invalidate: () => capabilityProbes.invalidate(),
		},
		getWebContents: () => mainWindow.webContents,
		ingestSamanthaSessionSlice: (slice) =>
			samanthaDriver.ingestSessionSlice(slice),
		reconnectSamantha: () => samanthaDriver.reconnectNow(),
	});

	// Re-probe triggers (spec §3.4) funnel through capabilityProbes.invalidate():
	// app start (boot() above, cold cache) and window focus. Panel open and
	// toggle flip already invalidate inside the IPC handlers.
	let lastFocusReprobe = 0;
	mainWindow.on("focus", () => {
		const now = Date.now();
		if (now - lastFocusReprobe < 30_000) return;
		lastFocusReprobe = now;
		capabilityProbes.invalidate();
		void pluginRegistry.reprobe();
	});

	// Resize-on-watch §4 "the desktop blurs": an OS-level window deactivation
	// (e.g. cmd-tabbing away) must re-assert a reclaimed phone watch just like
	// the element-level blur wired in ipc.ts (terminals:notifyBlur). windows.ts
	// already logs a "blur" event for shellEventLog but doesn't have
	// ptyInspectService in scope; registering a second listener here — where
	// both mainWindow and ptyInspectService already are — is simpler than
	// threading it through. notifyAppBlur() is a no-op unless a watch is
	// currently reclaimed by the desktop.
	mainWindow.on("blur", () => {
		ptyInspectService.registry.notifyAppBlur();
	});

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
	const agentResumeBridge = new AgentResumeBridge(() => mainWindow.webContents);

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
			agentResumeBridge,
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

	// Set once a real quit is underway so hide-on-close and the close-gate can
	// tell "user pressed the red X" (hide) apart from "user is quitting" (destroy).
	let isQuitting = false;

	const closeGate = createCloseGate();
	closeGate.attach(mainWindow, { isQuitting: () => isQuitting });
	const { dispose, terminalService } = registerIpcHandlers(mainWindow, {
		workspacePersistence,
		settingsService,
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
		usageSettingsBridge: usageSettings,
		getPhoneBridgeApplier: () => xbpService,
		installUpdate: () => updateService.installUpdate(),
		closeGate,
		getCortexEnabled: () => pluginConfig.get("cortex").enabled,
		ptyInspect: ptyInspectService,
	});
	actingSendInput = (sessionId, data) =>
		terminalService.sendInput(sessionId, data);

	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(
			fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
		);
	}
	app.on("before-quit", () => {
		isQuitting = true;
		updateService.dispose();
		offRegistry();
		void deleteLivenessFile(livenessPath);
		void mcpServer?.stop().catch(() => {});
		void xbpService?.stop().catch(() => {});
		pushWakeWatcher.stop();
		sessionNoteBridge.dispose();
		agentAttentionBridge.dispose();
		agentResumeBridge.dispose();
		usageHost.stop();
		pluginIpc.dispose();
		xbpIpc.dispose();
		void pluginRegistry.stopAll();
		pluginConfig.dispose();
	});

	registerAppLifecycle({
		onMainWindowClosed: (listener) => mainWindow.on("closed", listener),
		onWillQuit: (listener) => app.on("will-quit", listener),
		onWindowAllClosed: (listener) => app.on("window-all-closed", listener),
		quit: () => app.quit(),
		dispose,
	});

	registerHideOnClose({
		onClose: (listener) => mainWindow.on("close", listener),
		onActivate: (listener) => app.on("activate", listener),
		isQuitting: () => isQuitting,
		hide: () => mainWindow.hide(),
		show: () => {
			mainWindow.show();
			mainWindow.focus();
		},
		isDestroyed: () => mainWindow.isDestroyed(),
	});
});
