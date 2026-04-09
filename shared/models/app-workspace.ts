import type { Repository } from "./repository";
import type { Worktree } from "./worktree";
import type { WorkspaceState } from "../../src/features/workspace/workspace-state";
import type { PersistedSavedWorkspace } from "./persisted-workspace-state";

export type WorkspaceHydrationState = "dormant" | "active" | "inactiveLive";

export type AppWorkspace = {
	workspaceId: string;
	repository: Repository;
	worktrees: Worktree[];
	workspaceState: WorkspaceState | null;
	persistedSnapshot: PersistedSavedWorkspace | null;
	hydrationState: WorkspaceHydrationState;
	loadError: string | null;
};
