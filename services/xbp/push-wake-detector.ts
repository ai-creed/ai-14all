import type { WhisperWorktreeState } from "../../shared/models/ecosystem-plugin.js";

// Raw whisper `workflows.status` values (spec recon; ecosystem-plugin.ts:75).
// The trigger set is INTO {done, halted}. Display labels ("completed") and
// non-statuses ("failed", "escalated") fall through as unknown → ignored.
const QUALIFYING = new Set(["done", "halted"]);
const EXCLUDED = new Set(["canceled", "cancelled"]);

export type PushWakeTrigger = "workflow-done" | "workflow-halted" | "escalated";

// Local-only identity for audit + dedup. Never serialized into a push payload.
export type PushWakeEvent = {
	trigger: PushWakeTrigger;
	workflowId?: string;
	chainId?: string;
};

export type PushWakeSeenState = {
	workflows: Record<string, string>;
	pingedWorkflows: string[];
	pingedChains: string[];
};

export function detectPushWakeEvents(
	prev: PushWakeSeenState | null,
	states: WhisperWorktreeState[],
): { events: PushWakeEvent[]; next: PushWakeSeenState } {
	const events: PushWakeEvent[] = [];
	const next: PushWakeSeenState = {
		workflows: {},
		pingedWorkflows: [],
		pingedChains: [],
	};
	// Live, seeded from prev: mirrors pingedChains below so a workflowId
	// repeated across two states of one snapshot is caught mid-loop, not just
	// tick-to-tick (same duplicate-ping risk as the chain guard).
	const pingedWorkflows = new Set(prev?.pingedWorkflows ?? []);
	// Retained verbatim, never evicted: an already-seen chainId must never
	// re-qualify (spec), and any eviction would reopen a duplicate-ping path.
	// Escalations are rare — unbounded retention stays tiny in practice.
	next.pingedChains = [...(prev?.pingedChains ?? [])];
	const pingedChains = new Set(next.pingedChains);

	for (const state of states) {
		const wf = state.workflow;
		if (wf) {
			next.workflows[wf.workflowId] = wf.status;
			if (QUALIFYING.has(wf.status)) {
				if (pingedWorkflows.has(wf.workflowId)) {
					// Already pinged — either carried over from prev, or this is a
					// second occurrence of the same workflowId within this very
					// snapshot. Carry forward at most once; never re-push.
					if (!next.pingedWorkflows.includes(wf.workflowId)) {
						next.pingedWorkflows.push(wf.workflowId);
					}
				} else if (prev === null) {
					// Fresh baseline: settle without pinging.
					next.pingedWorkflows.push(wf.workflowId);
					pingedWorkflows.add(wf.workflowId);
				} else {
					const before = prev.workflows[wf.workflowId];
					if (
						before !== undefined &&
						!QUALIFYING.has(before) &&
						!EXCLUDED.has(before)
					) {
						// Genuine transition INTO the trigger set — includes the
						// restart case (persisted running → first snapshot done).
						events.push({
							trigger: wf.status === "done" ? "workflow-done" : "workflow-halted",
							workflowId: wf.workflowId,
						});
					}
					// Unseen-terminal rows settle silently; emitted ones must
					// never fire again. Both end up pinged.
					next.pingedWorkflows.push(wf.workflowId);
					pingedWorkflows.add(wf.workflowId);
				}
			}
		}
		const chainId = state.escalation?.chainId;
		if (chainId && !pingedChains.has(chainId)) {
			// Fresh baseline settles silently; otherwise a never-seen chainId
			// is a qualifying event (covers "escalated while host was down").
			if (prev !== null) events.push({ trigger: "escalated", chainId });
			next.pingedChains.push(chainId);
			pingedChains.add(chainId);
		}
	}
	return { events, next };
}
