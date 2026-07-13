import type { AgentAttentionReasonsBySource } from "./agent-attention";
import type { GitSummary } from "./git-summary";
import type { ProcessAttentionState } from "./process-session";
import type { LayoutId } from "./terminal-layout";
import type { ReviewedFileMark } from "./reviewed-file";

export type ReviewMode = "files" | "changes" | "commits";

export type FilesPaneMode = "files" | "symbols";

export type ViewerMode = "file" | "diff" | "commit";

export type WorktreeSession = {
	id: string;
	worktreeId: string;
	title: string;
	note: string;
	reviewMode: ReviewMode;
	/**
	 * Files-tab sub-mode: browse files (tree) vs search symbols. Persisted in
	 * the session snapshot, mirroring `reviewMode`. Default `"files"`.
	 */
	filesPaneMode: FilesPaneMode;
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
	/**
	 * Timestamp of the last terminal event (agent/workflow `ready` or process
	 * exit). Session-level `waiting`/`failed` reasons reported at or before this
	 * are retired by `buildWorktreeAttentionDisplay`, mirroring
	 * `ProcessSession.agentAttentionClearedAt`.
	 */
	agentAttentionClearedAt: number | null;
	terminalLayoutId: LayoutId;
	slotProcessIds: (string | null)[];
	reviewSidebarWidth: number;
	/** Files explicitly marked viewed this review, keyed by path → content hash. */
	reviewedFiles: ReviewedFileMark[];
	/** Whether the left-rail "All open comments" overview is expanded. */
	reviewOverviewExpanded: boolean;
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
	/**
	 * Throwaway (floating) shell process ids for this worktree, in pill order.
	 * Never overlaps `slotProcessIds`. Memory-only — intentionally absent from
	 * PersistedWorktreeSessionSchema so floating shells do not survive restart.
	 */
	floatingShellIds: string[];
	/**
	 * Which floating shell is expanded as a popover, or null when all are
	 * minimized. Enforces "one expanded at a time". Memory-only.
	 */
	expandedFloatingShellId: string | null;
	/**
	 * Self-reporting mode (spec 2026-07-05 §5, D4): true once an accepted MCP
	 * status push arrives while a detected agent process is running in this
	 * worktree; terminal/legacy heuristics for agent processes are muted while
	 * set. Resets when the last running detected agent exits. Memory-only —
	 * intentionally absent from PersistedWorktreeSessionSchema (the processes
	 * it describes are dead after a restart).
	 */
	mcpReportingActive: boolean;
};
