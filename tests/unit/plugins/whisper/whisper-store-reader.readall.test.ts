import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { WhisperStoreReader } from "../../../../services/plugins/whisper/whisper-store-reader.js";
import { makeWhisperFixtureDb } from "../helpers/make-whisper-fixture-db.js";

const dirs: string[] = [];
const tmp = () => {
	const d = mkdtempSync(join(tmpdir(), "wsr-"));
	dirs.push(d);
	return join(d, "state.db");
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Read-only introspection helpers for the "source unchanged" regression test.
const version = (p: string) => {
	const d = new Database(p, { readonly: true });
	const v = d.pragma("user_version", { simple: true });
	d.close();
	return v;
};
const dump = (p: string) => {
	const d = new Database(p, { readonly: true });
	const r = {
		collab: d.prepare("SELECT * FROM collab ORDER BY collab_id").all(),
		workflows: d.prepare("SELECT * FROM workflows ORDER BY workflow_id").all(),
		phases: d
			.prepare("SELECT * FROM workflow_phases ORDER BY phase_run_id")
			.all(),
	};
	d.close();
	return r;
};

describe("readAllWorkflows", () => {
	it("returns every run for a collab with phases carrying phaseRunId (dup names distinct)", () => {
		const path = tmp();
		makeWhisperFixtureDb(path, {
			schemaVersion: 7,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: "/tmp/repo",
					display_name: "r",
					status: "active",
				},
			],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					workflow_type: "spec-driven-development",
					status: "done",
					current_phase_index: 1,
					created_at: "2026-07-19T00:00:00.000Z",
					updated_at: "2026-07-19T00:05:00.000Z",
				},
			],
			phases: [
				{
					phase_run_id: "wf1:pa",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "impl",
					chain_id: "ch1",
					started_at: "2026-07-19T00:00:00.000Z",
					ended_at: "2026-07-19T00:02:00.000Z",
					outcome: "ok",
				},
				{
					phase_run_id: "wf1:pb",
					workflow_id: "wf1",
					phase_index: 1,
					phase_name: "impl",
					chain_id: "ch1",
					started_at: "2026-07-19T00:03:00.000Z",
					ended_at: "2026-07-19T00:05:00.000Z",
					outcome: "ok",
				},
			],
		});
		const reader = new WhisperStoreReader(path);
		expect(reader.listCollabIds()).toEqual(["c1"]);
		const runs = reader.readAllWorkflows("c1");
		expect(runs).toHaveLength(1);
		expect(runs[0].workspaceRoot).toBe("/tmp/repo");
		expect(runs[0].phases.map((p) => p.phaseRunId)).toEqual([
			"wf1:pa",
			"wf1:pb",
		]);
	});

	it("never writes to the source DB (user_version, rows, and file bytes unchanged after reads)", () => {
		const path = tmp();
		makeWhisperFixtureDb(path, {
			schemaVersion: 7,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: "/tmp/repo",
					display_name: "r",
					status: "active",
				},
			],
			workflows: [
				{
					workflow_id: "wf1",
					collab_id: "c1",
					workflow_type: "spec-driven-development",
					status: "done",
					current_phase_index: 0,
					created_at: "2026-07-19T00:00:00.000Z",
					updated_at: "2026-07-19T00:01:00.000Z",
				},
			],
			phases: [
				{
					phase_run_id: "wf1:pa",
					workflow_id: "wf1",
					phase_index: 0,
					phase_name: "impl",
					chain_id: "ch1",
					started_at: "2026-07-19T00:00:00.000Z",
					ended_at: "2026-07-19T00:01:00.000Z",
					outcome: "ok",
				},
			],
		});
		const before = {
			v: version(path),
			rows: dump(path),
			bytes: readFileSync(path),
		};
		const reader = new WhisperStoreReader(path);
		reader.listCollabIds();
		reader.readAllWorkflows("c1");
		reader.readAllWorkflows("c1"); // repeat — still no writes
		const after = {
			v: version(path),
			rows: dump(path),
			bytes: readFileSync(path),
		};
		expect(after.v).toBe(before.v);
		expect(after.rows).toEqual(before.rows);
		expect(after.bytes.equals(before.bytes)).toBe(true); // byte-identical main file: readonly open, no journal/WAL write
	});

	it("refuses an out-of-range schema (returns [])", () => {
		const path = tmp();
		makeWhisperFixtureDb(path, {
			schemaVersion: 999,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: "/tmp/r",
					display_name: "r",
					status: "active",
				},
			],
			workflows: [],
			phases: [],
		});
		expect(new WhisperStoreReader(path).readAllWorkflows("c1")).toEqual([]);
	});

	it("returns [] for an absent DB", () => {
		expect(
			new WhisperStoreReader("/no/such/state.db").readAllWorkflows("c1"),
		).toEqual([]);
	});
});
