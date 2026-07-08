import type { SamanthaSessionSlice } from "../../../shared/contracts/plugins";
import type { AgentAttentionState } from "../../../shared/models/agent-attention";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";

/** Identity main owns for a worktree. Keyed by worktreeId in ObserveInput. */
export type WorktreeIdentity = {
	repo: string;
	branch: string;
	path: string;
};

/** Samantha's event signal vocabulary (her existing enum). */
export type SamanthaSignal =
	| "attentionRequired"
	| "error"
	| "taskCompleted"
	| "update";

export type ObserveInput = {
	/** worktreeId -> identity (repo/branch/path). */
	identities: Record<string, WorktreeIdentity>;
	/** worktreeId -> count of open review comments. */
	reviewCounts: Record<string, number>;
	/** Whisper workflow/collab states (already keyed by worktreeId inside). */
	whisper: WhisperWorktreeState[];
	/** Latest resolved session slice from the renderer, or null before first push. */
	session: SamanthaSessionSlice | null;
};

export type SupervisorWorktree = {
	worktreeId: string;
	repo: string;
	branch: string;
	focused: boolean;
	provider: string | null;
	attention: AgentAttentionState;
	signal: SamanthaSignal;
	summary: string | null;
	task: string | null;
	nextAction: string | null;
	reviewCount: number;
	workflow: {
		workflowType: string;
		status: string;
		phaseName: string | null;
		workflowId: string;
	} | null;
	escalation: { reason: string } | null;
	recent: { from: string; to: string; summary: string; source: string }[];
};

// Canonical field order. ai-14all owns this; Samantha mirrors the identical literal, and
// both repos pin it. The compile-time guard fails the build if the list and the type drift.
export const SUPERVISOR_WORKTREE_FIELDS = [
	"worktreeId",
	"repo",
	"branch",
	"focused",
	"provider",
	"attention",
	"signal",
	"summary",
	"task",
	"nextAction",
	"reviewCount",
	"workflow",
	"escalation",
	"recent",
] as const;

type _FieldsEqual =
	(typeof SUPERVISOR_WORKTREE_FIELDS)[number] extends keyof SupervisorWorktree
		? keyof SupervisorWorktree extends (typeof SUPERVISOR_WORKTREE_FIELDS)[number]
			? true
			: never
		: never;
const _fieldsEqual: _FieldsEqual = true;
void _fieldsEqual;

export type ObserveOutput = {
	/** Derived TTS headline. */
	summary: string;
	/** Worst-of status across worktrees. */
	status: "ok" | "warning" | "error" | "unknown";
	/** One key per worktree ("<repo>/<branch>"), value = dense readable line. */
	details: Record<string, string>;
	/** worktreeId -> current mapped signal (the driver diffs this to decide events). */
	signals: Record<string, SamanthaSignal>;
	/** Structured mirror of `details` — Samantha's supervisor-board source of truth. */
	worktrees: SupervisorWorktree[];
	mode: string;
	focusedWorktreeId: string | null;
};
