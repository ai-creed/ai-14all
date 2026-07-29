// The detached window has no App state, so it loads the workspace registry
// (§4.8 row seeding) from the persisted workspace state the preload already
// exposes (window-agnostic invoke: shared with the main window's own restore
// flow). This is a pure mapper over the REAL V2 shape
// (PersistedWorkspaceStateV2Schema) — see shared/models/persisted-workspace-state.ts.
// state.workspaces[] entries carry workspaceId / repositoryPath / repoId and
// snapshot.worktreeSessions. V2 has no display-name field — the title is the
// repository path's basename (what the sidebar shows for a repo).
import type { PersistedWorkspaceStateV2 } from "../../../shared/models/persisted-workspace-state";
import type { WorkspaceIndex } from "./workspaceRows";

const basename = (p: string): string =>
	p.replace(/\/+$/, "").split("/").pop() ?? p;

export function workspaceIndexFromRestoreState(
	state: Pick<PersistedWorkspaceStateV2, "workspaces">,
): WorkspaceIndex {
	return state.workspaces.map((w) => ({
		workspaceId: w.workspaceId,
		title: basename(w.repositoryPath),
		repoId: w.repoId,
		rootPath: w.repositoryPath,
		worktreeCount: Math.max(w.snapshot.worktreeSessions.length, 1),
	}));
}

export async function loadWorkspaceIndex(): Promise<WorkspaceIndex> {
	// readRestoreState() resolves the parsed V2 state (zod-validated on the main
	// side). No shape-guessing casts here: a thrown IPC failure is the ONLY
	// fallback path — an empty index must never come from a mis-read shape.
	try {
		const state = await window.ai14all.workspace.readRestoreState();
		return workspaceIndexFromRestoreState(state);
	} catch {
		return [];
	}
}
