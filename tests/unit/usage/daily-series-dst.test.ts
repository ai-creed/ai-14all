// Force a DST-observing zone BEFORE any Date is constructed. Node honors a
// runtime TZ change for subsequent Date operations; test bodies run after this
// module-level assignment, so the fall-back day below is 25h long.
process.env.TZ = "America/New_York";

import { expect, it } from "vitest";
import { createLedger, createSession, dailySeries, ingestEvent, startOfLocalDay } from "../../../services/usage/ledger.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

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
