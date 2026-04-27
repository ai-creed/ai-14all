import type { Ai14AllDesktopApi } from "../../shared/contracts/commands";
import {
	OpenFileForEditResultSchema,
	SaveFileResultSchema,
} from "../../shared/contracts/commands";
import type { ReviewCommentChangedEvent } from "../../shared/contracts/review-comments";

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
		getDesktopClient().repository.previewRemoveWorktree(
			workspaceId,
			worktreeId,
		),
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
	listTracked: (workspaceId, worktreeId) =>
		getDesktopClient().files.listTracked(workspaceId, worktreeId),
	read: (worktreePath, relativePath) =>
		getDesktopClient().files.read(worktreePath, relativePath),
	openForEdit: async (workspaceId, worktreeId, relativePath) => {
		const raw = await getDesktopClient().files.openForEdit(
			workspaceId,
			worktreeId,
			relativePath,
		);
		return OpenFileForEditResultSchema.parse(raw);
	},
	save: async (args) => {
		const raw = await getDesktopClient().files.save(args);
		return SaveFileResultSchema.parse(raw);
	},
	getPathForFile: (file) => getDesktopClient().files.getPathForFile(file),
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
	discardChange: (worktreePath, relativePath) =>
		getDesktopClient().git.discardChange(worktreePath, relativePath),
	getRemoteStatus: (worktreePath) =>
		getDesktopClient().git.getRemoteStatus(worktreePath),
	pushBranch: (worktreePath, force) =>
		getDesktopClient().git.pushBranch(worktreePath, force),
};

export const workspace: Ai14AllDesktopApi["workspace"] = {
	openRepository: (path) => getDesktopClient().workspace.openRepository(path),
	readRestoreState: () => getDesktopClient().workspace.readRestoreState(),
	writeRestoreState: (state) =>
		getDesktopClient().workspace.writeRestoreState(state),
	onOpenPicker: (listener) =>
		getDesktopClient().workspace.onOpenPicker(listener),
};

export const diagnostics: Ai14AllDesktopApi["diagnostics"] = {
	logShellEvent: (event) => getDesktopClient().diagnostics.logShellEvent(event),
};

export const system: Ai14AllDesktopApi["system"] = {
	onUpdateAvailable: (listener) =>
		getDesktopClient().system.onUpdateAvailable(listener),
	openExternal: (url) => getDesktopClient().system.openExternal(url),
};

export const reviewComments: Ai14AllDesktopApi["reviewComments"] = {
	list: (worktreeId) => getDesktopClient().reviewComments.list(worktreeId),
	create: (input) => getDesktopClient().reviewComments.create(input),
	markAddressed: (commentId) =>
		getDesktopClient().reviewComments.markAddressed(commentId),
	reopen: (commentId) => getDesktopClient().reviewComments.reopen(commentId),
	delete: (commentId) => getDesktopClient().reviewComments.delete(commentId),
	rebaseWorktreeIds: (mapping) =>
		getDesktopClient().reviewComments.rebaseWorktreeIds(mapping),
	onChanged: (handler: (event: ReviewCommentChangedEvent) => void) =>
		getDesktopClient().reviewComments.onChanged(handler),
};

export const agentInstall: Ai14AllDesktopApi["agentInstall"] = {
	listProviders: () => getDesktopClient().agentInstall.listProviders(),
	install: (ids) => getDesktopClient().agentInstall.install(ids),
	uninstall: (ids) => getDesktopClient().agentInstall.uninstall(ids),
};

export const events: Ai14AllDesktopApi["events"] = {
	onOpenInstallModal: (handler) =>
		getDesktopClient().events.onOpenInstallModal(handler),
};
