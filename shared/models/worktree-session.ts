import type { ProcessAttentionState } from "./process-session";

export type ReviewMode = "files" | "changes";

export type WorktreeSession = {
	id: string;
	worktreeId: string;
	title: string;
	note: string;
	reviewMode: ReviewMode;
	selectedFilePath: string | null;
	selectedChangedFilePath: string | null;
	activeProcessSessionId: string | null;
	processSessionIds: string[];
	attentionState: ProcessAttentionState;
};
