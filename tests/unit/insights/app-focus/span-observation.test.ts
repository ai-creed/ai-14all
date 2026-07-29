import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	APP_FOCUS_SOURCE,
	spanToObservation,
} from "../../../../services/insights/app-focus/span-observation.js";
import { insertObservation } from "../../../../services/insights/store/observations.js";
import { migrate } from "../../../../services/insights/store/schema.js";

const SPAN = {
	kind: "app.focused",
	startMs: 1000,
	endMs: 2000,
	reason: "poll",
} as const;

describe("spanToObservation", () => {
	it("maps a span onto a provenance-complete, attribution-free observation", () => {
		const o = spanToObservation(SPAN, "run-1");
		expect(o.kind).toBe("app.focused");
		expect(o.source).toBe(APP_FOCUS_SOURCE);
		expect(o.subjectId).toBe("app");
		expect(o.occurredStart).toBe(1000);
		expect(o.occurredEnd).toBe(2000);
		expect(o.eventTs).toBe(2000);
		expect(o.tsPrecision).toBe("exact");
		expect(o.parserVersion).toBe(1);
		expect(o.origin).toBe("n/a");
		expect(o.appRunId).toBe("run-1");
		expect(o.repoId ?? null).toBeNull();
		expect(o.workspaceRel ?? null).toBeNull();
		expect(o.branch ?? null).toBeNull();
		expect(o.payload).toEqual({ reason: "poll" });
	});

	it("event_id is deterministic and varies by kind, run id, and bounds", () => {
		const base = spanToObservation(SPAN, "run-1").eventId;
		expect(spanToObservation(SPAN, "run-1").eventId).toBe(base); // replay-safe
		expect(
			spanToObservation({ ...SPAN, kind: "app.engaged" }, "run-1").eventId,
		).not.toBe(base);
		expect(spanToObservation(SPAN, "run-2").eventId).not.toBe(base);
		expect(
			spanToObservation({ ...SPAN, endMs: 2001 }, "run-1").eventId,
		).not.toBe(base);
	});

	it("the produced observation is accepted by the real store insert (idempotent)", () => {
		const d = new Database(":memory:");
		migrate(d);
		const o = spanToObservation(SPAN, "run-1");
		expect(insertObservation(d, o)).toBe(true);
		expect(insertObservation(d, o)).toBe(false); // same event_id → no second row
		expect(
			(d.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(1);
	});
});
