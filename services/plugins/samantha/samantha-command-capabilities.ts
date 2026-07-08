import {
	SessionReportResult,
	type SessionEntry,
} from "@ai-creed/command-contract";
import type {
	ObserveInput,
	ObserveOutput,
	WorktreeIdentity,
} from "./observe-types";

export type ResolveResult =
	| { kind: "found"; worktreeId: string }
	| { kind: "none" }
	| { kind: "ambiguous"; candidates: string[] };

/**
 * Map a `"<repo>/<branch>"` observe key to a worktreeId. The key is not globally
 * unique (two same-basename repos on the same branch collide), so ambiguity is a
 * first-class outcome: an ambiguous key is refused, never guessed.
 */
export function resolveWorktreeKey(
	identities: Record<string, WorktreeIdentity>,
	key: string,
): ResolveResult {
	const matches: { worktreeId: string; path: string }[] = [];
	for (const [worktreeId, identity] of Object.entries(identities)) {
		if (`${identity.repo}/${identity.branch}` === key)
			matches.push({ worktreeId, path: identity.path });
	}
	if (matches.length === 0) return { kind: "none" };
	if (matches.length === 1)
		return { kind: "found", worktreeId: matches[0].worktreeId };
	return { kind: "ambiguous", candidates: matches.map((m) => m.path) };
}

/** Render the whole-app roll-up: the summary headline + one line per worktree. */
export function renderReport(out: ObserveOutput): string {
	const lines = Object.entries(out.details).map(
		([key, line]) => `${key}: ${line}`,
	);
	return lines.length === 0 ? out.summary : [out.summary, ...lines].join("\n");
}

// The shape the session-report command forwards: the rendered TTS text plus the
// canonical structure. `report` is what Samantha speaks; `sessions` is the
// structure the phone renders cards from (and Slice 2b's XBP edge will carry).
export type SessionReportSnapshot = {
	report: string;
	sessions: SessionReportResult;
};

// Assemble the canonical structured report from the same four sources the
// observe assembler merges (identity, review counts, the session slice, whisper
// state), in the same per-worktree iteration order, and validate it against the
// shared contract schema (fail closed). This is the structure-first form: the
// phone renders cards from it, and `renderReportText` renders Samantha's text
// from it.
export function buildSessionReport(input: ObserveInput): SessionReportResult {
	const focusedId = input.session?.app.focusedWorktreeId ?? null;
	const whisperById = new Map(input.whisper.map((w) => [w.worktreeId, w]));
	const sessionById = new Map(
		(input.session?.worktrees ?? []).map((w) => [w.worktreeId, w]),
	);
	// Same union + order as assembleObserve, so the rendered text matches today's.
	const worktreeIds = new Set<string>([
		...Object.keys(input.identities),
		...input.whisper.map((w) => w.worktreeId),
		...sessionById.keys(),
	]);

	const sessions: SessionEntry[] = [];
	for (const worktreeId of worktreeIds) {
		const identity = input.identities[worktreeId];
		if (!identity) continue; // no identity -> cannot key it -> drop (matches assembleObserve)
		const wt = sessionById.get(worktreeId);
		const whisper = whisperById.get(worktreeId);
		sessions.push({
			worktreeId,
			repo: identity.repo,
			branch: identity.branch,
			provider: wt?.provider ?? null,
			attention: wt?.attention ?? "idle",
			summary: wt?.summary ?? "",
			task: wt?.task ?? null,
			nextAction: wt?.nextAction ?? null,
			reviewCount: input.reviewCounts[worktreeId] ?? 0,
			escalation: whisper?.escalation
				? { reason: whisper.escalation.reason }
				: null,
			workflow: whisper?.workflow
				? {
						workflowType: whisper.workflow.workflowType,
						status: whisper.workflow.status,
						...(whisper.workflow.phaseName
							? { phaseName: whisper.workflow.phaseName }
							: {}),
					}
				: null,
			live: wt?.sessionId != null,
			updatedAt: wt?.updatedAt ?? 0,
			recent: wt?.recent ?? [],
		});
	}

	// Fail closed: a structure that drifts from the shared contract must not ship.
	return SessionReportResult.parse({
		mode: input.session?.app.mode ?? "loading",
		focus: focusedId,
		sessions,
	});
}

// The workflow fragment, reproduced from the structured entry. Escalation wins
// over a running workflow — exactly the precedence in assembleObserve's
// workflowFragment.
function workflowFragmentFromEntry(entry: SessionEntry): string {
	if (entry.escalation) return `workflow escalated: ${entry.escalation.reason}`;
	const wf = entry.workflow;
	if (!wf) return "";
	const phase = wf.phaseName ? ` ${wf.phaseName}` : "";
	return `${wf.workflowType} ${wf.status}${phase}`.trim();
}

// The transition tail, reproduced from the structured entry's `recent` history —
// identical to assembleObserve's recentFragment.
function recentFragmentFromEntry(recent: SessionEntry["recent"]): string {
	if (recent.length === 0) return "";
	const parts = recent.map((r) => {
		const detail = [r.summary, r.source].filter(Boolean).join("; ");
		return detail ? `${r.from}→${r.to} (${detail})` : `${r.from}→${r.to}`;
	});
	return `recent: ${parts.join(", ")}`;
}

// Render Samantha's spoken report FROM the canonical structure. Byte-for-byte
// identical to renderReport(assembleObserve(input)) for every field the
// structure models — provider, attention, summary, task, next, reviews,
// workflow/escalation, the recent: tail, the focus marker, the headline, and
// the per-worktree ordering. No speech drift.
export function renderReportText(report: SessionReportResult): string {
	const focusBranch =
		report.sessions.find((s) => s.worktreeId === report.focus)?.branch ?? null;
	const count = report.sessions.length;
	const head = `[${report.mode}]${focusBranch ? ` focus ${focusBranch}` : ""}`;
	const digest = report.sessions.map((s) => `${s.branch} ${s.attention}`);
	const summary =
		count === 0
			? `${head} — no active sessions`
			: `${head} — ${count} session${count === 1 ? "" : "s"}: ${digest.join(", ")}`;
	if (count === 0) return summary;

	const lines = report.sessions.map((s) => {
		const fields = [
			s.provider ?? "",
			s.attention,
			s.summary,
			s.task ? `task: ${s.task}` : "",
			s.nextAction ? `next: ${s.nextAction}` : "",
			s.reviewCount > 0 ? `${s.reviewCount} reviews` : "",
			workflowFragmentFromEntry(s),
			recentFragmentFromEntry(s.recent),
		].filter((f) => f.length > 0);
		const prefix = s.worktreeId === report.focus ? "★ " : "";
		return `${s.repo}/${s.branch}: ${prefix}${fields.join(" · ")}`;
	});
	return [summary, ...lines].join("\n");
}
