import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { APP_FOCUS_SOURCE } from "../../../../services/insights/app-focus/span-observation.js";
import { getCoverageAnchors } from "../../../../services/insights/store/coverage-anchors.js";
import { migrate } from "../../../../services/insights/store/schema.js";
import { pruneRetention } from "../../../../services/insights/retention.js";
import { getAppTime } from "../../../../services/insights/store/app-time-view.js";
import { getWhisperRuns } from "../../../../services/insights/store/views.js";

let seq = 0;
function insertSpan(
	db: Database.Database,
	kind: string,
	startMs: number,
	endMs: number,
	opts: {
		source?: string;
		eventTs?: number;
		subjectId?: string;
		payload?: string;
	} = {},
): void {
	db.prepare(
		`INSERT INTO observations (event_id, kind, source, subject_id, event_ts, ts_precision,
		 occurred_start, occurred_end, parser_version, schema_version, ingested_at, payload)
		 VALUES (?, ?, ?, ?, ?, 'exact', ?, ?, 1, 7, 1, ?)`,
	).run(
		`e${++seq}`,
		kind,
		opts.source ?? APP_FOCUS_SOURCE,
		opts.subjectId ?? null,
		opts.eventTs ?? endMs,
		startMs,
		endMs,
		opts.payload ?? "{}",
	);
}

function setFirstCapture(db: Database.Database, ms: number): void {
	db.prepare("INSERT INTO meta(key,value) VALUES('first_capture_at',?)").run(
		String(ms),
	);
}

const DAY = 86_400_000;

describe("getCoverageAnchors", () => {
	it("(e) live session: focused/engaged only, NO uptime row → non-null app anchor", () => {
		const db = new Database(":memory:");
		migrate(db);
		setFirstCapture(db, 1_000);
		insertSpan(db, "app.focused", 5_000, 20_000);
		insertSpan(db, "app.engaged", 5_000, 15_000);
		const a = getCoverageAnchors(db);
		expect(a.appRetainedSinceMs).toBe(5_000); // earliest span's occurred_start
		expect(a.runsRetainedSinceMs).toBeNull();
		expect(a.firstCaptureAt).toBe(1_000);
	});

	it("(b) retention-clipped: pruned store reports appRetainedSinceMs > firstCaptureAt", () => {
		const db = new Database(":memory:");
		migrate(db);
		const now = 400 * DAY;
		setFirstCapture(db, 2 * DAY);
		insertSpan(db, "app.uptime", 2 * DAY, 2 * DAY + 1000); // old — pruned
		insertSpan(db, "app.uptime", now - 3 * DAY, now - 3 * DAY + 1000); // retained
		pruneRetention(db, now);
		const a = getCoverageAnchors(db);
		expect(a.firstCaptureAt).toBe(2 * DAY);
		expect(a.appRetainedSinceMs).toBe(now - 3 * DAY);
		expect(a.appRetainedSinceMs!).toBeGreaterThan(a.firstCaptureAt!);
	});

	it("(c) boundary-crossing rows anchor on occurred_start, not event_ts, and stay visible", () => {
		const db = new Database(":memory:");
		migrate(db);
		const now = 400 * DAY;
		const cutoff = now - 365 * DAY; // pruneRetention's UTC-day-aligned cutoff ≤ this
		// occurred_start BEFORE the cutoff, event_ts AFTER it → retained, visible.
		insertSpan(db, "app.uptime", cutoff - DAY, cutoff + DAY, {
			eventTs: cutoff + DAY,
		});
		insertSpan(db, "whisper.workflow", cutoff - 2 * DAY, cutoff + DAY, {
			source: "whisper-archiver",
			eventTs: cutoff + DAY,
			subjectId: "run-boundary",
			payload: JSON.stringify({
				collab_id: "c1",
				workflow_type: "sdd",
				status: "done",
				halt_reason: null,
			}),
		});
		pruneRetention(db, now);
		const a = getCoverageAnchors(db);
		expect(a.appRetainedSinceMs).toBe(cutoff - DAY);
		expect(a.runsRetainedSinceMs).toBe(cutoff - 2 * DAY);
		// composed (c): BOTH boundary rows come back from their REAL range
		// queries when the range starts at the anchor — the anchor never
		// excludes a row the views can still show.
		const t = getAppTime(db, { fromMs: a.appRetainedSinceMs!, toMs: now });
		expect(t.completeness).not.toBe("unknown");
		const runs = getWhisperRuns(db, {
			fromMs: a.runsRetainedSinceMs!,
			toMs: now,
		});
		expect(runs.runs).toHaveLength(1);
		expect(runs.runs[0].runId).toBe("run-boundary");
		expect(runs.runs[0].startedAt).toBe(cutoff - 2 * DAY);
	});

	it("empty store: all anchors null, firstCaptureAt null", () => {
		const db = new Database(":memory:");
		migrate(db);
		expect(getCoverageAnchors(db)).toEqual({
			firstCaptureAt: null,
			appRetainedSinceMs: null,
			runsRetainedSinceMs: null,
		});
	});
});
