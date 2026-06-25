export type WorkspacesForFocus = {
	workspaceOrder: string[];
	workspacesById: Record<
		string,
		{
			workspaceState?: { sessionsByWorktreeId: Record<string, unknown> } | null;
		}
	>;
};

/** Find the workspace whose hydrated state owns `worktreeId`, or null. */
export function findWorkspaceForWorktree(
	workspaces: WorkspacesForFocus,
	worktreeId: string,
): string | null {
	for (const wsId of workspaces.workspaceOrder) {
		const state = workspaces.workspacesById[wsId]?.workspaceState;
		if (state && worktreeId in state.sessionsByWorktreeId) return wsId;
	}
	return null;
}
