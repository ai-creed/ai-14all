// services/plugins/samantha/observe-assembler.ts
import type { AgentAttentionState } from "../../../shared/models/agent-attention";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import type {
	ObserveInput,
	ObserveOutput,
	SamanthaSignal,
} from "./observe-types";

const SIGNAL_SEVERITY: Record<SamanthaSignal, number> = {
	update: 0,
	taskCompleted: 1,
	attentionRequired: 2,
	error: 3,
};

function sessionSignal(attention: AgentAttentionState): SamanthaSignal {
	if (attention === "failed") return "error";
	if (attention === "waiting") return "attentionRequired";
	if (attention === "ready") return "taskCompleted";
	return "update"; // active | stale | idle
}

function whisperSignal(state: WhisperWorktreeState | undefined): SamanthaSignal {
	if (!state) return "update";
	if (state.escalation !== null) return "attentionRequired";
	if (state.workflow?.status === "halted") return "attentionRequired";
	return "update";
}

function mostSevere(a: SamanthaSignal, b: SamanthaSignal): SamanthaSignal {
	return SIGNAL_SEVERITY[a] >= SIGNAL_SEVERITY[b] ? a : b;
}

function workflowFragment(state: WhisperWorktreeState | undefined): string {
	if (!state) return "";
	if (state.escalation !== null)
		return `workflow escalated: ${state.escalation.reason}`;
	const wf = state.workflow;
	if (!wf) return "";
	const phase = wf.phaseName ? ` ${wf.phaseName}` : "";
	return `${wf.workflowType} ${wf.status}${phase}`.trim();
}

function recentFragment(
	recent: { from: string; to: string; summary: string; source: string }[],
): string {
	if (recent.length === 0) return "";
	const parts = recent.map((r) => {
		const detail = [r.summary, r.source].filter(Boolean).join("; ");
		return detail ? `${r.from}→${r.to} (${detail})` : `${r.from}→${r.to}`;
	});
	return `recent: ${parts.join(", ")}`;
}

export function assembleObserve(input: ObserveInput): ObserveOutput {
	const details: Record<string, string> = {};
	const signals: Record<string, SamanthaSignal> = {};
	const focusedId = input.session?.app.focusedWorktreeId ?? null;
	const whisperById = new Map(input.whisper.map((w) => [w.worktreeId, w]));
	const sessionById = new Map(
		(input.session?.worktrees ?? []).map((w) => [w.worktreeId, w]),
	);
	const digest: string[] = [];
	let anyFailed = false;
	let anyWaitingOrReady = false;

	// Union of every worktree main knows about, so the document is populated from
	// main-owned data (identity + reviews + workflow) even BEFORE the renderer's
	// first session slice arrives — the driver must never block on the renderer.
	// Identity is required for the "<repo>/<branch>" key; a worktree we cannot
	// name (no identity) is skipped.
	const worktreeIds = new Set<string>([
		...Object.keys(input.identities),
		...input.whisper.map((w) => w.worktreeId),
		...sessionById.keys(),
	]);

	for (const worktreeId of worktreeIds) {
		const identity = input.identities[worktreeId];
		if (!identity) continue; // no identity -> cannot key it -> drop
		const wt = sessionById.get(worktreeId); // undefined before the first slice
		const reviews = input.reviewCounts[worktreeId] ?? 0;
		const whisper = whisperById.get(worktreeId);

		const sig = mostSevere(
			wt ? sessionSignal(wt.attention) : "update",
			whisperSignal(whisper),
		);
		signals[worktreeId] = sig;
		if (wt?.attention === "failed") anyFailed = true;
		if (wt?.attention === "waiting" || wt?.attention === "ready")
			anyWaitingOrReady = true;

		const attention = wt?.attention ?? "idle";
		const fields = [
			wt?.provider ?? "",
			attention,
			wt?.summary ?? "",
			wt?.task ? `task: ${wt.task}` : "",
			wt?.nextAction ? `next: ${wt.nextAction}` : "",
			reviews > 0 ? `${reviews} reviews` : "",
			workflowFragment(whisper),
			wt ? recentFragment(wt.recent) : "",
		].filter((f) => f.length > 0);

		const prefix = worktreeId === focusedId ? "★ " : "";
		details[`${identity.repo}/${identity.branch}`] = prefix + fields.join(" · ");
		digest.push(`${identity.branch} ${attention}`);
	}

	const count = Object.keys(details).length;
	const status: ObserveOutput["status"] =
		count === 0
			? "unknown"
			: anyFailed
				? "error"
				: anyWaitingOrReady
					? "warning"
					: "ok";

	const mode = input.session?.app.mode ?? "loading";
	const focusBranch =
		(focusedId && input.identities[focusedId]?.branch) || null;
	const head = `[${mode}]${focusBranch ? ` focus ${focusBranch}` : ""}`;
	const summary =
		count === 0
			? `${head} — no active sessions`
			: `${head} — ${count} session${count === 1 ? "" : "s"}: ${digest.join(", ")}`;

	return { summary, status, details, signals };
}
