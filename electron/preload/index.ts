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
} from "../../shared/contracts/events.js";

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
		list(worktreePath) {
			return ipcRenderer.invoke("files:list", { worktreePath });
		},
		listScoped(worktreePath, relativeRoots) {
			return ipcRenderer.invoke("files:listScoped", {
				worktreePath,
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
		listChanges(worktreePath) {
			return ipcRenderer.invoke("git:listChanges", { worktreePath });
		},
		readDiff(worktreePath, relativePath) {
			return ipcRenderer.invoke("git:readDiff", { worktreePath, relativePath });
		},
		readSummary(worktreePath) {
			return ipcRenderer.invoke("git:readSummary", { worktreePath });
		},
		readCommitHistory(worktreePath) {
			return ipcRenderer.invoke("git:readCommitHistory", { worktreePath });
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
		getRemoteStatus(worktreePath) {
			return ipcRenderer.invoke("git:getRemoteStatus", { worktreePath });
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
};

contextBridge.exposeInMainWorld("ai14all", api);
