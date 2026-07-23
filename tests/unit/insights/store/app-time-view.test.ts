import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getAppTime } from "../../../../services/insights/store/app-time-view.js";
import { insertObservation } from "../../../../services/insights/store/observations.js";
import { migrate } from "../../../../services/insights/store/schema.js";
import { pruneRetention } from "../../../../services/insights/retention.js";

let seq = 0;
function span(
	db: Database.Database,
	kind: "app.focused" | "app.engaged" | "app.uptime",
	startMs: number,
	endMs: number,
): void {
	const reason = kind === "app.uptime" ? "quit" : "poll";
	insertObservation(db, {
		eventId: `s${++seq}`,
		kind,
		source: "app-focus-collector",
		subjectId: "app",
		eventTs: endMs,
		tsPrecision: "exact",
		occurredStart: startMs,
		occurredEnd: endMs,
		parserVersion: 1,
		schemaVersion: 1,
		ingestedAt: endMs,
		origin: "n/a",
		appRunId: "run-1",
		payload: { reason },
	});
}

function db(): Database.Database {
	const d = new Database(":memory:");
	migrate(d);
	return d;
}

describe("getAppTime", () => {
	it("sums focused and engaged durations", () => {
		const d = db();
		span(d, "app.focused", 0, 1000);
		span(d, "app.focused", 1000, 3000);
		span(d, "app.engaged", 0, 500);
		const r = getAppTime(d, { fromMs: 0, toMs: 10_000 });
		expect(r.focusedMs).toBe(3000);
		expect(r.engagedMs).toBe(500);
	});

	it("clips a boundary-straddling span to the ms inside the range", () => {
		const d = db();
		span(d, "app.focused", 500, 2500); // range [1000,2000) → 1000 ms inside
		expect(getAppTime(d, { fromMs: 1000, toMs: 2000 }).focusedMs).toBe(1000);
	});

	it("a fully-outside span contributes zero", () => {
		const d = db();
		span(d, "app.focused", 0, 500);
		expect(getAppTime(d, { fromMs: 1000, toMs: 2000 }).focusedMs).toBe(0);
	});

	it("completeness: complete when uptime covers the range", () => {
		const d = db();
		span(d, "app.uptime", 0, 5000);
		expect(getAppTime(d, { fromMs: 1000, toMs: 4000 }).completeness).toBe(
			"complete",
		);
	});

	it("completeness: partial across a disable→enable gap (never a false complete)", () => {
		const d = db();
		span(d, "app.uptime", 0, 1000); // ran, then consent off
		span(d, "app.uptime", 3000, 5000); // re-enabled — [1000,3000) never observed
		expect(getAppTime(d, { fromMs: 0, toMs: 5000 }).completeness).toBe(
			"partial",
		);
	});

	it("completeness: OVERLAPPING uptime intervals are unioned, not summed", () => {
		const d = db();
		span(d, "app.uptime", 0, 1000);
		span(d, "app.uptime", 500, 1500); // overlaps: union covers 1500, not 2000
		// A sum-of-intervals implementation would total 2000 ms and wrongly say
		// "complete" for a 2000 ms range. The union covers only [0,1500).
		expect(getAppTime(d, { fromMs: 0, toMs: 2000 }).completeness).toBe(
			"partial",
		);
		// And the union DOES fully cover a range inside it.
		expect(getAppTime(d, { fromMs: 0, toMs: 1500 }).completeness).toBe(
			"complete",
		);
	});

	it("completeness: unknown with no uptime rows, and after retention prunes them", () => {
		const d = db();
		span(d, "app.focused", 0, 1000);
		expect(getAppTime(d, { fromMs: 0, toMs: 1000 }).completeness).toBe(
			"unknown",
		);

		const d2 = db();
		const old = Date.parse("2020-01-01T00:00:00.000Z");
		span(d2, "app.uptime", old, old + 1000);
		expect(getAppTime(d2, { fromMs: old, toMs: old + 1000 }).completeness).toBe(
			"complete",
		);
		pruneRetention(d2, Date.now()); // ages the row out
		expect(getAppTime(d2, { fromMs: old, toMs: old + 1000 }).completeness).toBe(
			"unknown",
		);
	});
});
