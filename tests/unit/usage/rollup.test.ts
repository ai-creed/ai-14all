import { describe, expect, it } from "vitest";
import { seriesForRange } from "../../../src/features/telemetry/rollup.js";
import type { DailyPoint } from "../../../shared/models/usage.js";

const day = (y: number, m: number, d: number): number => new Date(y, m, d, 12).getTime();

describe("seriesForRange", () => {
	const series: DailyPoint[] = [
		{ dayStartMs: day(2026, 5, 8), tokens: { codex: 1 } }, // Mon 06-08 (last week)
		{ dayStartMs: day(2026, 5, 15), tokens: { codex: 2 } }, // Mon 06-15 (this week)
		{ dayStartMs: day(2026, 5, 17), tokens: { codex: 3 } }, // Wed 06-17
	];
	const now = day(2026, 5, 17);
	it("week keeps only points >= this Monday", () => {
		const out = seriesForRange(series, "week", now);
		expect(out.map((p) => p.tokens.codex)).toEqual([2, 3]);
	});
	it("month keeps only points >= the 1st", () => {
		const out = seriesForRange(series, "month", now);
		expect(out.map((p) => p.tokens.codex)).toEqual([1, 2, 3]);
	});
});
