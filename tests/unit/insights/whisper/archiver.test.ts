import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { getMeta } from "../../../../services/insights/store/meta.js";
import { migrate } from "../../../../services/insights/store/schema.js";
import { getWhisperRuns } from "../../../../services/insights/store/views.js";
import { archiveOnce } from "../../../../services/insights/whisper/archiver.js";
import { WhisperStoreReader } from "../../../../services/plugins/whisper/whisper-store-reader.js";
import { makeWhisperFixtureDb } from "../../plugins/helpers/make-whisper-fixture-db.js";

const dirs: string[] = [];

// resolveWorkspaceIdentity needs a real repo dir (a `.git` dir holding HEAD) so
// the collab's workspace_root resolves to an opaque repo_id + repo-relative path.
const mkRepo = (): string => {
	const d = mkdtempSync(join(tmpdir(), "arch-"));
	dirs.push(d);
	mkdirSync(join(d, ".git"));
	writeFileSync(join(d, ".git", "HEAD"), "ref: refs/heads/main\n");
	return d;
};

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// NOTE: makeWhisperFixtureDb takes snake_case rows (the read contract's column
// names), not the camelCase the reader emits.
function fixture(repo: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "arch-db-")), "state.db");
	dirs.push(path);
	makeWhisperFixtureDb(path, {
		schemaVersion: 7,
		collabs: [
			{
				collab_id: "c1",
				workspace_root: repo,
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
	return path;
}

describe("archiveOnce", () => {
	it("archives runs+phases, is idempotent, and derives a correct run", () => {
		const repo = mkRepo();
		const reader = new WhisperStoreReader(fixture(repo));
		const db = new Database(":memory:");
		migrate(db);
		const now = Date.parse("2026-07-19T01:00:00.000Z");
		const r1 = archiveOnce(db, reader, { nowMs: now });
		expect(r1.workflows).toBe(1);
		expect(r1.phases).toBe(2);
		archiveOnce(db, reader, { nowMs: now }); // re-run — same content-hash ids
		expect(
			(db.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(3); // 1 wf + 2 phases, no dupes

		const { runs, completeness } = getWhisperRuns(db, {
			fromMs: Date.parse("2026-07-19T00:00:00Z"),
			toMs: Date.parse("2026-07-20T00:00:00Z"),
		});
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("done");
		expect(runs[0].phaseCount).toBe(2);
		expect(runs[0].durationMs).toBe(5 * 60_000); // start 00:00 → terminal 00:05
		expect(completeness).toBe("complete");

		// Privacy: opaque repo_id, no absolute path stored anywhere.
		const row = db
			.prepare("SELECT repo_id, workspace_rel FROM observations LIMIT 1")
			.get() as { repo_id: string; workspace_rel: string };
		expect(row.repo_id).not.toContain("/");
		const payloads = db.prepare("SELECT payload FROM observations").all() as {
			payload: string;
		}[];
		expect(payloads.every((p) => !p.payload.includes("/tmp/"))).toBe(true);

		// first_capture_at set exactly once, to the first-run nowMs.
		expect(getMeta(db, "first_capture_at")).toBe(String(now));
	});

	it("stamps rows with the source DB's real user_version (v6, not a hardcoded default)", () => {
		const repo = mkRepo();
		const path = join(mkdtempSync(join(tmpdir(), "arch-v6-")), "state.db");
		dirs.push(path);
		makeWhisperFixtureDb(path, {
			schemaVersion: 6,
			collabs: [
				{
					collab_id: "c1",
					workspace_root: repo,
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
		const db = new Database(":memory:");
		migrate(db);
		archiveOnce(db, new WhisperStoreReader(path), {
			nowMs: Date.parse("2026-07-19T01:00:00.000Z"),
		});
		expect(
			db.prepare("SELECT DISTINCT schema_version FROM observations").all(),
		).toEqual([{ schema_version: 6 }]);
	});

	it("no-ops on an out-of-range / absent whisper DB", () => {
		const reader = new WhisperStoreReader("/no/such/state.db");
		const db = new Database(":memory:");
		migrate(db);
		const r = archiveOnce(db, reader, { nowMs: Date.now() });
		expect(r.workflows).toBe(0);
		expect(getMeta(db, "first_capture_at")).toBeNull();
	});
});
