import type { DailyPoint } from "../../../shared/models/usage.js";

// Local calendar boundaries.
function startOfLocalDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}
// Rolling 7-day window: today plus the 6 prior local days. Must stay in lockstep
// with the ledger's week scope (services/usage/ledger.ts startOfTrailingWeek).
function startOfTrailingWeek(ms: number): number {
	const d = new Date(startOfLocalDay(ms));
	d.setDate(d.getDate() - 6);
	return d.getTime();
}
function startOfMonth(ms: number): number {
	const d = new Date(startOfLocalDay(ms));
	d.setDate(1);
	return d.getTime();
}

// "week" = rolling last 7 days (today + 6 prior), so the daily chart always shows
// 7 day-columns with today at the leading (right) edge — never a single fat bar at
// the start of a calendar week. "month" = calendar month (from the 1st). The series
// is contiguous + local-day aligned, so filtering keeps the matching trailing slots.
export function seriesForRange(
	series: DailyPoint[],
	range: "week" | "month",
	nowMs: number,
): DailyPoint[] {
	const from =
		range === "month" ? startOfMonth(nowMs) : startOfTrailingWeek(nowMs);
	return series.filter((p) => p.dayStartMs >= from);
}
