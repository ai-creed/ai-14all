// Force a DST-observing zone BEFORE any Date is constructed. Node honors a
// runtime TZ change for subsequent Date operations; test bodies run after this
// module-level assignment, so the fall-back day below is 25h long.
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { UsageAggregator } from "../../../services/usage/aggregator.js";
import { createLedger, createSession, dailySeries, ingestEvent, startOfLocalDay } from "../../../services/usage/ledger.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "claude",
	timestampMs: 0,
	cwd: "/x",
	sessionId: "s",
	model: "m",
	input: 0,
	output: 0,
	billable: 0,
	raw: 0,
	...over,
});

it("ledger.dailySeries keeps day alignment across a 25h fall-back day", () => {
	const ledger = createLedger();
	const session = createSession();
	// US fall-back 2026-11-01; pick local noon so the bucket is unambiguous.
	const t = new Date(2026, 10, 1, 12, 0, 0, 0).getTime();
	const e = (over: Partial<UsageEvent>): UsageEvent => ({
		provider: "codex", timestampMs: t, cwd: "/a", sessionId: "s", model: "m",
		input: 0, output: 0, billable: 4, raw: 4, ...over,
	});
	ingestEvent(ledger, session, e({}), 0);
	const now = new Date(2026, 10, 3, 9, 0, 0, 0).getTime();
	const series = dailySeries(ledger, now, 7);
	const hit = series.find((p) => p.dayStartMs === startOfLocalDay(t));
	expect(hit?.tokens.codex).toBe(4);
	// All 7 points must have distinct dayStartMs. Under a fixed-ms advance across
	// the 25h fall-back day two points would collapse to the same bucket.
	expect(new Set(series.map((p) => p.dayStartMs)).size).toBe(7);
});

describe("dailySeries local-day alignment across DST", () => {
	it("buckets activity on a 25h fall-back day to that local calendar day", () => {
		// US fall-back 2025: clocks roll back 2025-11-02 02:00 -> 01:00, so the local
		// day Nov 2 is 25 hours long. (month index 10 = November.)
		const noonNov2 = new Date(2025, 10, 2, 12, 0, 0, 0).getTime();
		const nowNov3 = new Date(2025, 10, 3, 9, 0, 0, 0).getTime();
		const nov2Midnight = new Date(2025, 10, 2, 0, 0, 0, 0).getTime();

		const agg = new UsageAggregator(0);
		agg.ingest(ev({ timestampMs: noonNov2, billable: 7 }));
		const series = agg.dailySeries(nowNov3, 5);

		// The Nov 2 activity must land in the Nov 2 local-midnight bucket. A fixed
		// 24h step would key it to Nov 2 01:00 and the activity would disappear.
		const bucket = series.find((p) => p.dayStartMs === nov2Midnight);
		expect(bucket?.tokens.claude).toBe(7);

		// Every generated key is a TRUE local midnight (idempotent under re-floor):
		// the fixed-step bug would yield 01:00 on the DST day and fail this.
		for (const p of series) {
			const d = new Date(p.dayStartMs);
			expect(d.getHours()).toBe(0);
			expect(d.getMinutes()).toBe(0);
		}
	});
});
