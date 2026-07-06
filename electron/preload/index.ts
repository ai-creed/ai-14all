import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
	Ai14AllDesktopApi,
	UpdateInfo,
} from "../../shared/contracts/commands.js";
import type { UsageSnapshot } from "../../shared/models/usage.js";
import type { PersistedSettingsV1 } from "../../shared/models/persisted-settings.js";
import type {
	TerminalOutputEvent,
	TerminalExitEvent,
	TerminalStateEvent,
	TerminalErrorEvent,
	ReviewCommentChangedEvent,
} from "../../shared/contracts/events.js";
import type {
	NoteBridgeReply,
	NoteBridgeRequest,
} from "../../shared/contracts/note-bridge.js";
import type {
	AgentAttentionBridgeReply,
	AgentAttentionBridgeRequest,
} from "../../shared/contracts/agent-attention-bridge.js";
import {
	AGENT_ATTENTION_BRIDGE_READY,
	AGENT_ATTENTION_BRIDGE_GOODBYE,
	AGENT_ATTENTION_BRIDGE_REQUEST,
	AGENT_ATTENTION_BRIDGE_REPLY,
} from "../../shared/contracts/agent-attention-bridge.js";
import type {
	AgentResumeBridgeReply,
	AgentResumeBridgeRequest,
} from "../../shared/contracts/agent-resume-bridge.js";
import {
	AGENT_RESUME_BRIDGE_READY,
	AGENT_RESUME_BRIDGE_GOODBYE,
	AGENT_RESUME_BRIDGE_REQUEST,
	AGENT_RESUME_BRIDGE_REPLY,
} from "../../shared/contracts/agent-resume-bridge.js";
// Channel name constants duplicated from shared/contracts to avoid pulling Zod
// into the sandboxed preload context (sandbox:true blocks require("zod")).
const REVIEW_LIST = "reviewComments:list";
const REVIEW_CREATE = "reviewComments:create";
const REVIEW_MARK_ADDRESSED = "reviewComments:markAddressed";
const REVIEW_REOPEN = "reviewComments:reopen";
const REVIEW_DELETE = "reviewComments:delete";
const REVIEW_REBASE = "reviewComments:rebaseWorktreeIds";
const REVIEW_COMMENT_CHANGED = "reviewComments:changed";
const REVIEW_UPDATE = "reviewComments:update";
const REVIEW_BULK_REMOVE_ADDRESSED = "reviewComments:bulkRemoveAddressed";
const AGENT_INSTALL_LIST = "agentInstall:listProviders";
const AGENT_INSTALL_DO = "agentInstall:install";
const AGENT_INSTALL_UNINSTALL = "agentInstall:uninstall";
const AGENT_INSTALL_PICK_CLI = "agentInstall:pickCliPath";
const AGENT_INSTALL_SET_OVERRIDE = "agentInstall:setCliOverride";
const NOTE_BRIDGE_REQUEST = "mcp:note:request";
const NOTE_BRIDGE_REPLY = "mcp:note:reply";
const NOTE_BRIDGE_READY = "mcp:note:ready";
const NOTE_BRIDGE_GOODBYE = "mcp:note:goodbye";
const DIAGNOSTICS_ATTENTION_EVENT = "diagnostics:attention-event";
const SETTINGS_READ_SYNC = "settings:readSync";
const SETTINGS_READ = "settings:read";
const SETTINGS_WRITE = "settings:write";
const SETTINGS_CHANGED = "settings:changed";
// plugins channel constants (duplicated to keep Zod out of the sandboxed preload)
const PLUGINS_LIST = "plugins:list";
const PLUGINS_SET_ENABLED = "plugins:setEnabled";
const PLUGINS_REPROBE = "plugins:reprobe";
const PLUGINS_AGENT_CLIS = "plugins:agentClis";
const PLUGINS_WHISPER_COMMAND = "plugins:whisperCommand";
const PLUGINS_STATE_CHANGED = "plugins:stateChanged";
const PLUGINS_WHISPER_STATE_CHANGED = "plugins:whisperStateChanged";
const PLUGINS_SAMANTHA_SESSION_STATE = "plugins:samanthaSessionState";
const PLUGINS_SAMANTHA_HEALTH = "plugins:samanthaHealth";
const PLUGINS_SAMANTHA_FOCUS_WORKTREE = "plugins:samanthaFocusWorktree";
const PLUGINS_SAMANTHA_RECONNECT = "plugins:samanthaReconnect";
// phoneBridge channel constants (duplicated to keep Zod out of the sandboxed preload)
const PHONE_BRIDGE_STATUS = "phoneBridge:status";
const PHONE_BRIDGE_SET_ENABLED = "phoneBridge:setEnabled";
const PHONE_BRIDGE_START_PAIRING = "phoneBridge:startPairing";
const PHONE_BRIDGE_CONFIRM_SAS = "phoneBridge:confirmSas";
const PHONE_BRIDGE_STATUS_CHANGED = "phoneBridge:statusChanged";

// Helper: register a one-way listener on an ipcRenderer channel and return an
// unsubscribe function (matching the onXxx pattern in the API type).
function onChannel<T>(
	channel: string,
	listener: (event: T) => void,
): () => void {
	const handler = (_: Electron.IpcRendererEvent, payload: T) =>
		listener(payload);
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
}

// Buffered variant: captures up to one event before the renderer registers its
// listener, then replays it immediately on registration. Used for fire-once
// events like update:available that may arrive during app startup before React
// has mounted and called useEffect.
function onChannelBuffered<T>(
	channel: string,
	listener: (event: T) => void,
): () => void {
	// Cancel the pre-capture once-handler — live listener takes over from here.
	pendingOnceRemovers[channel]?.();
	delete pendingOnceRemovers[channel];
	const buf = pendingEvents[channel] as T | undefined;
	if (buf !== undefined) {
		// Already received before listener registered — replay on next microtask.
		delete pendingEvents[channel];
		queueMicrotask(() => listener(buf));
	}
	return onChannel(channel, listener);
}

// Eagerly capture events that may arrive before React mounts.
// When onChannelBuffered registers a live listener, the once-handler is replaced
// and any pending entry is drained — preventing a stale buffer leak.
const pendingEvents: Record<string, unknown> = {};
const pendingOnceRemovers: Record<string, () => void> = {};
for (const channel of [
	"update:available",
	"update:downloaded",
	"usage:snapshot",
] as const) {
	const handler = (_: Electron.IpcRendererEvent, payload: unknown) => {
		pendingEvents[channel] = payload;
		delete pendingOnceRemovers[channel];
	};
	ipcRenderer.once(channel, handler);
	pendingOnceRemovers[channel] = () =>
		ipcRenderer.removeListener(channel, handler);
}

// Synchronous initial read so settings.initial/initialFirstRun are available
// before first paint (no async round-trip is possible this early). The main
// handler registers this before the first window loads.
//
// This sendSync call is the ONLY point in the app that can ever observe
// firstRun: true: SettingsService.readStateSync() seeds the settings file as
// a side effect of this very call, so any later async settings:read() always
// sees firstRun: false. initialFirstRun therefore must be captured here, not
// re-derived from settings.read() in the renderer.
const initialSettingsResult = ipcRenderer.sendSync(SETTINGS_READ_SYNC) as {
	settings: PersistedSettingsV1;
	firstRun: boolean;
} | null;
const initialSettings = initialSettingsResult?.settings as PersistedSettingsV1;
const initialSettingsFirstRun = initialSettingsResult?.firstRun ?? false;

const api: Ai14AllDesktopApi = {
	repository: {
		pickRoot() {
			return ipcRenderer.invoke("repository:pickRoot", {});
		},
		listWorktrees(workspaceId) {
			return ipcRenderer.invoke("repository:listWorktrees", { workspaceId });
		},
		previewCreateWorktree(workspaceId, name, baseBranch) {
			return ipcRenderer.invoke("repository:previewCreateWorktree", {
				workspaceId,
				name,
				baseBranch,
			});
		},
		createWorktree(workspaceId, name, baseBranch) {
			return ipcRenderer.invoke("repository:createWorktree", {
				workspaceId,
				name,
				baseBranch,
			});
		},
		previewRemoveWorktree(workspaceId, worktreeId) {
			return ipcRenderer.invoke("repository:previewRemoveWorktree", {
				workspaceId,
				worktreeId,
			});
		},
		removeWorktree(workspaceId, worktreeId) {
			return ipcRenderer.invoke("repository:removeWorktree", {
				workspaceId,
				worktreeId,
			});
		},
		listRemoteBranches(workspaceId) {
			return ipcRenderer.invoke("repository:listRemoteBranches", {
				workspaceId,
			});
		},
		refreshRemote(workspaceId) {
			return ipcRenderer.invoke("repository:refreshRemote", { workspaceId });
		},
	},
	terminals: {
		create(workspaceId, worktreeId, cwd) {
			return ipcRenderer.invoke("terminals:create", {
				workspaceId,
				worktreeId,
				cwd,
			});
		},
		list(workspaceId) {
			return ipcRenderer.invoke("terminals:list", { workspaceId });
		},
		sendInput(sessionId, data) {
			return ipcRenderer.invoke("terminals:sendInput", { sessionId, data });
		},
		resize(sessionId, cols, rows) {
			return ipcRenderer.invoke("terminals:resize", { sessionId, cols, rows });
		},
		stop(sessionId) {
			return ipcRenderer.invoke("terminals:stop", { sessionId });
		},
		onOutput(listener: (event: TerminalOutputEvent) => void) {
			return onChannel("terminal/output", listener);
		},
		onExit(listener: (event: TerminalExitEvent) => void) {
			return onChannel("terminal/exit", listener);
		},
		onState(listener: (event: TerminalStateEvent) => void) {
			return onChannel("terminal/state", listener);
		},
		onError(listener: (event: TerminalErrorEvent) => void) {
			return onChannel("terminal/error", listener);
		},
	},
	files: {
		list(workspaceId, worktreeId) {
			return ipcRenderer.invoke("files:list", { workspaceId, worktreeId });
		},
		listScoped(workspaceId, worktreeId, relativeRoots) {
			return ipcRenderer.invoke("files:listScoped", {
				workspaceId,
				worktreeId,
				relativeRoots,
			});
		},
		listWorktree(workspaceId, worktreeId, opts) {
			return ipcRenderer.invoke("files:listWorktree", {
				workspaceId,
				worktreeId,
				includeIgnored: opts.includeIgnored,
			});
		},
		read(workspaceId, worktreeId, relativePath) {
			return ipcRenderer.invoke("files:read", {
				workspaceId,
				worktreeId,
				relativePath,
			});
		},
		openForEdit(workspaceId, worktreeId, relativePath) {
			return ipcRenderer.invoke("files:openForEdit", {
				workspaceId,
				worktreeId,
				relativePath,
			});
		},
		save(args) {
			return ipcRenderer.invoke("files:save", args);
		},
		getPathForFile(file) {
			return webUtils.getPathForFile(file);
		},
	},
	git: {
		listChanges(workspaceId, worktreeId) {
			return ipcRenderer.invoke("git:listChanges", { workspaceId, worktreeId });
		},
		readDiff(workspaceId, worktreeId, relativePath) {
			return ipcRenderer.invoke("git:readDiff", {
				workspaceId,
				worktreeId,
				relativePath,
			});
		},
		readSummary(workspaceId, worktreeId) {
			return ipcRenderer.invoke("git:readSummary", {
				workspaceId,
				worktreeId,
			});
		},
		readCommitHistory(workspaceId, worktreeId) {
			return ipcRenderer.invoke("git:readCommitHistory", {
				workspaceId,
				worktreeId,
			});
		},
		readCommitDetail(workspaceId, worktreeId, sha) {
			return ipcRenderer.invoke("git:readCommitDetail", {
				workspaceId,
				worktreeId,
				sha,
			});
		},
		readCommitFileDiff(workspaceId, worktreeId, sha, file) {
			return ipcRenderer.invoke("git:readCommitFileDiff", {
				workspaceId,
				worktreeId,
				sha,
				file,
			});
		},
		discardChange(workspaceId, worktreeId, relativePath) {
			return ipcRenderer.invoke("git:discardChange", {
				workspaceId,
				worktreeId,
				relativePath,
			});
		},
		getRemoteStatus(workspaceId, worktreeId) {
			return ipcRenderer.invoke("git:getRemoteStatus", {
				workspaceId,
				worktreeId,
			});
		},
		pushBranch(workspaceId, worktreeId, force) {
			return ipcRenderer.invoke("git:pushBranch", {
				workspaceId,
				worktreeId,
				force,
			});
		},
	},
	workspace: {
		openRepository(path) {
			return ipcRenderer.invoke("workspace:openRepository", { path });
		},
		readRestoreState() {
			return ipcRenderer.invoke("workspace:readRestoreState", {});
		},
		writeRestoreState(state) {
			return ipcRenderer.invoke("workspace:writeRestoreState", { state });
		},
		onOpenPicker(listener) {
			return onChannel("workspace/openPicker", listener);
		},
	},
	settings: {
		initial: initialSettings,
		initialFirstRun: initialSettingsFirstRun,
		read() {
			return ipcRenderer.invoke(SETTINGS_READ);
		},
		write(patch) {
			return ipcRenderer.invoke(SETTINGS_WRITE, { patch });
		},
	},
	diagnostics: {
		logShellEvent(event) {
			return ipcRenderer.invoke("diagnostics:logShellEvent", event);
		},
		logAttentionEvent(event) {
			// One-way fire-and-forget: never block the renderer hot path on disk.
			// Channel string duplicated from shared/contracts (DIAGNOSTICS_ATTENTION_EVENT)
			// to avoid pulling Zod into the sandboxed preload context.
			ipcRenderer.send(DIAGNOSTICS_ATTENTION_EVENT, event);
		},
		getAgentAttentionStatus() {
			return ipcRenderer.invoke("diagnostics:getAgentAttentionStatus", {});
		},
	},
	system: {
		onUpdateAvailable(listener) {
			return onChannelBuffered<UpdateInfo>("update:available", listener);
		},
		onUpdateDownloaded(listener) {
			return onChannelBuffered<UpdateInfo>("update:downloaded", listener);
		},
		onUpdateError(listener) {
			return onChannel<string>("update:error", listener);
		},
		installUpdate() {
			return ipcRenderer.invoke("update:install");
		},
		openExternal(url) {
			return ipcRenderer.invoke("system:openExternal", { url });
		},
	},
	usage: {
		onSnapshot(listener) {
			return onChannelBuffered<UsageSnapshot>("usage:snapshot", listener);
		},
		setEnabled(enabled) {
			return ipcRenderer.invoke("usage:setEnabled", enabled);
		},
		setIncludeUntracked(includeUntracked) {
			return ipcRenderer.invoke("usage:setIncludeUntracked", includeUntracked);
		},
		setChipRange(range) {
			return ipcRenderer.invoke("usage:setChipRange", range);
		},
	},
	reviewComments: {
		list(worktreeId) {
			return ipcRenderer.invoke(REVIEW_LIST, { worktreeId });
		},
		create(input) {
			return ipcRenderer.invoke(REVIEW_CREATE, input);
		},
		markAddressed(commentId) {
			return ipcRenderer.invoke(REVIEW_MARK_ADDRESSED, { commentId });
		},
		reopen(commentId) {
			return ipcRenderer.invoke(REVIEW_REOPEN, { commentId });
		},
		delete(commentId) {
			return ipcRenderer.invoke(REVIEW_DELETE, { commentId });
		},
		update(commentId: string, body: string) {
			return ipcRenderer.invoke(REVIEW_UPDATE, { commentId, body });
		},
		bulkRemoveAddressed(worktreeId: string, ids: string[]) {
			return ipcRenderer.invoke(REVIEW_BULK_REMOVE_ADDRESSED, {
				worktreeId,
				ids,
			});
		},
		rebaseWorktreeIds(mapping) {
			return ipcRenderer.invoke(REVIEW_REBASE, { mapping });
		},
		onChanged(handler: (event: ReviewCommentChangedEvent) => void) {
			return onChannel(REVIEW_COMMENT_CHANGED, handler);
		},
	},
	agentInstall: {
		listProviders() {
			return ipcRenderer.invoke(AGENT_INSTALL_LIST, {});
		},
		install(ids: ("claude-code" | "codex")[]) {
			return ipcRenderer.invoke(AGENT_INSTALL_DO, { providerIds: ids });
		},
		uninstall(ids: ("claude-code" | "codex")[]) {
			return ipcRenderer.invoke(AGENT_INSTALL_UNINSTALL, { providerIds: ids });
		},
		pickCliPath(id: "claude-code" | "codex") {
			return ipcRenderer.invoke(AGENT_INSTALL_PICK_CLI, { providerId: id });
		},
		setCliOverride(id: "claude-code" | "codex", path: string | null) {
			return ipcRenderer.invoke(AGENT_INSTALL_SET_OVERRIDE, {
				providerId: id,
				path,
			});
		},
	},
	noteBridge: {
		onRequest(handler: (req: NoteBridgeRequest) => void) {
			return onChannel(NOTE_BRIDGE_REQUEST, handler);
		},
		sendReply(reply: NoteBridgeReply) {
			ipcRenderer.send(NOTE_BRIDGE_REPLY, reply);
		},
		sendReady() {
			ipcRenderer.send(NOTE_BRIDGE_READY);
		},
		sendGoodbye() {
			ipcRenderer.send(NOTE_BRIDGE_GOODBYE);
		},
	},
	agentAttentionBridge: {
		onRequest(handler: (req: AgentAttentionBridgeRequest) => void) {
			return onChannel(AGENT_ATTENTION_BRIDGE_REQUEST, handler);
		},
		sendReply(reply: AgentAttentionBridgeReply) {
			ipcRenderer.send(AGENT_ATTENTION_BRIDGE_REPLY, reply);
		},
		sendReady() {
			ipcRenderer.send(AGENT_ATTENTION_BRIDGE_READY);
		},
		sendGoodbye() {
			ipcRenderer.send(AGENT_ATTENTION_BRIDGE_GOODBYE);
		},
	},
	plugins: {
		list: () => ipcRenderer.invoke(PLUGINS_LIST),
		setEnabled: (id, enabled) =>
			ipcRenderer.invoke(PLUGINS_SET_ENABLED, { id, enabled }),
		reprobe: () => ipcRenderer.invoke(PLUGINS_REPROBE),
		agentClis: () => ipcRenderer.invoke(PLUGINS_AGENT_CLIS),
		runWhisperCommand: (command) =>
			ipcRenderer.invoke(PLUGINS_WHISPER_COMMAND, command),
		onStateChanged: (handler) => onChannel(PLUGINS_STATE_CHANGED, handler),
		onWhisperStateChanged: (handler) =>
			onChannel(PLUGINS_WHISPER_STATE_CHANGED, handler),
		publishSamanthaSessionState: (slice) =>
			ipcRenderer.send(PLUGINS_SAMANTHA_SESSION_STATE, slice),
		onSamanthaHealth: (handler) => onChannel(PLUGINS_SAMANTHA_HEALTH, handler),
		onSamanthaFocusWorktree: (handler) =>
			onChannel(PLUGINS_SAMANTHA_FOCUS_WORKTREE, handler),
		reconnectSamantha: () => ipcRenderer.invoke(PLUGINS_SAMANTHA_RECONNECT),
	},
	phoneBridge: {
		status: () => ipcRenderer.invoke(PHONE_BRIDGE_STATUS),
		setEnabled: (enabled: boolean) =>
			ipcRenderer.invoke(PHONE_BRIDGE_SET_ENABLED, { enabled }),
		startPairing: () => ipcRenderer.invoke(PHONE_BRIDGE_START_PAIRING),
		confirmSas: (ok: boolean) =>
			ipcRenderer.invoke(PHONE_BRIDGE_CONFIRM_SAS, { ok }),
		onStatusChanged: (handler) =>
			onChannel(PHONE_BRIDGE_STATUS_CHANGED, handler),
	},
	events: {
		onOpenInstallModal(handler: () => void) {
			return onChannel("review:openInstallModal", handler);
		},
		onSetTheme(handler) {
			return onChannel("theme/set", handler);
		},
		onAdjustTerminalFontSize(handler) {
			return onChannel("terminal/fontSize", handler);
		},
		onShowWelcomeTour(handler) {
			return onChannel("help/showWelcomeTour", handler);
		},
		onResetOnboardingHints(handler) {
			return onChannel("help/resetOnboardingHints", handler);
		},
		onSettingsChanged(cb) {
			return onChannel<PersistedSettingsV1>(SETTINGS_CHANGED, cb);
		},
		onAgentResumeRequest(handler: (req: AgentResumeBridgeRequest) => void) {
			return onChannel(AGENT_RESUME_BRIDGE_REQUEST, handler);
		},
		sendAgentResumeReply(reply: AgentResumeBridgeReply) {
			ipcRenderer.send(AGENT_RESUME_BRIDGE_REPLY, reply);
		},
		sendAgentResumeReady() {
			ipcRenderer.send(AGENT_RESUME_BRIDGE_READY);
		},
		sendAgentResumeGoodbye() {
			ipcRenderer.send(AGENT_RESUME_BRIDGE_GOODBYE);
		},
	},
	app: {
		setEditorDirty(args) {
			ipcRenderer.send("app:setEditorDirty", args);
		},
		confirmClose(args) {
			ipcRenderer.send("app:confirmClose", args);
		},
		onRequestClose(handler) {
			return onChannel("app:requestClose", handler);
		},
	},
	codeNav: {
		findDefinitions(args) {
			return ipcRenderer.invoke("code-nav:findDefinitions", args);
		},
		findCallees(args) {
			return ipcRenderer.invoke("code-nav:findCallees", args);
		},
		findCallers(args) {
			return ipcRenderer.invoke("code-nav:findCallers", args);
		},
		searchSymbols(args) {
			return ipcRenderer.invoke("code-nav:searchSymbols", args);
		},
		getFileImports(args) {
			return ipcRenderer.invoke("code-nav:getFileImports", args);
		},
		getWorktreeStatus(args) {
			return ipcRenderer.invoke("code-nav:getWorktreeStatus", args);
		},
		listFiles(args) {
			return ipcRenderer.invoke("code-nav:listFiles", args);
		},
		refreshWorktree(args) {
			return ipcRenderer.invoke("code-nav:refreshWorktree", args);
		},
		watchWorktree(args) {
			return ipcRenderer.invoke("code-nav:watchWorktree", args);
		},
		unwatchWorktree(args) {
			return ipcRenderer.invoke("code-nav:unwatchWorktree", args);
		},
		onWorktreeIndexRefreshed(handler) {
			return onChannel("code-nav:worktreeIndexRefreshed", handler);
		},
		onWorktreeUnavailable(handler) {
			return onChannel("code-nav:worktreeUnavailable", handler);
		},
		onAvailabilityChanged(handler) {
			return onChannel("code-nav:availabilityChanged", handler);
		},
	},
};

contextBridge.exposeInMainWorld("ai14all", api);

// E2E-only test helper: invoke the e2e ingest IPC directly. Gated behind env
// so the channel only exists in test builds; harmless otherwise.
if (process.env.AI14ALL_E2E) {
	contextBridge.exposeInMainWorld(
		"__codeNavE2eIngest",
		(args: { jsonPath: string; dbPath: string }) =>
			ipcRenderer.invoke("code-nav:e2eIngest", args),
	);
	// First-launch onboarding is suppressed in E2E by default so its overlay and
	// coachmarks never cover unrelated e2e flows (which all start from a fresh
	// profile and load a repo). A spec that exercises onboarding opts in with
	// AI14ALL_E2E_ONBOARDING=1.
	contextBridge.exposeInMainWorld(
		"__ai14allSuppressOnboarding",
		process.env.AI14ALL_E2E_ONBOARDING !== "1",
	);
}
