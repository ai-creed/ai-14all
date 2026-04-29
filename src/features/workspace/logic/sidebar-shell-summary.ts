import type { ProcessSession } from "../../../../shared/models/process-session";

export type SidebarShellState = "actionRequired" | "active" | "idle" | "exited";

export type SidebarShellRow = {
	id: string;
	label: string;
	state: SidebarShellState;
	context: string;
	lastActivityAt: number | null;
};

export type WorktreeProcessSummary = {
	rows: SidebarShellRow[];
	overflowCount: number;
};

const ACTIVE_WINDOW_MS = 10_000;
const severityRank: Record<SidebarShellState, number> = {
	actionRequired: 3,
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
export function formatQuietAge(ageMs: number): string {
	return `quiet for ${Math.max(1, Math.floor(ageMs / 1000))}s`;
}

function deriveState(
	process: Pick<ProcessSession, "status" | "attentionState" | "lastActivityAt">,
	now: number,
): SidebarShellState {
	if (process.status !== "running") return "exited";
	if (process.attentionState === "actionRequired") return "actionRequired";
	if (
		process.lastActivityAt != null &&
		now - process.lastActivityAt <= ACTIVE_WINDOW_MS
	) {
		return "active";
	}
	return "idle";
}

function deriveContext(
	process: Pick<
		ProcessSession,
		"status" | "exitCode" | "lastActivityAt" | "lastOutputPreview"
	>,
	state: SidebarShellState,
	now: number,
): string {
	if (state === "exited") return deriveExitedContext(process);
	if (state === "idle") {
		return formatQuietAge(
			process.lastActivityAt == null
				? ACTIVE_WINDOW_MS
				: now - process.lastActivityAt,
		);
	}
	return process.lastOutputPreview ?? "";
}

export function buildWorktreeProcessSummary(
	processes: Array<
		Pick<
			ProcessSession,
			| "id"
			| "label"
			| "status"
			| "attentionState"
			| "lastActivityAt"
			| "lastOutputPreview"
			| "exitCode"
		>
	>,
	now: number,
	maxRows = 3,
): WorktreeProcessSummary {
	const rows = processes
		.map((process) => {
			const state = deriveState(process, now);
			return {
				id: process.id,
				label: process.label,
				state,
				context: deriveContext(process, state, now),
				lastActivityAt: process.lastActivityAt,
			};
		})
		.sort((left, right) => {
			const severityDelta =
				severityRank[right.state] - severityRank[left.state];
			if (severityDelta !== 0) return severityDelta;
			return (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0);
		});

	return {
		rows: rows.slice(0, maxRows),
		overflowCount: Math.max(0, rows.length - maxRows),
	};
}
