import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../services/insights/store/schema.js";
import {
	insertObservation,
	type ObservationInput,
} from "../../../services/insights/store/observations.js";
import { markCoverage } from "../../../services/insights/store/coverage.js";
import { getMeta, setMetaOnce } from "../../../services/insights/store/meta.js";
import {
	OBSERVATION_RETENTION_DAYS,
	pruneRetention,
} from "../../../services/insights/retention.js";

const fresh = () => {
	const db = new Database(":memory:");
	migrate(db);
	return db;
};

const NOW = Date.parse("2026-07-19T00:00:00.000Z");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const obs = (eventId: string, ts: number): ObservationInput => ({
	eventId,
	kind: "whisper.workflow",
	source: "whisper-archiver",
	subjectId: eventId,
	eventTs: ts,
	tsPrecision: "exact",
	occurredStart: ts,
	occurredEnd: ts,
	parserVersion: 1,
	schemaVersion: 7,
	ingestedAt: ts,
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

describe("meta + retention", () => {
	it("setMetaOnce writes only the first value", () => {
		const db = fresh();
		expect(setMetaOnce(db, "first_capture_at", "111")).toBe(true);
		expect(setMetaOnce(db, "first_capture_at", "222")).toBe(false);
		expect(getMeta(db, "first_capture_at")).toBe("111");
	});

	it("prunes observations AND coverage older than the horizon in lockstep", () => {
		const db = fresh();
		const oldTs = NOW - (OBSERVATION_RETENTION_DAYS + 5) * 86_400_000;
		const recentTs = NOW - 1 * 86_400_000;
		insertObservation(db, obs("old", oldTs));
		insertObservation(db, obs("recent", recentTs));
		markCoverage(db, {
			source: "whisper-archiver",
			day: day(oldTs),
			complete: true,
		});
		markCoverage(db, {
			source: "whisper-archiver",
			day: day(recentTs),
			complete: true,
		});
		pruneRetention(db, NOW);
		expect(
			db.prepare("SELECT event_id FROM observations ORDER BY event_id").all(),
		).toEqual([{ event_id: "recent" }]);
		expect(db.prepare("SELECT day FROM coverage ORDER BY day").all()).toEqual([
			{ day: day(recentTs) },
		]);
	});
});
