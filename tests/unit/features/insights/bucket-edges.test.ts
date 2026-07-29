import { describe, it, expect } from "vitest";
import {
	dayEdges,
	domainForRange,
	foldDaysToWeeks,
	hourEdges,
	rhythmEdges,
	seriesEdgesFor,
	startOfLocalDayMs,
	weekStartOf,
} from "../../../../src/features/insights/bucketEdges";

// Local Tue jul 28 2026, 14:30 — fixed via new Date(y,m,d,...) locals so
// assertions are TZ-independent (per the brief).
const now = new Date(2026, 6, 28, 14, 30).getTime();

describe("startOfLocalDayMs", () => {
	it("zeroes the local time-of-day", () => {
		const v = startOfLocalDayMs(now);
		const d = new Date(v);
		expect(d.getHours()).toBe(0);
		expect(d.getMinutes()).toBe(0);
		expect(d.getSeconds()).toBe(0);
		expect(d.getMilliseconds()).toBe(0);
		expect(d.getDate()).toBe(new Date(now).getDate());
	});
});

describe("dayEdges", () => {
	it("N+1 local-midnight edges ending after now", () => {
		const e = dayEdges(now, 7);
		expect(e).toHaveLength(8);
		for (const v of e) expect(new Date(v).getHours()).toBe(0);
		expect(e[7]).toBeGreaterThan(now);
		expect(e[6]).toBeLessThanOrEqual(now);
	});

	it("edges are strictly ascending by exactly one calendar day", () => {
		const e = dayEdges(now, 7);
		for (let i = 1; i < e.length; i++) {
			const prev = new Date(e[i - 1]);
			const next = new Date(e[i]);
			expect(next.getTime()).toBeGreaterThan(prev.getTime());
			const expected = new Date(prev);
			expected.setDate(expected.getDate() + 1);
			expect(next.getTime()).toBe(expected.getTime());
		}
	});
});

describe("hourEdges", () => {
	it("local hour-aligned edges bracketing [from, to]", () => {
		const from = now - 3 * 3_600_000;
		const e = hourEdges(from, now);
		for (const v of e) {
			expect(new Date(v).getMinutes()).toBe(0);
			expect(new Date(v).getSeconds()).toBe(0);
		}
		expect(e[0]).toBeLessThanOrEqual(from);
		expect(e[e.length - 1]).toBeGreaterThan(now);
	});
});

describe("weekStartOf", () => {
	it("returns the local Monday 00:00 for any day in the week", () => {
		const monday = weekStartOf(now);
		expect(new Date(monday).getDay()).toBe(1); // Monday
		expect(new Date(monday).getHours()).toBe(0);
		// Every day in [monday, monday+7d) maps back to the same Monday.
		for (let i = 0; i < 7; i++) {
			const probe = monday + i * 86_400_000 + 12 * 3_600_000; // midday probe
			expect(weekStartOf(probe)).toBe(monday);
		}
	});
});

describe("domainForRange", () => {
	it("today -> 7-day day-mode window", () => {
		const d = domainForRange(
			"today",
			{
				earliestDayMs: null,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		expect(d.mode).toBe("day");
		expect(d.edges).toEqual(dayEdges(now, 7));
	});

	it("7d -> 7-day day-mode window", () => {
		const d = domainForRange(
			"7d",
			{
				earliestDayMs: null,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		expect(d.mode).toBe("day");
		expect(d.edges).toEqual(dayEdges(now, 7));
	});

	it("30d -> 30-day day-mode window", () => {
		const d = domainForRange(
			"30d",
			{
				earliestDayMs: null,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		expect(d.mode).toBe("day");
		expect(d.edges).toEqual(dayEdges(now, 30));
	});

	it("(a) short-history all: anchor inside the current week -> EXACTLY 7 week columns", () => {
		const { mode, edges } = domainForRange(
			"all",
			{
				earliestDayMs: now - 86_400_000,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		expect(mode).toBe("week");
		expect(edges).toHaveLength(8); // 7 buckets
		expect(edges[6]).toBe(weekStartOf(now)); // 6 padded stub weeks before the current one
	});

	it("all: domain starts at weekStart(min anchor) when history is long", () => {
		const start = new Date(2026, 2, 31).getTime(); // mar 31
		const { edges } = domainForRange(
			"all",
			{
				earliestDayMs: start,
				appRetainedSinceMs: now - 7 * 86_400_000,
				runsRetainedSinceMs: null,
			},
			now,
		);
		expect(edges[0]).toBe(weekStartOf(start));
		expect(edges[edges.length - 1]).toBeGreaterThan(now);
		expect(edges.length - 1).toBeGreaterThanOrEqual(7);
	});

	it("all with NO anchors falls back to the 7-day day-mode window", () => {
		const d = domainForRange(
			"all",
			{
				earliestDayMs: null,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		expect(d.mode).toBe("day");
		expect(d.edges).toHaveLength(8);
	});
});

describe("foldDaysToWeeks", () => {
	it("partitions token sums exactly across 14 day points / 2 weeks", () => {
		const weekEdges = domainForRange(
			"all",
			{
				earliestDayMs: now - 13 * 86_400_000,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		).edges;
		expect(weekEdges.length).toBeGreaterThanOrEqual(3); // at least 2 buckets

		const dayStart = startOfLocalDayMs(now) - 13 * 86_400_000;
		const days = Array.from({ length: 14 }, (_, i) => ({
			dayStartMs: dayStart + i * 86_400_000,
			tokens: { openai: 10 + i, anthropic: 100 - i },
		}));

		const folded = foldDaysToWeeks(days, weekEdges);
		expect(folded).toHaveLength(weekEdges.length - 1);

		const totalOpenai = days.reduce((a, d) => a + d.tokens.openai, 0);
		const totalAnthropic = days.reduce((a, d) => a + d.tokens.anthropic, 0);
		const foldedOpenai = folded.reduce((a, b) => a + (b.openai ?? 0), 0);
		const foldedAnthropic = folded.reduce((a, b) => a + (b.anthropic ?? 0), 0);
		expect(foldedOpenai).toBe(totalOpenai);
		expect(foldedAnthropic).toBe(totalAnthropic);
	});
});

describe("rhythmEdges", () => {
	it("NEVER exceeds the host's 9,001-edge cap, even for years-old ledgers (AC3)", () => {
		const threeYearsAgo = new Date(2023, 6, 28).getTime();
		const edges = rhythmEdges(threeYearsAgo, now);
		expect(edges.length).toBeLessThanOrEqual(9001);
		expect(edges.length).toBeGreaterThan(24 * 300); // still ~a year of hourly buckets
		for (const v of edges) expect(new Date(v).getMinutes()).toBe(0); // local hour-aligned
	});

	it("uses the domain start when it is inside the 365-day floor", () => {
		const twoDaysAgo = now - 2 * 86_400_000;
		const edges = rhythmEdges(twoDaysAgo, now);
		expect(edges[0]).toBeLessThanOrEqual(twoDaysAgo);
		expect(edges.length).toBeLessThan(24 * 4);
	});

	// (Round 7 considered extending the same appAnchorMs-honoring fix here,
	// same doctrine as seriesEdgesFor below — deferred: rhythm buckets are
	// HOURLY, so the identical widening that's negligible for seriesEdgesFor's
	// weekly buckets can push this function's edge count past the host's
	// 9,001 cap for a genuinely stale (prune-lagging) anchor. See
	// rhythmEdges' own doc comment for the full reasoning.)
});

// Round-6 boundary fix: `all`'s domain can start at the token ledger's
// unbounded depth, but a `queryAppTimeSeries` call over the FULL domain
// would eventually trip the host's 2..9001 bucket-edges cap (spec §4.3) for
// a deep-enough ledger — converting genuine token history into the error
// state for a reason that has nothing to do with app-time (which physically
// cannot predate OBSERVATION_RETENTION_DAYS = 365). `seriesEdgesFor` applies
// the SAME doctrine `rhythmEdges` already does, to the series read instead.
describe("seriesEdgesFor", () => {
	it("identity for 7d/30d — every edge is already within the 365-day floor", () => {
		const anchors = {
			earliestDayMs: null,
			appRetainedSinceMs: null,
			runsRetainedSinceMs: null,
		};
		const d7 = domainForRange("7d", anchors, now);
		expect(seriesEdgesFor(d7.edges, now, null)).toEqual(d7.edges);
		const d30 = domainForRange("30d", anchors, now);
		expect(seriesEdgesFor(d30.edges, now, null)).toEqual(d30.edges);
	});

	it("a ~174-year-deep `all` domain (past the host's 9,001-edge cap) clamps to <= 60 edges, all real domain edges, starting at-or-before the 365-day floor", () => {
		const start = now - 174 * 365 * 86_400_000; // ~174 years back
		const domain = domainForRange(
			"all",
			{
				earliestDayMs: start,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		// Sanity: this domain IS the regime that would trip the host's cap if
		// requested directly (the bug this fix closes).
		expect(domain.edges.length).toBeGreaterThan(9001);

		const clamped = seriesEdgesFor(domain.edges, now, null);
		expect(clamped.length).toBeGreaterThanOrEqual(2);
		expect(clamped.length).toBeLessThanOrEqual(60);
		for (const v of clamped) expect(domain.edges).toContain(v);

		const floorCursor = new Date(now);
		floorCursor.setHours(0, 0, 0, 0);
		floorCursor.setDate(floorCursor.getDate() - 365);
		const floor = startOfLocalDayMs(floorCursor.getTime());
		expect(clamped[0]).toBeLessThanOrEqual(floor);
	});

	it("degenerate fallback: guarantees >= 2 edges even when every supplied edge is at-or-before the floor", () => {
		// Every edge here predates the 365-day floor (relative to `now`), so
		// the "largest edge <= floor" search lands on the FINAL index,
		// producing a 1-element clamped suffix on its own — the fallback
		// (the last two edges) must kick in instead, since a 1-edge result
		// could never satisfy the host's own >= 2 minimum anyway.
		const edges = [
			now - 400 * 86_400_000,
			now - 390 * 86_400_000,
			now - 380 * 86_400_000, // still > 365 days back
		];
		const result = seriesEdgesFor(edges, now, null);
		expect(result).toEqual(edges.slice(-2));
		expect(result.length).toBe(2);
	});

	// Round-7 hardening: the bare 365-day local floor is only an UPPER bound
	// on how far back app-time could exist — the REAL retained anchor can
	// legitimately sit a little earlier (a span straddling the prune cutoff
	// survives with an occurred_start older than the cutoff; the prune
	// cutoff is UTC-day-aligned while this floor is local-day-aligned, up to
	// ~14-15h of skew in positive-UTC-offset zones; a fetch racing the
	// session's first prune can see an anchor a few hours older than 365d).
	// Clamping to the bare floor alone in that sliver would exclude real,
	// non-precapture data. `appAnchorMs` closes it: the effective floor is
	// min(the 365-day floor, appAnchorMs).
	it("an appAnchorMs OLDER than the 365-day floor (the straddling-prune/UTC-skew/first-prune-race sliver): the clamp starts at-or-before the anchor itself, not just the bare floor", () => {
		const start = now - 174 * 365 * 86_400_000; // ~174 years back
		const domain = domainForRange(
			"all",
			{
				earliestDayMs: start,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		const appAnchorMs = now - 400 * 86_400_000; // 400 days back — older than the 365-day floor

		const clamped = seriesEdgesFor(domain.edges, now, appAnchorMs);
		expect(clamped[0]).toBeLessThanOrEqual(appAnchorMs);
		expect(clamped.length).toBeGreaterThanOrEqual(2);
		expect(clamped.length).toBeLessThanOrEqual(100);
		for (const v of clamped) expect(domain.edges).toContain(v);
	});

	it("an appAnchorMs null, or inside the 365-day floor (more recent than it): identical clamp to the bare-floor-only behavior", () => {
		const start = now - 174 * 365 * 86_400_000; // ~174 years back
		const domain = domainForRange(
			"all",
			{
				earliestDayMs: start,
				appRetainedSinceMs: null,
				runsRetainedSinceMs: null,
			},
			now,
		);
		const baseline = seriesEdgesFor(domain.edges, now, null);

		const recentAnchorMs = now - 100 * 86_400_000; // well inside the floor
		expect(seriesEdgesFor(domain.edges, now, recentAnchorMs)).toEqual(baseline);

		const rightAtFloorMs = now - 365 * 86_400_000;
		expect(seriesEdgesFor(domain.edges, now, rightAtFloorMs)).toEqual(baseline);
	});
});
