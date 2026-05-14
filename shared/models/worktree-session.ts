import type { AgentAttentionReasonsBySource } from "./agent-attention";
import type { GitSummary } from "./git-summary";
import type { ProcessAttentionState } from "./process-session";

export type ReviewMode = "files" | "changes" | "commits";

export type ViewerMode = "file" | "diff" | "commit";
export type TerminalLayoutMode = "single" | "split";

export type WorktreeSession = {
	id: string;
	worktreeId: string;
	title: string;
	note: string;
	reviewMode: ReviewMode;
	viewerMode: ViewerMode;
	gitSummary: GitSummary | null;
	gitSummaryStale: boolean;
	gitSummaryMessage: string | null;
	gitSummaryError: boolean;
	selectedFilePath: string | null;
	selectedChangedFilePath: string | null;
	selectedCommitSha: string | null;
	selectedCommitFilePath: string | null;
	activeProcessSessionId: string | null;
	processSessionIds: string[];
	attentionState: ProcessAttentionState;
	agentAttentionReasons: AgentAttentionReasonsBySource;
	terminalLayoutMode: TerminalLayoutMode;
	splitLeftProcessId: string | null;
	splitRightProcessId: string | null;
	reviewSidebarWidth: number;
	/**
	 * Per-worktree expand state for the Files tree. Held in memory only and
	 * intentionally omitted from `PersistedWorktreeSessionSchema` so that
	 * every app restart resets to the default (root-only) state. See
	 * docs/superpowers/specs/2026-04-16-worktree-file-tree-design.md §4.6.
	 */
	treeExpandedPaths: string[];
};
