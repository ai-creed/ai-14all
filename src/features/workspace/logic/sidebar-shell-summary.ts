import {
	deriveStale,
	rankAgentAttention,
} from "../../terminals/logic/agent-attention";
import { STALE_THRESHOLD_MS } from "../../../../shared/models/agent-attention";
import type {
	AgentAttentionReasonsBySource,
	AgentAttentionState,
	AgentProvider,
} from "../../../../shared/models/agent-attention";
import type { ProcessSession } from "../../../../shared/models/process-session";

export type SidebarShellState =
	| "actionRequired"
	| "ready"
	| "active"
	| "idle"
	| "exited";

/** The display tier consumed by the sidebar's `data-attention` attribute. */
export type SidebarAttentionTier =
	| "actionRequired"
	| "ready"
	| "activity"
	| "idle";

export type SidebarShellRow = {
	id: string;
	label: string;
	state: SidebarShellState;
	context: string;
	lastActivityAt: number | null;
	hasFailedReason: boolean;
	provider: AgentProvider | null;
	// Task 13 (agent-resume manual affordance). Optional — undefined is treated
	// as "not pending" / "no resume data" by consumers — so the many existing
	// `SidebarShellRow` literals in tests and `buildWorktreeAttentionDisplay`
	// callers don't need updating for a feature that only applies to the
	// process-summary production path.
	resumePending?: boolean;
	resumeCommand?: string | null;
	terminalSessionId?: string | null;
};

export type WorktreeProcessSummary = {
	rows: SidebarShellRow[];
	overflowCount: number;
	/**
	 * The most-severe process across ALL processes (severity first, recency as
	 * tie-break), independent of `rows` ordering. `rows` is kept in stable
	 * creation order so the sidebar list does not shuffle when shells change
	 * state simultaneously; consumers that need the single most-important process
	 * (the worktree's overall dot/context) read this instead of `rows[0]`.
	 * Always populated by `buildWorktreeProcessSummary`; optional only so test
	 * fixtures that render rows directly need not restate it.
	 */
	topRow?: SidebarShellRow | null;
};

export type WorktreeAttentionDisplay = {
	state: SidebarShellState;
	context: string;
	source: "session" | "process";
};

const ACTIVE_WINDOW_MS = 10_000;
const severityRank: Record<SidebarShellState, number> = {
	actionRequired: 4,
	ready: 3,
	exited: 2,
	active: 1,
	idle: 0,
};

function deriveExitedContext(
	process: Pick<ProcessSession, "status" | "exitCode">,
): string {
	if (process.status === "restarting") return "restarting";
	if (process.status === "error") return "error";
	return process.exitCode != null ? `exit ${process.exitCode}` : "exit 0";
}

// restarting intentionally shares the exited dot/state; context text disambiguates it
export function formatRelativeQuiet(ageMs: number): string {
	const secs = Math.max(1, Math.floor(ageMs / 1000));
	if (secs < 60) return `quiet ${secs}s`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `quiet ${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `quiet ${hours}h`;
	return `quiet ${Math.floor(hours / 24)}d`;
}

export function formatQuietAge(ageMs: number): string {
	return formatRelativeQuiet(ageMs);
}

function deriveState(
	process: Pick<
		ProcessSession,
		"status" | "attentionState" | "lastActivityAt"
	> &
		Partial<Pick<ProcessSession, "agentAttentionClearedAt">>,
	now: number,
): SidebarShellState {
	if (process.status !== "running") return "exited";
	const lastActivityAt = process.lastActivityAt ?? null;
	if (process.attentionState === "actionRequired") {
		const clearedAt = process.agentAttentionClearedAt ?? null;
		// Retired if explicitly cleared after its last activity, OR quiet past the
		// staleness threshold (spec §4.2 gap 3 + STALE_THRESHOLD_MS). Compute both
		// explicitly: deriveStale conflates them (it returns false for a cleared
		// reason), so reusing it alone would keep a cleared process red.
		const cleared =
			clearedAt !== null &&
			(lastActivityAt === null || lastActivityAt <= clearedAt);
		const staleByAge =
			lastActivityAt !== null && now - lastActivityAt >= STALE_THRESHOLD_MS;
		if (!cleared && !staleByAge) return "actionRequired";
		// cleared or stale → retired, fall through to active/idle
	}
	if (lastActivityAt != null && now - lastActivityAt <= ACTIVE_WINDOW_MS) {
		return "active";
	}
	return "idle";
}

type ProcessRowInput = Pick<
	ProcessSession,
	| "id"
	| "label"
	| "status"
	| "attentionState"
	| "lastActivityAt"
	| "lastOutputPreview"
	| "exitCode"
> &
	Partial<
		Pick<
			ProcessSession,
			| "agentAttentionReasons"
			| "agentAttentionClearedAt"
			| "provider"
			| "resumePending"
			| "resumeCommand"
			| "terminalSessionId"
		>
	>;

function deriveAgentContext(
	process: Pick<ProcessSession, "lastActivityAt" | "status"> &
		Partial<
			Pick<ProcessSession, "agentAttentionReasons" | "agentAttentionClearedAt">
		>,
	now: number,
): string | null {
	const reasons = process.agentAttentionReasons ?? {};
	// stale only for running processes; lifecycle failed/ready still visible after exit
	const stale =
		process.status === "running" &&
		deriveStale(
			now,
			process.lastActivityAt,
			process.agentAttentionClearedAt ?? null,
		);
	const ranked = rankAgentAttention(reasons, stale);
	if (ranked === "idle") return null;
	if (ranked === "stale")
		return `stale: ${formatRelativeQuiet(now - (process.lastActivityAt ?? now))}`;
	// terminal reasons are only meaningful during active execution; after exit show lifecycle only
	const reason =
		process.status === "running"
			? (reasons.terminal ?? reasons.lifecycle ?? null)
			: (reasons.lifecycle ?? null);
	if (!reason) return ranked;
	return `${reason.state}: ${reason.summary}`;
}

function deriveContext(
	process: Pick<
		ProcessSession,
		"status" | "exitCode" | "lastActivityAt" | "lastOutputPreview"
	> &
		Partial<
			Pick<ProcessSession, "agentAttentionReasons" | "agentAttentionClearedAt">
		>,
	state: SidebarShellState,
	now: number,
): string {
	const agentContext = deriveAgentContext(process, now);

	if (state === "exited") {
		// lifecycle:failed/ready reasons visible after exit
		return agentContext ?? deriveExitedContext(process);
	}
	if (agentContext != null) return agentContext;
	if (state === "idle") {
		return formatQuietAge(
			process.lastActivityAt == null
				? ACTIVE_WINDOW_MS
				: now - process.lastActivityAt,
		);
	}
	return process.lastOutputPreview ?? "";
}

export function rollupWorkspaceAttention(
	tiers: SidebarAttentionTier[],
): "actionRequired" | "ready" | null {
	if (tiers.includes("actionRequired")) return "actionRequired";
	if (tiers.includes("ready")) return "ready";
	return null;
}

export function buildWorktreeProcessSummary(
	processes: Array<ProcessRowInput>,
	now: number,
	maxRows = 3,
): WorktreeProcessSummary {
	// Keep rows in input (creation) order — never reorder by state/recency, so the
	// sidebar list stays put while shells change status simultaneously.
	const rows = processes.map((process) => {
		const state = deriveState(process, now);
		const reasons = process.agentAttentionReasons ?? {};
		const hasFailedReason = Object.values(reasons).some(
			(r) => r != null && r.state === "failed",
		);
		return {
			id: process.id,
			label: process.label,
			state,
			context: deriveContext(process, state, now),
			lastActivityAt: process.lastActivityAt,
			hasFailedReason,
			provider: process.provider ?? null,
			resumePending: process.resumePending ?? false,
			resumeCommand: process.resumeCommand ?? null,
			terminalSessionId: process.terminalSessionId ?? null,
		};
	});

	// Most-severe process (severity first, recency as tie-break) across all rows,
	// computed without mutating row order.
	const topRow = rows.reduce<SidebarShellRow | null>((best, row) => {
		if (best === null) return row;
		const severityDelta = severityRank[row.state] - severityRank[best.state];
		if (severityDelta > 0) return row;
		if (severityDelta < 0) return best;
		return (row.lastActivityAt ?? 0) > (best.lastActivityAt ?? 0) ? row : best;
	}, null);

	return {
		rows: rows.slice(0, maxRows),
		overflowCount: Math.max(0, rows.length - maxRows),
		topRow,
	};
}

function agentStateToSidebarShell(
	state: AgentAttentionState,
): SidebarShellState {
	if (state === "waiting" || state === "failed") return "actionRequired";
	if (state === "ready") return "ready";
	if (state === "active") return "active";
	return "idle"; // stale, idle
}

export function buildWorktreeAttentionDisplay(input: {
	sessionAgentAttentionReasons: AgentAttentionReasonsBySource;
	processSummary: WorktreeProcessSummary;
	now: number;
	agentAttentionClearedAt?: number | null;
}): WorktreeAttentionDisplay {
	const clearedAt = input.agentAttentionClearedAt ?? null;

	// Only the authoritative session sources contribute to the worktree ring. An
	// action-required reason is retired when it is (a) reported at or before the
	// last terminal clear, or (b) stale — quiet past STALE_THRESHOLD_MS — so a
	// worktree stops showing red once it is finished OR has gone quiet (§4.2).
	const candidates: Array<{ state: SidebarShellState; context: string }> = [];
	for (const source of ["mcp", "workflow"] as const) {
		const r = input.sessionAgentAttentionReasons[source];
		if (!r) continue;
		const actionRequired = r.state === "waiting" || r.state === "failed";
		if (actionRequired) {
			const cleared = clearedAt !== null && r.reportedAt <= clearedAt;
			const staleByAge = input.now - r.reportedAt >= STALE_THRESHOLD_MS;
			if (cleared || staleByAge) continue;
		}
		candidates.push({
			state: agentStateToSidebarShell(r.state),
			context: `${r.state}: ${r.summary}`,
		});
	}

	const session = candidates.reduce<{
		state: SidebarShellState;
		context: string;
	} | null>(
		(best, c) =>
			best === null || severityRank[c.state] > severityRank[best.state]
				? c
				: best,
		null,
	);
	const sessionState: SidebarShellState = session?.state ?? "idle";
	const sessionContext = session?.context ?? "";

	const top = input.processSummary.topRow ?? null;
	const topState: SidebarShellState = top?.state ?? "idle";
	const topContext = top?.context ?? "";

	if (severityRank[sessionState] > severityRank[topState]) {
		return { state: sessionState, context: sessionContext, source: "session" };
	}
	return { state: topState, context: topContext, source: "process" };
}
