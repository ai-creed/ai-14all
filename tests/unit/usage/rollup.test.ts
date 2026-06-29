import { describe, expect, it } from "vitest";
import { seriesForRange } from "../../../src/features/telemetry/rollup.js";
import type { DailyPoint } from "../../../shared/models/usage.js";

const day = (y: number, m: number, d: number): number => new Date(y, m, d, 12).getTime();

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
	it("month keeps only points >= the 1st", () => {
		const out = seriesForRange(series, "month", now);
		expect(out.map((p) => p.tokens.codex)).toEqual([1, 9, 2, 3]);
	});
});
