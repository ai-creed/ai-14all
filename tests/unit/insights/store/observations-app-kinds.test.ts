import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	insertObservation,
	type ObservationInput,
} from "../../../../services/insights/store/observations.js";
import { migrate } from "../../../../services/insights/store/schema.js";

function db(): Database.Database {
	const d = new Database(":memory:");
	migrate(d);
	return d;
}

function appObs(over: Partial<ObservationInput> = {}): ObservationInput {
	return {
		eventId: "e1",
		kind: "app.focused",
		source: "app-focus-collector",
		subjectId: "app",
		eventTs: 2000,
		tsPrecision: "exact",
		occurredStart: 1000,
		occurredEnd: 2000,
		parserVersion: 1,
		schemaVersion: 1,
		ingestedAt: 5000,
		origin: "n/a",
		appRunId: "run-abc",
		payload: { reason: "poll" },
		...over,
	};
}

describe("observations — app kinds", () => {
	it("persists app_run_id and leaves attribution columns NULL", () => {
		const d = db();
		expect(insertObservation(d, appObs())).toBe(true);
		const row = d
			.prepare(
				"SELECT app_run_id, repo_id, workspace_rel, branch, kind FROM observations WHERE event_id='e1'",
			)
			.get() as Record<string, unknown>;
		expect(row.app_run_id).toBe("run-abc");
		expect(row.repo_id).toBeNull();
		expect(row.workspace_rel).toBeNull();
		expect(row.branch).toBeNull();
		expect(row.kind).toBe("app.focused");
	});

	it("accepts every enumerated reason for each app kind", () => {
		const d = db();
		const cases: Array<[string, string]> = [
			["app.focused", "poll"],
			["app.focused", "blur"],
			["app.focused", "suspend"],
			["app.focused", "quit"],
			["app.engaged", "poll"],
			["app.engaged", "idle"],
			["app.engaged", "blur"],
			["app.engaged", "suspend"],
			["app.engaged", "quit"],
			["app.uptime", "disabled"],
			["app.uptime", "suspend"],
			["app.uptime", "quit"],
		];
		cases.forEach(([kind, reason], i) => {
			expect(
				insertObservation(
					d,
					appObs({ eventId: `ok-${i}`, kind, payload: { reason } }),
				),
			).toBe(true);
		});
	});

	it("rejects an absolute-path appRunId — the write guard covers the new column", () => {
		const d = db();
		// Fails if `appRunId` is dropped from assertNoAbsolutePathsDeep: the guard
		// must cover every persisted value, including the promoted app_run_id.
		expect(() =>
			insertObservation(d, appObs({ appRunId: "/abs/run" })),
		).toThrow();
		expect(() => insertObservation(d, appObs({ appRunId: "~/run" }))).toThrow();
		expect(
			(d.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(0);
	});

	it("rejects a non-enum reason and an unknown payload key (strict schema)", () => {
		const d = db();
		expect(() =>
			insertObservation(d, appObs({ payload: { reason: "evict" } })),
		).toThrow();
		expect(() =>
			insertObservation(d, appObs({ payload: { reason: "poll", extra: 1 } })),
		).toThrow();
		// `idle` is valid for app.engaged but NOT for app.focused.
		expect(() =>
			insertObservation(d, appObs({ payload: { reason: "idle" } })),
		).toThrow();
		expect(
			(d.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number })
				.c,
		).toBe(0);
	});
});
