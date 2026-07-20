import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createInsightsWorkerCore } from "../../../services/insights/insights-worker-core.js";
import { insertObservation } from "../../../services/insights/store/observations.js";
import { migrate } from "../../../services/insights/store/schema.js";
import type { InsightsWorkerToMain } from "../../../services/insights/worker-protocol.js";

function stubReader(collabs: string[] = []) {
	return {
		listCollabIds: () => collabs,
		readAllWorkflows: () => [],
		readSchemaVersion: () => 7,
	};
}

describe("insights worker core", () => {
	it("ticks: emits status with firstCaptureAt and a one-time firstCapture", () => {
		const db = new Database(":memory:");
		migrate(db);
		const posted: InsightsWorkerToMain[] = [];
		const now = 1000;
		// Seed one observation so a tick's write sets first_capture_at deterministically:
		const reader = {
			listCollabIds: () => ["c1"],
			readAllWorkflows: () => [
				{
					workflowId: "wf1",
					collabId: "c1",
					workspaceRoot: "/tmp/repo",
					workflowType: "sdd",
					status: "done",
					haltReason: null,
					createdAt: "2026-07-19T00:00:00Z",
					updatedAt: "2026-07-19T00:01:00Z",
					phases: [],
				},
			],
			readSchemaVersion: () => 7,
		};
		const core = createInsightsWorkerCore({
			db,
			reader,
			now: () => now,
			post: (m) => posted.push(m),
		});
		core.tick();
		const status = posted.find(
			(m): m is Extract<InsightsWorkerToMain, { kind: "status" }> =>
				m.kind === "status",
		);
		expect(status?.status.firstCaptureAt).toBe(now);
		expect(posted.filter((m) => m.kind === "firstCapture")).toHaveLength(1);
		core.tick(); // second tick: no second firstCapture
		expect(posted.filter((m) => m.kind === "firstCapture")).toHaveLength(1);
	});

	it("answers a query with whisper runs and acks closeStore", () => {
		const db = new Database(":memory:");
		migrate(db);
		insertObservation(db, {
			eventId: "w1",
			kind: "whisper.workflow",
			source: "whisper-archiver",
			subjectId: "wf1",
			eventTs: 1000,
			tsPrecision: "exact",
			occurredStart: 500,
			occurredEnd: 1000,
			parserVersion: 1,
			schemaVersion: 7,
			ingestedAt: 1,
			repoId: "r",
			workspaceRel: "",
			payload: {
				collab_id: "c1",
				workflow_type: "sdd",
				status: "done",
				halt_reason: null,
				workspace_label: "wt",
			},
		});
		const posted: InsightsWorkerToMain[] = [];
		const core = createInsightsWorkerCore({
			db,
			reader: stubReader(),
			now: () => 1,
			post: (m) => posted.push(m),
		});
		core.handleMessage({
			kind: "query",
			requestId: "q1",
			query: { name: "whisperRuns", range: { fromMs: 0, toMs: 10_000 } },
		});
		const res = posted.find(
			(m): m is Extract<InsightsWorkerToMain, { kind: "queryResult" }> =>
				m.kind === "queryResult",
		);
		expect(res?.requestId).toBe("q1");
		expect(res?.result.runs).toHaveLength(1);

		const closeSpy = vi.spyOn(db, "close");
		core.handleMessage({ kind: "closeStore", requestId: "c1" });
		expect(closeSpy).toHaveBeenCalled();
		expect(
			posted.some((m) => m.kind === "storeClosed" && m.requestId === "c1"),
		).toBe(true);
	});
});
