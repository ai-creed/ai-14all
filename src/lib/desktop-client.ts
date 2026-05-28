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
	list: (workspaceId, worktreeId) =>
		getDesktopClient().files.list(workspaceId, worktreeId),
	listScoped: (workspaceId, worktreeId, relativeRoots) =>
		getDesktopClient().files.listScoped(workspaceId, worktreeId, relativeRoots),
	listWorktree: (workspaceId, worktreeId, opts) =>
		getDesktopClient().files.listWorktree(workspaceId, worktreeId, opts),
	read: (workspaceId, worktreeId, relativePath) =>
		getDesktopClient().files.read(workspaceId, worktreeId, relativePath),
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
	listChanges: (workspaceId, worktreeId) =>
		getDesktopClient().git.listChanges(workspaceId, worktreeId),
	readDiff: (workspaceId, worktreeId, relativePath) =>
		getDesktopClient().git.readDiff(workspaceId, worktreeId, relativePath),
	readSummary: (workspaceId, worktreeId) =>
		getDesktopClient().git.readSummary(workspaceId, worktreeId),
	readCommitHistory: (workspaceId, worktreeId) =>
		getDesktopClient().git.readCommitHistory(workspaceId, worktreeId),
	readCommitDetail: (workspaceId, worktreeId, sha) =>
		getDesktopClient().git.readCommitDetail(workspaceId, worktreeId, sha),
	discardChange: (workspaceId, worktreeId, relativePath) =>
		getDesktopClient().git.discardChange(workspaceId, worktreeId, relativePath),
	getRemoteStatus: (workspaceId, worktreeId) =>
		getDesktopClient().git.getRemoteStatus(workspaceId, worktreeId),
	pushBranch: (workspaceId, worktreeId, force) =>
		getDesktopClient().git.pushBranch(workspaceId, worktreeId, force),
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
	logAttentionEvent: (event) =>
		getDesktopClient().diagnostics.logAttentionEvent(event),
	getAgentAttentionStatus: () =>
		getDesktopClient().diagnostics.getAgentAttentionStatus(),
};

export const system: Ai14AllDesktopApi["system"] = {
	onUpdateAvailable: (listener) =>
		getDesktopClient().system.onUpdateAvailable(listener),
	onUpdateDownloaded: (listener) =>
		getDesktopClient().system.onUpdateDownloaded(listener),
	onUpdateError: (listener) =>
		getDesktopClient().system.onUpdateError(listener),
	installUpdate: () => getDesktopClient().system.installUpdate(),
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
	update: (commentId, body) =>
		getDesktopClient().reviewComments.update(commentId, body),
	bulkRemoveAddressed: (worktreeId, ids) =>
		getDesktopClient().reviewComments.bulkRemoveAddressed(worktreeId, ids),
};

export const agentInstall: Ai14AllDesktopApi["agentInstall"] = {
	listProviders: () => getDesktopClient().agentInstall.listProviders(),
	install: (ids) => getDesktopClient().agentInstall.install(ids),
	uninstall: (ids) => getDesktopClient().agentInstall.uninstall(ids),
	pickCliPath: (id) => getDesktopClient().agentInstall.pickCliPath(id),
	setCliOverride: (id, path) =>
		getDesktopClient().agentInstall.setCliOverride(id, path),
};

export const events: Ai14AllDesktopApi["events"] = {
	onOpenInstallModal: (handler) =>
		getDesktopClient().events.onOpenInstallModal(handler),
	onSetTheme: (handler) => getDesktopClient().events.onSetTheme(handler),
};

export const noteBridge: Ai14AllDesktopApi["noteBridge"] = {
	onRequest: (handler) => getDesktopClient().noteBridge.onRequest(handler),
	sendReply: (reply) => getDesktopClient().noteBridge.sendReply(reply),
	sendReady: () => getDesktopClient().noteBridge.sendReady(),
	sendGoodbye: () => getDesktopClient().noteBridge.sendGoodbye(),
};

// App-level signals: dirty-state push to main + close-gate handshake.
// `setEditorDirty` and `confirmClose` are fire-and-forget IPC sends; the
// dirty bit feeds main's close gate, and confirmClose resolves the renderer
// reply to the `app:requestClose` event.
export const app: Ai14AllDesktopApi["app"] = {
	setEditorDirty: (args) => getDesktopClient().app.setEditorDirty(args),
	confirmClose: (args) => getDesktopClient().app.confirmClose(args),
	onRequestClose: (handler) => getDesktopClient().app.onRequestClose(handler),
};

export const agentAttentionBridge: Ai14AllDesktopApi["agentAttentionBridge"] = {
	onRequest: (handler) =>
		getDesktopClient().agentAttentionBridge.onRequest(handler),
	sendReply: (reply) =>
		getDesktopClient().agentAttentionBridge.sendReply(reply),
	sendReady: () => getDesktopClient().agentAttentionBridge.sendReady(),
	sendGoodbye: () => getDesktopClient().agentAttentionBridge.sendGoodbye(),
};
