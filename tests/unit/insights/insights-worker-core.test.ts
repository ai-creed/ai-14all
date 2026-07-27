import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInsightsWorkerCore } from "../../../services/insights/insights-worker-core.js";
import {
	insertObservation,
	type ObservationInput,
} from "../../../services/insights/store/observations.js";
import { getMeta } from "../../../services/insights/store/meta.js";
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

describe("producerEvent (atomic write, ack after commit)", () => {
	const obs = (id: string, start: number, end: number) => ({
		eventId: id,
		kind: "app.focused",
		source: "app-focus-collector",
		subjectId: "app",
		eventTs: end,
		tsPrecision: "exact" as const,
		occurredStart: start,
		occurredEnd: end,
		parserVersion: 1,
		schemaVersion: 1,
		ingestedAt: 0,
		origin: "n/a" as const,
		appRunId: "run-1",
		repoId: null,
		workspaceRel: null,
		branch: null,
		payload: { reason: "poll" },
	});

	// File-backed (not :memory:) with a SEPARATE observer connection. This is what
	// makes "ack only after commit" genuinely observable: the writer connection
	// can see its OWN uncommitted transaction, so snapshotting through it would
	// pass even if `ack` were posted from inside the transaction. An independent
	// connection sees only committed state, so an ack-before-commit implementation
	// snapshots zero rows and fails. WAL lets the observer read without blocking
	// on the writer's open transaction.
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	function core() {
		const dir = mkdtempSync(join(tmpdir(), "iwc-ack-"));
		dirs.push(dir);
		const dbPath = join(dir, "insights.db");
		const db = new Database(dbPath);
		db.pragma("journal_mode = WAL");
		migrate(db);
		const observer = new Database(dbPath, { readonly: true });
		const posted: InsightsWorkerToMain[] = [];
		const atAck: Array<{ rows: number; marker: string | null }> = [];
		const c = createInsightsWorkerCore({
			db,
			reader: {
				listCollabIds: () => [],
				readAllWorkflows: () => [],
				readSchemaVersion: () => 1,
			},
			now: () => 7777,
			post: (m) => {
				posted.push(m);
				if (m.kind === "ack")
					atAck.push({
						rows: (
							observer.prepare("SELECT COUNT(*) c FROM observations").get() as {
								c: number;
							}
						).c,
						marker: getMeta(observer, "first_capture_at"),
					});
			},
		});
		return { db, observer, posted, atAck, c };
	}

	it("inserts once, stamps ingested_at, sets first_capture_at, and acks after commit", () => {
		const { db, posted, c } = core();
		c.handleMessage({
			kind: "producerEvent",
			eventId: "e1",
			observation: obs("e1", 1000, 2000),
		});
		const row = db
			.prepare(
				"SELECT ingested_at, app_run_id FROM observations WHERE event_id='e1'",
			)
			.get() as { ingested_at: number; app_run_id: string };
		expect(row.ingested_at).toBe(7777); // worker insert time, not main's placeholder
		expect(row.app_run_id).toBe("run-1");
		expect(getMeta(db, "first_capture_at")).toBe("7777");
		expect(posted).toContainEqual({ kind: "ack", eventId: "e1" });
	});

	it("replay after a lost ack adds no second row, keeps first_capture_at, and re-acks", () => {
		const { db, posted, c } = core();
		const msg = {
			kind: "producerEvent" as const,
			eventId: "e1",
			observation: obs("e1", 1000, 2000),
		};
		c.handleMessage(msg);
		posted.length = 0;
		c.handleMessage(msg); // the ack was lost — main replays the same event
		expect(
			(db.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(1);
		expect(getMeta(db, "first_capture_at")).toBe("7777");
		expect(posted).toContainEqual({ kind: "ack", eventId: "e1" });
	});

	it("the ack is posted only AFTER the row and the marker are both COMMITTED (independent connection)", () => {
		const { atAck, c } = core();
		c.handleMessage({
			kind: "producerEvent",
			eventId: "e1",
			observation: obs("e1", 1000, 2000),
		});
		expect(atAck).toHaveLength(1);
		// Observed through a connection that CANNOT see the writer's uncommitted
		// transaction: fails if ack is posted inside the transaction, or if
		// first_capture_at is written in a separate transaction after the ack.
		expect(atAck[0]).toEqual({ rows: 1, marker: "7777" });
	});

	it("rolls the insert back when the metadata write fails — proving ONE transaction — and does not ack", () => {
		const { db, posted, c } = core();
		// Force the in-transaction first_capture_at write to throw AFTER the insert
		// has already been applied inside the same transaction.
		db.exec("DROP TABLE meta");
		c.handleMessage({
			kind: "producerEvent",
			eventId: "e1",
			observation: obs("e1", 1000, 2000),
		});
		// If insert and metadata were separate transactions, the row would survive.
		expect(
			(db.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(0);
		expect(posted.some((m) => m.kind === "ack")).toBe(false);
		expect(posted.some((m) => m.kind === "error")).toBe(true);
	});

	it("a schema-invalid payload posts an error, writes nothing, and does NOT ack", () => {
		const { db, posted, c } = core();
		c.handleMessage({
			kind: "producerEvent",
			eventId: "bad",
			observation: { ...obs("bad", 1, 2), payload: { reason: "evict" } },
		});
		expect(
			(db.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(0);
		expect(posted.some((m) => m.kind === "ack")).toBe(false);
		expect(posted.some((m) => m.kind === "error")).toBe(true);
	});

	it("answers an appTime query with the aggregated result", () => {
		const { posted, c } = core();
		c.handleMessage({
			kind: "producerEvent",
			eventId: "e1",
			observation: obs("e1", 1000, 2000),
		});
		c.handleMessage({
			kind: "query",
			requestId: "a-1",
			query: { name: "appTime", range: { fromMs: 0, toMs: 10_000 } },
		});
		expect(posted).toContainEqual({
			kind: "appTimeResult",
			requestId: "a-1",
			result: { focusedMs: 1000, engagedMs: 0, completeness: "unknown" },
		});
	});
});

describe("tick retention cadence (prune on UTC-day rollover)", () => {
	const DAY = 86_400_000;
	const T0 = Date.parse("2026-07-19T12:00:00.000Z");

	// A row 366 days old relative to `nowMs` — expired under 365-day retention
	// from any tick in the test window. Same app.focused shape the producerEvent
	// suite uses, so it passes the strict payload allowlist.
	const expired = (id: string, nowMs: number): ObservationInput => ({
		eventId: id,
		kind: "app.focused",
		source: "app-focus-collector",
		subjectId: "app",
		eventTs: nowMs - 366 * DAY,
		tsPrecision: "exact",
		occurredStart: nowMs - 366 * DAY - 1000,
		occurredEnd: nowMs - 366 * DAY,
		parserVersion: 1,
		schemaVersion: 1,
		ingestedAt: 1,
		origin: "n/a",
		appRunId: "run-1",
		repoId: null,
		workspaceRel: null,
		branch: null,
		payload: { reason: "poll" },
	});

	const rows = (db: Database.Database) =>
		(db.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
			.c;

	function cadenceCore() {
		const db = new Database(":memory:");
		migrate(db);
		const posted: InsightsWorkerToMain[] = [];
		const clock = { now: T0 };
		const core = createInsightsWorkerCore({
			db,
			reader: stubReader(),
			now: () => clock.now,
			post: (m) => posted.push(m),
		});
		return { db, posted, clock, core };
	}

	it("prunes on the boot tick, skips same-day ticks, prunes again after UTC midnight", () => {
		const { db, clock, core } = cadenceCore();

		insertObservation(db, expired("old-1", clock.now));
		core.tick(); // boot tick: no prior prune day → prunes
		expect(rows(db)).toBe(0);

		insertObservation(db, expired("old-2", clock.now));
		clock.now += 3000;
		core.tick(); // same UTC day → DELETE skipped entirely
		clock.now += 3000;
		core.tick();
		expect(rows(db)).toBe(1);

		clock.now = Date.parse("2026-07-20T00:00:01.000Z"); // rollover
		core.tick();
		expect(rows(db)).toBe(0);
	});

	it("a failed prune posts a tick error and retries on the NEXT tick (marker not advanced)", () => {
		const { db, posted, clock, core } = cadenceCore();

		insertObservation(db, expired("old-1", clock.now));
		// pruneRetention's transaction also deletes from coverage; hiding the
		// table makes the whole prune transaction throw and roll back.
		db.exec("ALTER TABLE coverage RENAME TO coverage_hidden");
		core.tick();
		expect(posted.some((m) => m.kind === "error" && m.scope === "tick")).toBe(
			true,
		);
		expect(rows(db)).toBe(1); // rolled back — nothing half-pruned

		db.exec("ALTER TABLE coverage_hidden RENAME TO coverage");
		clock.now += 3000; // SAME UTC day — only the failure retry allows this prune
		core.tick();
		expect(rows(db)).toBe(0);
	});
});
