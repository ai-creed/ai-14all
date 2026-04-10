import type { Ai14AllDesktopApi } from "../../shared/contracts/commands";

/**
 * Typed wrapper around the preload bridge injected as `window.ai14all`.
 * React components should import from here rather than accessing window directly.
 */
export function getDesktopClient(): Ai14AllDesktopApi {
	return window.ai14all;
}

export const repository: Ai14AllDesktopApi["repository"] = {
	pickRoot: () => getDesktopClient().repository.pickRoot(),
	listWorktrees: (workspaceId) =>
		getDesktopClient().repository.listWorktrees(workspaceId),
	previewCreateWorktree: (workspaceId, name) =>
		getDesktopClient().repository.previewCreateWorktree(workspaceId, name),
	createWorktree: (workspaceId, name) =>
		getDesktopClient().repository.createWorktree(workspaceId, name),
	previewRemoveWorktree: (workspaceId, worktreeId) =>
		getDesktopClient().repository.previewRemoveWorktree(workspaceId, worktreeId),
	removeWorktree: (workspaceId, worktreeId) =>
		getDesktopClient().repository.removeWorktree(workspaceId, worktreeId),
};

export const terminals: Ai14AllDesktopApi["terminals"] = {
	create: (workspaceId, worktreeId, cwd) =>
		getDesktopClient().terminals.create(workspaceId, worktreeId, cwd),
	list: (workspaceId) => getDesktopClient().terminals.list(workspaceId),
	sendInput: (sessionId, data) =>
		getDesktopClient().terminals.sendInput(sessionId, data),
	resize: (sessionId, cols, rows) =>
		getDesktopClient().terminals.resize(sessionId, cols, rows),
	stop: (sessionId) => getDesktopClient().terminals.stop(sessionId),
	onOutput: (listener) => getDesktopClient().terminals.onOutput(listener),
	onExit: (listener) => getDesktopClient().terminals.onExit(listener),
	onState: (listener) => getDesktopClient().terminals.onState(listener),
	onError: (listener) => getDesktopClient().terminals.onError(listener),
};

export const files: Ai14AllDesktopApi["files"] = {
	list: (worktreePath) => getDesktopClient().files.list(worktreePath),
	listScoped: (worktreePath, relativeRoots) =>
		getDesktopClient().files.listScoped(worktreePath, relativeRoots),
	read: (worktreePath, relativePath) =>
		getDesktopClient().files.read(worktreePath, relativePath),
};

export const git: Ai14AllDesktopApi["git"] = {
	listChanges: (worktreePath) =>
		getDesktopClient().git.listChanges(worktreePath),
	readDiff: (worktreePath, relativePath) =>
		getDesktopClient().git.readDiff(worktreePath, relativePath),
	readSummary: (worktreePath) =>
		getDesktopClient().git.readSummary(worktreePath),
	readCommitHistory: (worktreePath) =>
		getDesktopClient().git.readCommitHistory(worktreePath),
	readCommitDetail: (worktreePath, sha) =>
		getDesktopClient().git.readCommitDetail(worktreePath, sha),
};

export const workspace: Ai14AllDesktopApi["workspace"] = {
	openRepository: (path) => getDesktopClient().workspace.openRepository(path),
	readRestoreState: () => getDesktopClient().workspace.readRestoreState(),
	writeRestoreState: (state) =>
		getDesktopClient().workspace.writeRestoreState(state),
	onOpenPicker: (listener) => getDesktopClient().workspace.onOpenPicker(listener),
};
