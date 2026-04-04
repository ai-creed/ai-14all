import type { OneForAllDesktopApi } from "../../shared/contracts/commands";

/**
 * Typed wrapper around the preload bridge injected as `window.oneforall`.
 * React components should import from here rather than accessing window directly.
 */
export function getDesktopClient(): OneForAllDesktopApi {
	return window.oneforall;
}

export const repository: OneForAllDesktopApi["repository"] = {
	setRoot: (path) => getDesktopClient().repository.setRoot(path),
	listWorktrees: () => getDesktopClient().repository.listWorktrees(),
};

export const terminals: OneForAllDesktopApi["terminals"] = {
	create: (worktreeId, cwd) =>
		getDesktopClient().terminals.create(worktreeId, cwd),
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

export const files: OneForAllDesktopApi["files"] = {
	list: (worktreePath) => getDesktopClient().files.list(worktreePath),
	listScoped: (worktreePath, relativeRoots) =>
		getDesktopClient().files.listScoped(worktreePath, relativeRoots),
	read: (worktreePath, relativePath) =>
		getDesktopClient().files.read(worktreePath, relativePath),
};

export const git: OneForAllDesktopApi["git"] = {
	listChanges: (worktreePath) =>
		getDesktopClient().git.listChanges(worktreePath),
	readDiff: (worktreePath, relativePath) =>
		getDesktopClient().git.readDiff(worktreePath, relativePath),
	readSummary: (worktreePath) =>
		getDesktopClient().git.readSummary(worktreePath),
};
