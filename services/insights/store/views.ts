import type Database from "better-sqlite3";
import type { Completeness } from "./coverage.js";
import { getCompleteness } from "./coverage.js";
import { utcDaysInRange } from "./time.js";

export type { Completeness } from "./coverage.js";

export interface WhisperRunRow {
	runId: string;
	collabId: string;
	repoId: string | null;
	workspaceRel: string | null;
	workflowType: string;
	status: string;
	haltReason: string | null;
	startedAt: number | null;
	endedAt: number | null;
	durationMs: number | null;
	phaseCount: number;
}

interface WhisperRunRawRow {
	run_id: string;
	collab_id: string;
	repo_id: string | null;
	workspace_rel: string | null;
	workflow_type: string;
	status: string;
	halt_reason: string | null;
	started_at: number | null;
	ended_at: number | null;
	duration_ms: number | null;
	phase_count: number;
}

export function getWhisperRuns(
	db: Database.Database,
	range: { fromMs: number; toMs: number },
): { runs: WhisperRunRow[]; completeness: Completeness } {
	const rows = db
		.prepare(
			"SELECT * FROM whisper_runs WHERE started_at >= ? AND started_at < ? ORDER BY started_at",
		)
		.all(range.fromMs, range.toMs) as WhisperRunRawRow[];
	const runs: WhisperRunRow[] = rows.map((r) => ({
		runId: r.run_id,
		collabId: r.collab_id,
		repoId: r.repo_id,
		workspaceRel: r.workspace_rel,
		workflowType: r.workflow_type,
		status: r.status,
		haltReason: r.halt_reason,
		startedAt: r.started_at,
		endedAt: r.ended_at,
		durationMs: r.duration_ms,
		phaseCount: r.phase_count,
	}));
	const completeness = getCompleteness(
		db,
		"whisper-archiver",
		utcDaysInRange(range.fromMs, range.toMs),
	);
	return { runs, completeness };
}
