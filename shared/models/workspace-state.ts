import type { CommandPreset } from "./command-preset";
import type { ProcessSession } from "./process-session";
import type { WorktreeSession } from "./worktree-session";

export type WorkspaceState = {
	selectedWorktreeId: string | null;
	commandPresets: CommandPreset[];
	processSessionsById: Record<string, ProcessSession>;
	sessionsByWorktreeId: Record<string, WorktreeSession>;
	nextAdHocNumberByWorktreeId: Record<string, number>;
};
