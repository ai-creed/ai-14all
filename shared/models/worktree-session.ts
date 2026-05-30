import type { AgentAttentionReasonsBySource } from "./agent-attention";
import type { GitSummary } from "./git-summary";
import type { ProcessAttentionState } from "./process-session";
import type { LayoutId } from "./terminal-layout";

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
	terminalLayoutId: LayoutId;
	slotProcessIds: (string | null)[];
	reviewSidebarWidth: number;
	/**
	 * Per-worktree expand state for the Files tree. Held in memory only and
	 * intentionally omitted from `PersistedWorktreeSessionSchema` so that
	 * every app restart resets to the default (root-only) state. See
	 * docs/superpowers/specs/2026-04-16-worktree-file-tree-design.md §4.6.
	 */
	treeExpandedPaths: string[];
	/**
	 * Per-worktree "Show ignored" toggle for the Files tree. Memory-only,
	 * matching `treeExpandedPaths`. Default: false.
	 */
	treeShowIgnored: boolean;
	task: string | null;
	/**
	 * One-shot reveal request stamped by `session/selectFileAtLocation` and
	 * consumed by `<InlineEditor>` once Monaco has applied it (mirrors the
	 * `pendingCommentJump` pattern in App.tsx). Memory-only — intentionally
	 * absent from PersistedWorktreeSessionSchema so reveals never replay on
	 * restart. See docs/superpowers/specs/2026-05-29-code-nav-mvp-design.md §304.
	 */
	pendingReveal: { line: number; column?: number; capturedAt: number } | null;
	/**
	 * Marks the main pane as a transient preview when the last nav came from
	 * `source === "definition"`. The NavRouter uses it to replace in place on
	 * the next jump instead of pushing history. Memory-only.
	 */
	paneTransient: boolean;
	/**
	 * The location the main code pane is currently showing, fed to the
	 * NavRouter as `ActiveContext.currentLocation` so a subsequent jump can
	 * push it onto nav history. Stamped by the file-select reducers; null when
	 * the pane shows a diff/commit/no code file. Memory-only — absent from
	 * PersistedWorktreeSessionSchema. See spec §299, §304.
	 */
	navLocation: { file: string; line: number; column?: number } | null;
};
