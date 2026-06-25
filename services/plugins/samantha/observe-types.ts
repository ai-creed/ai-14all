import type { SamanthaSessionSlice } from "../../../shared/contracts/plugins";
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

export type ObserveOutput = {
	/** Derived TTS headline. */
	summary: string;
	/** Worst-of status across worktrees. */
	status: "ok" | "warning" | "error" | "unknown";
	/** One key per worktree ("<repo>/<branch>"), value = dense readable line. */
	details: Record<string, string>;
	/** worktreeId -> current mapped signal (the driver diffs this to decide events). */
	signals: Record<string, SamanthaSignal>;
};
