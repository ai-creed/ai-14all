import type { GitSummary } from "./git-summary";
import type { ProcessAttentionState } from "./process-session";

export type ReviewMode = "files" | "changes" | "commits";

export type ViewerMode = "file" | "diff" | "commit";

export type WorktreeSession = {
	id: string;
	worktreeId: string;
	title: string;
	note: string;
	reviewMode: ReviewMode;
	viewerMode: ViewerMode;
	gitSummary: GitSummary | null;
	gitSummaryError: boolean;
	selectedFilePath: string | null;
	selectedChangedFilePath: string | null;
	selectedCommitSha: string | null;
	selectedCommitFilePath: string | null;
	activeProcessSessionId: string | null;
	processSessionIds: string[];
	attentionState: ProcessAttentionState;
};
