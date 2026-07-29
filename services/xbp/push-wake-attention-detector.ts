import type { PushWakeAttentionSeenState } from "./push-wake-state-store.js";

// Trigger set {waiting, failed} — the top two of AGENT_ATTENTION_RANK
// (shared/models/agent-attention.ts). `ready` is EXCLUDED by operator
// decision (finished-task pings declined as noise); stale/active/idle and
// unknown values are calm (non-members).
export type PushWakeAttentionTrigger = "attention-waiting" | "attention-failed";

export type PushWakeAttentionEvent = {
	trigger: PushWakeAttentionTrigger;
	worktreeId: string;
};

// Pure per-session transition detector over the session report (child spec
// §2). `prev === null` is the never-baselined state: record the snapshot,
// fire nothing (firing against the unknown risks the forbidden duplicate).
// A resolved-but-empty `sessions` array is authoritative: everything absent
// prunes out of `next` (re-arms). The CALLER must not invoke this on a
// rejected poll — rejection means unavailable, and the pass is skipped with
// state untouched.
export function detectAttentionEvents(
	prev: PushWakeAttentionSeenState | null,
	sessions: ReadonlyArray<{ worktreeId: string; attention: string }>,
): { events: PushWakeAttentionEvent[]; next: PushWakeAttentionSeenState } {
	const events: PushWakeAttentionEvent[] = [];
	const next: PushWakeAttentionSeenState = { sessions: {} };
	for (const session of sessions) {
		const attention = session.attention;
		if (attention !== "waiting" && attention !== "failed") continue;
		if (
			Object.prototype.hasOwnProperty.call(next.sessions, session.worktreeId)
		) {
			// Defensive: buildSessionReport keys sessions uniquely; if a
			// duplicate ever appears, last value wins without a second event.
			next.sessions[session.worktreeId] = attention;
			continue;
		}
		next.sessions[session.worktreeId] = attention;
		if (prev === null) continue; // null baseline: record silently
		if (prev.sessions[session.worktreeId] === attention) continue; // unchanged
		events.push({
			trigger:
				attention === "waiting" ? "attention-waiting" : "attention-failed",
			worktreeId: session.worktreeId,
		});
	}
	return { events, next };
}
