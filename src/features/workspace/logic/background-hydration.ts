import type { AppWorkspacesState } from "./app-workspaces-state";

/** Next workspace the background queue should hydrate, or null when done. */
export function pickNextHydration(state: AppWorkspacesState): string | null {
	for (const id of state.workspaceOrder) {
		if (id === state.activeWorkspaceId) continue;
		const ws = state.workspacesById[id];
		if (!ws) continue;
		if (ws.workspaceState) continue; // already live
		if (ws.loadError) continue; // failed earlier — retry is click-driven
		return id;
	}
	return null;
}
