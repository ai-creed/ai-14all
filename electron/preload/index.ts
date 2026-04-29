import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
	Ai14AllDesktopApi,
	UpdateInfo,
} from "../../shared/contracts/commands.js";
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
// Channel name constants duplicated from shared/contracts to avoid pulling Zod
// into the sandboxed preload context (sandbox:true blocks require("zod")).
const REVIEW_LIST = "reviewComments:list";
const REVIEW_CREATE = "reviewComments:create";
const REVIEW_MARK_ADDRESSED = "reviewComments:markAddressed";
const REVIEW_REOPEN = "reviewComments:reopen";
const REVIEW_DELETE = "reviewComments:delete";
const REVIEW_REBASE = "reviewComments:rebaseWorktreeIds";
const REVIEW_COMMENT_CHANGED = "reviewComments:changed";
const AGENT_INSTALL_LIST = "agentInstall:listProviders";
const AGENT_INSTALL_DO = "agentInstall:install";
const AGENT_INSTALL_UNINSTALL = "agentInstall:uninstall";
const AGENT_INSTALL_PICK_CLI = "agentInstall:pickCliPath";
const AGENT_INSTALL_SET_OVERRIDE = "agentInstall:setCliOverride";
const NOTE_BRIDGE_REQUEST = "mcp:note:request";
const NOTE_BRIDGE_REPLY = "mcp:note:reply";
const NOTE_BRIDGE_READY = "mcp:note:ready";
const NOTE_BRIDGE_GOODBYE = "mcp:note:goodbye";

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
for (const channel of ["update:available"] as const) {
	const handler = (_: Electron.IpcRendererEvent, payload: unknown) => {
		pendingEvents[channel] = payload;
		delete pendingOnceRemovers[channel];
	};
	ipcRenderer.once(channel, handler);
	pendingOnceRemovers[channel] = () =>
		ipcRenderer.removeListener(channel, handler);
}

const api: Ai14AllDesktopApi = {
	repository: {
		pickRoot() {
			return ipcRenderer.invoke("repository:pickRoot", {});
		},
		listWorktrees(workspaceId) {
			return ipcRenderer.invoke("repository:listWorktrees", { workspaceId });
		},
		previewCreateWorktree(workspaceId, name) {
			return ipcRenderer.invoke("repository:previewCreateWorktree", {
				workspaceId,
				name,
			});
		},
		createWorktree(workspaceId, name) {
			return ipcRenderer.invoke("repository:createWorktree", {
				workspaceId,
				name,
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
		listTracked(workspaceId, worktreeId) {
			return ipcRenderer.invoke("files:listTracked", {
				workspaceId,
				worktreeId,
			});
		},
		read(worktreePath, relativePath) {
			return ipcRenderer.invoke("files:read", { worktreePath, relativePath });
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
		readDiff(worktreePath, relativePath) {
			return ipcRenderer.invoke("git:readDiff", { worktreePath, relativePath });
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
		readCommitDetail(worktreePath, sha) {
			return ipcRenderer.invoke("git:readCommitDetail", { worktreePath, sha });
		},
		discardChange(worktreePath, relativePath) {
			return ipcRenderer.invoke("git:discardChange", {
				worktreePath,
				relativePath,
			});
		},
		getRemoteStatus(workspaceId, worktreeId) {
			return ipcRenderer.invoke("git:getRemoteStatus", {
				workspaceId,
				worktreeId,
			});
		},
		pushBranch(worktreePath, force) {
			return ipcRenderer.invoke("git:pushBranch", { worktreePath, force });
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
	diagnostics: {
		logShellEvent(event) {
			return ipcRenderer.invoke("diagnostics:logShellEvent", event);
		},
	},
	system: {
		onUpdateAvailable(listener) {
			return onChannelBuffered<UpdateInfo>("update:available", listener);
		},
		openExternal(url) {
			return ipcRenderer.invoke("system:openExternal", { url });
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
	events: {
		onOpenInstallModal(handler: () => void) {
			return onChannel("review:openInstallModal", handler);
		},
	},
};

contextBridge.exposeInMainWorld("ai14all", api);
