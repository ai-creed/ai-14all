import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getMeta, setMeta } from "../../../services/insights/store/meta.js";
import { migrate } from "../../../services/insights/store/schema.js";
import { archiveOnce } from "../../../services/insights/whisper/archiver.js";
import { WhisperStoreReader } from "../../../services/plugins/whisper/whisper-store-reader.js";
import { makeWhisperFixtureDb } from "../plugins/helpers/make-whisper-fixture-db.js";

function whisperFixture(
	dbPath: string,
	updatedAt: string,
	phaseEndedAt: string,
): void {
	makeWhisperFixtureDb(dbPath, {
		schemaVersion: 6,
		collabs: [{ collab_id: "c1", workspace_root: "/repo" }],
		workflows: [
			{
				workflow_id: "w1",
				collab_id: "c1",
				status: "done",
				created_at: "2026-07-01T00:00:00.000Z",
				updated_at: updatedAt,
			},
		],
		phases: [
			{
				phase_run_id: "p1",
				workflow_id: "w1",
				phase_index: 0,
				phase_name: "impl",
				chain_id: "ch1",
				started_at: "2026-07-01T00:10:00.000Z",
				ended_at: phaseEndedAt,
				outcome: "done",
			},
		],
	});
}

describe("readAllWorkflows sinceUpdatedAt", () => {
	it("full read when since is absent or null (back-compat)", () => {
		const dir = mkdtempSync(join(tmpdir(), "ins-wm-a-"));
		const db = join(dir, "state.db");
		whisperFixture(db, "2026-07-01T01:00:00.000Z", "2026-07-01T00:50:00.000Z");
		const reader = new WhisperStoreReader(db);
		expect(reader.readAllWorkflows("c1")).toHaveLength(1);
		expect(reader.readAllWorkflows("c1", null)).toHaveLength(1);
	});

	it("skips a run whose updated_at and phases are all before since", () => {
		const dir = mkdtempSync(join(tmpdir(), "ins-wm-b-"));
		const db = join(dir, "state.db");
		whisperFixture(db, "2026-07-01T01:00:00.000Z", "2026-07-01T00:50:00.000Z");
		const reader = new WhisperStoreReader(db);
		expect(
			reader.readAllWorkflows("c1", "2026-07-02T00:00:00.000Z"),
		).toHaveLength(0);
	});

	it("selects a run via phase activity even when updated_at is before since (coupling caveat)", () => {
		const dir = mkdtempSync(join(tmpdir(), "ins-wm-c-"));
		const db = join(dir, "state.db");
		// workflow.updated_at stays old; a phase closed later without bumping it
		whisperFixture(db, "2026-07-01T01:00:00.000Z", "2026-07-03T00:00:00.000Z");
		const reader = new WhisperStoreReader(db);
		expect(
			reader.readAllWorkflows("c1", "2026-07-02T00:00:00.000Z"),
		).toHaveLength(1);
	});
});

describe("archiveOnce watermark", () => {
	it("setMeta upserts (overwrites); setMetaOnce would not", () => {
		const db = new Database(":memory:");
		migrate(db);
		setMeta(db, "k", "v1");
		expect(getMeta(db, "k")).toBe("v1");
		setMeta(db, "k", "v2");
		expect(getMeta(db, "k")).toBe("v2");
	});

	it("advances the watermark and re-runs cheaply (no new rows)", () => {
		const dir = mkdtempSync(join(tmpdir(), "ins-wm-d-"));
		const wdb = join(dir, "state.db");
		whisperFixture(wdb, "2026-07-01T01:00:00.000Z", "2026-07-01T00:50:00.000Z");
		const reader = new WhisperStoreReader(wdb);
		const ins = new Database(":memory:");
		migrate(ins);

		const r1 = archiveOnce(ins, reader, { nowMs: 1000 });
		expect(r1.workflows).toBe(1);
		// watermark = max(updated_at=01:00, phase ended_at=00:50) = 01:00
		expect(getMeta(ins, "whisper_watermark")).toBe("2026-07-01T01:00:00.000Z");

		const before = (
			ins.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number }
		).c;
		const r2 = archiveOnce(ins, reader, { nowMs: 2000 });
		// The boundary run (updated_at === watermark) MUST be re-read under `>=`.
		// This is the regression guard: a change to a forbidden `>` would skip it,
		// making r2.workflows 0 while the count below still matched — passing falsely.
		expect(r2.workflows).toBe(1);
		expect(r2.phases).toBe(1);
		const after = (
			ins.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number }
		).c;
		expect(after).toBe(before); // boundary re-read, all ON CONFLICT no-ops
	});
});
