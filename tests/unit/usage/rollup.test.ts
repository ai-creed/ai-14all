import { describe, expect, it } from "vitest";
import { seriesForRange } from "../../../src/features/telemetry/rollup.js";
import type { DailyPoint } from "../../../shared/models/usage.js";

const day = (y: number, m: number, d: number): number =>
	new Date(y, m, d, 12).getTime();

describe("seriesForRange", () => {
	const series: DailyPoint[] = [
		{ dayStartMs: day(2026, 5, 8), tokens: { codex: 1 } }, // Mon 06-08 — 9 days ago, OUTSIDE the trailing week
		{ dayStartMs: day(2026, 5, 12), tokens: { codex: 9 } }, // Fri 06-12 — 5 days ago: INSIDE the trailing week but BEFORE this Monday
		{ dayStartMs: day(2026, 5, 15), tokens: { codex: 2 } }, // Mon 06-15
		{ dayStartMs: day(2026, 5, 17), tokens: { codex: 3 } }, // Wed 06-17 (today)
	];
	const now = day(2026, 5, 17);
	it("week keeps the rolling trailing 7 days, including days before this Monday", () => {
		const out = seriesForRange(series, "week", now);
		// trailing window starts 06-11: keeps 06-12, 06-15, 06-17; drops 06-08 (9 days ago).
		// A calendar-Monday week (>= 06-15) would have dropped 06-12 — proving the rolling window.
		expect(out.map((p) => p.tokens.codex)).toEqual([9, 2, 3]);
	});
	it("month keeps the rolling trailing 31 days, including prior-month days on the 1st", () => {
		const monthSeries: DailyPoint[] = [
			{ dayStartMs: day(2026, 4, 31), tokens: { codex: 100 } }, // 05-31 — 31 days before 07-01: OUTSIDE
			{ dayStartMs: day(2026, 5, 1), tokens: { codex: 4 } }, // 06-01 — 30 days before: boundary, INSIDE
			{ dayStartMs: day(2026, 5, 20), tokens: { codex: 5 } }, // 06-20 — prior calendar month, INSIDE
			{ dayStartMs: day(2026, 6, 1), tokens: { codex: 3 } }, // 07-01 (today, the 1st)
		];
		const firstOfMonth = day(2026, 6, 1); // 2026-07-01
		const out = seriesForRange(monthSeries, "month", firstOfMonth);
		// window starts 06-01: keeps 06-01, 06-20, 07-01; drops 05-31. A calendar
		// month (>= the 1st) would keep only 07-01 — proving the rolling window.
		expect(out.map((p) => p.tokens.codex)).toEqual([4, 5, 3]);
	});
});
