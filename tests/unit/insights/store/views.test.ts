import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import {
	insertObservation,
	type ObservationInput,
} from "../../../../services/insights/store/observations.js";
import { markCoverage } from "../../../../services/insights/store/coverage.js";
import { getWhisperRuns } from "../../../../services/insights/store/views.js";

const fresh = () => {
	const db = new Database(":memory:");
	migrate(db);
	return db;
};

function wf(
	over: Partial<ObservationInput> & {
		payload?: Record<string, unknown>;
	} = {},
): ObservationInput {
	return {
		eventId: over.eventId ?? "w",
		kind: "whisper.workflow",
		source: "whisper-archiver",
		subjectId: over.subjectId ?? "wf1",
		eventTs: over.eventTs ?? 1000,
		tsPrecision: "exact",
		occurredStart: over.occurredStart ?? 500,
		occurredEnd: over.occurredEnd ?? null,
		parserVersion: 1,
		schemaVersion: 7,
		ingestedAt: over.ingestedAt ?? 1,
		repoId: "r",
		workspaceRel: "",
		payload: over.payload ?? {
			collab_id: "c1",
			workflow_type: "sdd",
			status: "running",
			halt_reason: null,
			workspace_label: "wt",
		},
	} as ObservationInput;
}
function ph(
	subjectId: string,
	runId: string,
	over: Partial<ObservationInput> & {
		payload?: Record<string, unknown>;
	} = {},
): ObservationInput {
	return {
		eventId: over.eventId ?? `p-${subjectId}-${over.eventTs ?? 0}`,
		kind: "whisper.phase",
		source: "whisper-archiver",
		subjectId,
		eventTs: over.eventTs ?? 900,
		tsPrecision: "exact",
		occurredStart: over.occurredStart ?? 600,
		occurredEnd: over.occurredEnd ?? null,
		parserVersion: 1,
		schemaVersion: 7,
		ingestedAt: over.ingestedAt ?? 1,
		repoId: "r",
		workspaceRel: "",
		payload: over.payload ?? {
			run_id: runId,
			phase_run_id: subjectId,
			phase_name: "impl",
			phase_index: 0,
			outcome: null,
			chain_id: null,
		},
	} as ObservationInput;
}

describe("getWhisperRuns / whisper_runs view", () => {
	it("collapses running→terminal to one row with duration from the workflow terminal ts", () => {
		const db = fresh();
		insertObservation(db, wf({ eventId: "w1", eventTs: 1000, ingestedAt: 1 }));
		insertObservation(
			db,
			wf({
				eventId: "w2",
				eventTs: 2000,
				ingestedAt: 2,
				occurredEnd: 2000,
				payload: {
					collab_id: "c1",
					workflow_type: "sdd",
					status: "done",
					halt_reason: null,
					workspace_label: "wt",
				},
			}),
		);
		const { runs } = getWhisperRuns(db, { fromMs: 0, toMs: 10_000 });
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("done");
		expect(runs[0].durationMs).toBe(1500); // 2000 - 500
	});

	it("counts a running→ended phase once, and two same-named phases as two", () => {
		const db = fresh();
		insertObservation(
			db,
			wf({
				eventId: "w1",
				eventTs: 1000,
				occurredEnd: 1000,
				payload: {
					collab_id: "c1",
					workflow_type: "sdd",
					status: "done",
					halt_reason: null,
					workspace_label: "wt",
				},
			}),
		);
		insertObservation(
			db,
			ph("wf1:pa", "wf1", { eventId: "pa1", eventTs: 700, ingestedAt: 1 }), // running
		);
		insertObservation(
			db,
			ph("wf1:pa", "wf1", {
				eventId: "pa2",
				eventTs: 900,
				ingestedAt: 2,
				occurredEnd: 900, // ended (same phase_run_id)
				payload: {
					run_id: "wf1",
					phase_run_id: "wf1:pa",
					phase_name: "impl",
					phase_index: 0,
					outcome: "ok",
					chain_id: null,
				},
			}),
		);
		insertObservation(
			db,
			ph("wf1:pb", "wf1", {
				eventId: "pb1",
				eventTs: 950,
				ingestedAt: 3, // second phase, SAME name
				payload: {
					run_id: "wf1",
					phase_run_id: "wf1:pb",
					phase_name: "impl",
					phase_index: 1,
					outcome: "ok",
					chain_id: null,
				},
			}),
		);
		const { runs } = getWhisperRuns(db, { fromMs: 0, toMs: 10_000 });
		expect(runs[0].phaseCount).toBe(2);
	});

	it("applies half-open UTC start-time inclusion", () => {
		const db = fresh();
		insertObservation(
			db,
			wf({
				eventId: "w1",
				subjectId: "wf1",
				occurredStart: 1000,
				occurredEnd: 1000,
				payload: {
					collab_id: "c1",
					workflow_type: "sdd",
					status: "done",
					halt_reason: null,
					workspace_label: "wt",
				},
			}),
		);
		expect(getWhisperRuns(db, { fromMs: 1000, toMs: 2000 }).runs).toHaveLength(
			1,
		); // fromMs inclusive
		expect(getWhisperRuns(db, { fromMs: 0, toMs: 1000 }).runs).toHaveLength(0); // toMs exclusive
	});

	it("reports completeness from coverage and reverts to unknown once coverage is gone", () => {
		const db = fresh();
		const day = new Date(500).toISOString().slice(0, 10);
		insertObservation(
			db,
			wf({
				eventId: "w1",
				occurredStart: 500,
				occurredEnd: 500,
				payload: {
					collab_id: "c1",
					workflow_type: "sdd",
					status: "done",
					halt_reason: null,
					workspace_label: "wt",
				},
			}),
		);
		markCoverage(db, { source: "whisper-archiver", day, complete: true });
		expect(
			getWhisperRuns(db, { fromMs: 0, toMs: 86_400_000 }).completeness,
		).toBe("complete");
		db.prepare("DELETE FROM coverage").run();
		expect(
			getWhisperRuns(db, { fromMs: 0, toMs: 86_400_000 }).completeness,
		).toBe("unknown");
	});
});
