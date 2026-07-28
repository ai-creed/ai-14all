import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { APP_FOCUS_SOURCE } from "../../../../services/insights/app-focus/span-observation.js";
import { getCoverageAnchors } from "../../../../services/insights/store/coverage-anchors.js";
import { migrate } from "../../../../services/insights/store/schema.js";
import { pruneRetention } from "../../../../services/insights/retention.js";
import {
	deriveCoverageFooter,
	formatShortDate,
} from "../../../../src/features/insights/coverageCopy";

// Copied from tests/unit/insights/store/app-time-series.test.ts (this is the
// third copy across the suite; lifting it to a shared test helper module is
// deferred — helpers aren't shared modules yet in this codebase).
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

const day = (y: number, m: number, d: number) => new Date(y, m, d, 9).getTime();

describe("formatShortDate", () => {
	it("formats as en-US short month lowercased + day", () => {
		expect(formatShortDate(day(2026, 6, 21))).toBe("jul 21");
		expect(formatShortDate(day(2026, 7, 2))).toBe("aug 2");
	});
});

describe("deriveCoverageFooter", () => {
	it("(d) differing anchors: per-source clauses, NEVER the merged copy", () => {
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: day(2026, 2, 31),
				appRetainedSinceMs: day(2026, 7, 2),
				runsRetainedSinceMs: day(2026, 6, 14),
			},
			firstCaptureAt: day(2026, 6, 14),
			windowFromMs: 0,
			windowToMs: 1,
			appComplete: false,
		});
		expect(r.text).toContain("app time since aug 2");
		expect(r.text).toContain("runs since jul 14");
		expect(r.text).not.toContain("app time & runs since");
	});

	it("merge rule: same local day -> the combined prototyped copy", () => {
		const a = day(2026, 6, 21);
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: day(2026, 2, 31),
				appRetainedSinceMs: a,
				runsRetainedSinceMs: a + 3_600_000,
			},
			firstCaptureAt: a,
			windowFromMs: 0,
			windowToMs: 1,
			appComplete: false,
		});
		expect(r.text).toContain("app time & runs since jul 21");
		expect(r.glyph).toBe("◐");
	});

	it("null anchors read 'no app time retained' / 'no runs retained'", () => {
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: null,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			firstCaptureAt: null,
			windowFromMs: 0,
			windowToMs: 1,
			appComplete: false,
		});
		expect(r.text).toContain("no app time retained");
		expect(r.text).toContain("no runs retained");
		expect(r.glyph).toBe("◐");
	});

	it("one source null, the other retained: each states its own clause, never merged", () => {
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: null,
				appRetainedSinceMs: day(2026, 6, 21),
				runsRetainedSinceMs: null,
			},
			firstCaptureAt: day(2026, 6, 21),
			windowFromMs: 0,
			windowToMs: 1,
			appComplete: false,
		});
		expect(r.text).toContain("app time since jul 21");
		expect(r.text).toContain("no runs retained");
	});

	it("(b) retention-clip suffix appears when firstCaptureAt precedes the earliest retained anchor by >1 day", () => {
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: day(2026, 2, 31),
				appRetainedSinceMs: day(2026, 7, 2),
				runsRetainedSinceMs: day(2026, 6, 14),
			},
			firstCaptureAt: day(2025, 6, 21),
			windowFromMs: 0,
			windowToMs: 1,
			appComplete: false,
		});
		expect(r.text).toContain("(365-day retention; capture began jul 21)");
	});

	it("no retention-clip suffix when firstCaptureAt is within 1 day of the earliest retained anchor", () => {
		const earliest = day(2026, 6, 14);
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: null,
				appRetainedSinceMs: day(2026, 7, 2),
				runsRetainedSinceMs: earliest,
			},
			firstCaptureAt: earliest - 3_600_000, // same day, well under 1 day
			windowFromMs: 0,
			windowToMs: 1,
			appComplete: false,
		});
		expect(r.text).not.toContain("365-day retention");
	});

	it("healthy: complete window -> ● capture healthy", () => {
		const from = day(2026, 6, 21);
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: day(2026, 2, 31),
				appRetainedSinceMs: from - 86_400_000,
				runsRetainedSinceMs: from - 86_400_000,
			},
			firstCaptureAt: from - 86_400_000,
			windowFromMs: from,
			windowToMs: from + 86_400_000,
			appComplete: true,
		});
		expect(r.glyph).toBe("●");
		expect(r.text).toContain("capture healthy");
	});

	it("incomplete window with a covering anchor still reads mixed coverage (not healthy)", () => {
		const from = day(2026, 6, 21);
		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: null,
				appRetainedSinceMs: from - 86_400_000,
				runsRetainedSinceMs: from - 86_400_000,
			},
			firstCaptureAt: from - 86_400_000,
			windowFromMs: from,
			windowToMs: from + 86_400_000,
			appComplete: false, // series completeness is not "complete"
		});
		expect(r.glyph).toBe("◐");
		expect(r.text).toContain("mixed coverage");
	});

	// Composed (b): the suffix condition is driven by a REAL pruned store's
	// anchor result — never only by synthetic anchor literals. better-sqlite3
	// runs fine under the jsdom vitest env (the store suites already do this).
	it("(b, composed) pruned store -> getCoverageAnchors -> footer selects the retention-clip suffix", () => {
		const db = new Database(":memory:");
		migrate(db);
		const DAY = 86_400_000;
		const now = 500 * DAY;
		db.prepare("INSERT INTO meta(key,value) VALUES('first_capture_at',?)").run(
			String(30 * DAY),
		);
		insertSpan(db, "app.uptime", 30 * DAY, 30 * DAY + 1000); // pruned
		insertSpan(db, "app.uptime", now - 10 * DAY, now - 10 * DAY + 1000); // retained
		pruneRetention(db, now);
		const anchors = getCoverageAnchors(db);
		expect(anchors.appRetainedSinceMs).toBe(now - 10 * DAY); // precondition, not synthetic

		const r = deriveCoverageFooter({
			anchors: {
				earliestDayMs: null,
				appRetainedSinceMs: anchors.appRetainedSinceMs,
				runsRetainedSinceMs: anchors.runsRetainedSinceMs,
			},
			firstCaptureAt: anchors.firstCaptureAt,
			windowFromMs: now - 7 * DAY,
			windowToMs: now,
			appComplete: false,
		});
		expect(r.glyph).toBe("◐");
		expect(r.text).toContain("365-day retention; capture began");
	});
});
