import { contextBridge, ipcRenderer } from "electron";
import type { Ai14AllDesktopApi } from "../../shared/contracts/commands.js";
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

const api: Ai14AllDesktopApi = {
	repository: {
		pickRoot() {
			return ipcRenderer.invoke("repository:pickRoot", {});
		},
		listWorktrees(workspaceId) {
			return ipcRenderer.invoke("repository:listWorktrees", { workspaceId });
		},
		previewCreateWorktree(workspaceId, name) {
			return ipcRenderer.invoke("repository:previewCreateWorktree", { workspaceId, name });
		},
		createWorktree(workspaceId, name) {
			return ipcRenderer.invoke("repository:createWorktree", { workspaceId, name });
		},
		previewRemoveWorktree(workspaceId, worktreeId) {
			return ipcRenderer.invoke("repository:previewRemoveWorktree", { workspaceId, worktreeId });
		},
		removeWorktree(workspaceId, worktreeId) {
			return ipcRenderer.invoke("repository:removeWorktree", { workspaceId, worktreeId });
		},
	},
	terminals: {
		create(workspaceId, worktreeId, cwd) {
			return ipcRenderer.invoke("terminals:create", { workspaceId, worktreeId, cwd });
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
		read(worktreePath, relativePath) {
			return ipcRenderer.invoke("files:read", { worktreePath, relativePath });
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
};

contextBridge.exposeInMainWorld("ai14all", api);
