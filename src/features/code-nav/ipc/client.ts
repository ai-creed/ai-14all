export type WorktreeRef = { workspaceId: string; worktreeId: string };

// The full `window.ai14all` surface is declared by src/lib/desktop-client.ts
// (or wherever Ai14AllDesktopApi is hung on Window). We just read codeNav here.

export const codeNavClient = {
	findDefinitions: (
		ref: WorktreeRef,
		args: { name: string; callerFile?: string },
	) => window.ai14all.codeNav.findDefinitions({ ...ref, ...args }),
	findCallers: (ref: WorktreeRef, args: { fnId: number }) =>
		window.ai14all.codeNav.findCallers({ ...ref, ...args }),
	findCallees: (ref: WorktreeRef, args: { fnId: number }) =>
		window.ai14all.codeNav.findCallees({ ...ref, ...args }),
	searchSymbols: (
		ref: WorktreeRef,
		args: { query: string; limit?: number },
	) => window.ai14all.codeNav.searchSymbols({ ...ref, ...args }),
	getFileImports: (ref: WorktreeRef, args: { file: string }) =>
		window.ai14all.codeNav.getFileImports({ ...ref, ...args }),
	getWorktreeStatus: (ref: WorktreeRef) =>
		window.ai14all.codeNav.getWorktreeStatus(ref),
	listFiles: (ref: WorktreeRef) => window.ai14all.codeNav.listFiles(ref),
	watchWorktree: (ref: WorktreeRef) =>
		window.ai14all.codeNav.watchWorktree(ref),
	unwatchWorktree: (ref: WorktreeRef) =>
		window.ai14all.codeNav.unwatchWorktree(ref),
	refreshWorktree: (ref: WorktreeRef, changedFiles?: string[]) =>
		window.ai14all.codeNav.refreshWorktree({ ...ref, changedFiles }),
};
