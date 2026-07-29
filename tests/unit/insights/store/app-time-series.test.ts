import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { APP_FOCUS_SOURCE } from "../../../../services/insights/app-focus/span-observation.js";
import { getAppTime } from "../../../../services/insights/store/app-time-view.js";
import { getAppTimeSeries } from "../../../../services/insights/store/app-time-series.js";
import { migrate } from "../../../../services/insights/store/schema.js";

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

const H = 3_600_000;

function seeded(): Database.Database {
	const db = new Database(":memory:");
	migrate(db);
	insertSpan(db, "app.focused", 1 * H, 3 * H); // inside bucket 0+1
	insertSpan(db, "app.focused", 23 * H, 25 * H); // crosses the day edge at 24H
	insertSpan(db, "app.engaged", 1 * H, 2 * H);
	insertSpan(db, "app.uptime", 0, 26 * H);
	return db;
}

describe("getAppTimeSeries", () => {
	it("clips a span across an edge into both buckets, exactly its overlap", () => {
		const db = seeded();
		const r = getAppTimeSeries(db, [0, 24 * H, 48 * H]); // two local-day buckets
		expect(r.buckets).toHaveLength(2);
		expect(r.buckets[0].startMs).toBe(0);
		expect(r.buckets[0].focusedMs).toBe(2 * H + 1 * H); // [1,3) + [23,24)
		expect(r.buckets[1].focusedMs).toBe(1 * H); // [24,25)
		expect(r.buckets[0].engagedMs).toBe(1 * H);
	});

	it("partition equality: bucket sums equal getAppTime over the whole domain", () => {
		const db = seeded();
		const edges = [0, 6 * H, 24 * H, 30 * H, 48 * H];
		const series = getAppTimeSeries(db, edges);
		const whole = getAppTime(db, { fromMs: 0, toMs: 48 * H });
		const sum = (k: "focusedMs" | "engagedMs") =>
			series.buckets.reduce((a, b) => a + b[k], 0);
		expect(sum("focusedMs")).toBe(whole.focusedMs);
		expect(sum("engagedMs")).toBe(whole.engagedMs);
		expect(series.completeness).toBe(whole.completeness);
	});

	it("empty store: zero buckets, completeness unknown", () => {
		const db = new Database(":memory:");
		migrate(db);
		const r = getAppTimeSeries(db, [0, H, 2 * H]);
		expect(r.buckets).toEqual([
			{ startMs: 0, focusedMs: 0, engagedMs: 0 },
			{ startMs: H, focusedMs: 0, engagedMs: 0 },
		]);
		expect(r.completeness).toBe("unknown");
	});
});
