import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../../../services/insights/store/schema.js";
import {
	insertObservation,
	type ObservationInput,
} from "../../../../services/insights/store/observations.js";

const base = (over: Partial<ObservationInput> = {}): ObservationInput => ({
	eventId: "e1",
	kind: "whisper.workflow",
	source: "whisper-archiver",
	subjectId: "wf1",
	eventTs: 1000,
	tsPrecision: "exact",
	occurredStart: 900,
	occurredEnd: 1000,
	parserVersion: 1,
	schemaVersion: 7,
	ingestedAt: 2000,
	origin: "n/a",
	repoId: "abc123",
	workspaceRel: "",
	branch: "main",
	payload: {
		collab_id: "c1",
		workflow_type: "sdd",
		status: "done",
		halt_reason: null,
		workspace_label: "wt",
	},
	...over,
});

const fresh = () => {
	const db = new Database(":memory:");
	migrate(db);
	return db;
};

describe("insertObservation", () => {
	it("inserts a valid observation once and dedupes by event_id", () => {
		const db = fresh();
		expect(insertObservation(db, base())).toBe(true);
		expect(insertObservation(db, base())).toBe(false); // same event_id
		expect(db.prepare("SELECT COUNT(*) c FROM observations").get()).toEqual({
			c: 1,
		});
	});

	it("appends a new row for a changed snapshot (new event_id)", () => {
		const db = fresh();
		insertObservation(db, base());
		insertObservation(
			db,
			base({
				eventId: "e2",
				payload: {
					collab_id: "c1",
					workflow_type: "sdd",
					status: "running",
					halt_reason: null,
					workspace_label: "wt",
				},
			}),
		);
		expect(db.prepare("SELECT COUNT(*) c FROM observations").get()).toEqual({
			c: 2,
		});
	});

	it("rejects an unregistered kind", () => {
		expect(() =>
			insertObservation(fresh(), base({ kind: "nope" })),
		).toThrow(/unregistered/);
	});

	it("rejects an unknown payload key (strict allowlist) — e.g. spec_path", () => {
		expect(() =>
			insertObservation(
				fresh(),
				base({
					payload: {
						collab_id: "c1",
						workflow_type: "sdd",
						status: "done",
						halt_reason: null,
						workspace_label: "wt",
						spec_path: "/abs/spec.md",
					},
				}),
			),
		).toThrow();
	});

	it("rejects an absolute-path value in ANY persisted field (eventId/source/column/payload leaf)", () => {
		expect(() =>
			insertObservation(fresh(), base({ eventId: "/abs/evt" })),
		).toThrow(/absolute/);
		expect(() =>
			insertObservation(fresh(), base({ source: "/abs/src" })),
		).toThrow(/absolute/);
		expect(() =>
			insertObservation(fresh(), base({ workspaceRel: "/Users/x/repo" })),
		).toThrow(/absolute/);
		expect(() =>
			insertObservation(
				fresh(),
				base({
					payload: {
						collab_id: "c1",
						workflow_type: "sdd",
						status: "done",
						halt_reason: null,
						workspace_label: "/Users/x/wt",
					},
				}),
			),
		).toThrow(/absolute/);
	});
});
