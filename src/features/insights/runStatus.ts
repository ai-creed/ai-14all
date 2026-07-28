// Total, shared run-status projection (spec §4.9). `WhisperRunRow.status` is
// deliberately `string`, not a union, so this projection must land every
// possible value in exactly one outcome class — never drop or silently
// mislabel an in-flight, canceled, or unknown-status run. This is the SINGLE
// projection used by the stat tiles, the runs chart, and buildWorkspaceRows.

export type RunOutcome = "done" | "halted" | "failed" | "active" | "other";
export type RunOutcomeCounts = Record<RunOutcome, number>;

export function projectRunStatus(status: string): RunOutcome {
	switch (status) {
		case "done":
			return "done";
		case "halted":
		case "canceled": // deliberately-stopped family; tooltip names it
			return "halted";
		case "failed":
			return "failed";
		case "running":
		case "paused":
			return "active"; // in-flight, not an outcome
		default:
			return "other";
	}
}

export function emptyRunCounts(): RunOutcomeCounts {
	return { done: 0, halted: 0, failed: 0, active: 0, other: 0 };
}

export function countRunOutcomes(statuses: Iterable<string>): RunOutcomeCounts {
	const counts = emptyRunCounts();
	for (const status of statuses) {
		counts[projectRunStatus(status)] += 1;
	}
	return counts;
}

export function groupRunsByRepo(
	runs: Array<{ repoId: string | null; status: string }>,
): Map<string | null, RunOutcomeCounts> {
	const groups = new Map<string | null, RunOutcomeCounts>();
	for (const run of runs) {
		let counts = groups.get(run.repoId);
		if (!counts) {
			counts = emptyRunCounts();
			groups.set(run.repoId, counts);
		}
		counts[projectRunStatus(run.status)] += 1;
	}
	return groups;
}

// "X done · Y halted · Z failed[ · N active][ · N other]" — the first three
// classes always render; active/other append only when non-zero (`·` is
// U+00B7 MIDDLE DOT).
export function runsBreakdownLabel(c: RunOutcomeCounts): string {
	const parts = [`${c.done} done`, `${c.halted} halted`, `${c.failed} failed`];
	if (c.active > 0) parts.push(`${c.active} active`);
	if (c.other > 0) parts.push(`${c.other} other`);
	return parts.join(" · ");
}
