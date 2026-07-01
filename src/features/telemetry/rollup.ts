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
// Rolling 31-day window: today plus the 30 prior local days. Must stay in lockstep
// with the ledger's month scope (services/usage/ledger.ts startOfTrailingMonth).
function startOfTrailingMonth(ms: number): number {
	const d = new Date(startOfLocalDay(ms));
	d.setDate(d.getDate() - 30);
	return d.getTime();
}

// "week" = rolling last 7 days (today + 6 prior); "month" = rolling last 31 days
// (today + 30 prior). Both put today at the leading (right) edge, so the daily
// chart never collapses to a single fat bar at the start of a calendar week/month.
// The series is contiguous + local-day aligned, so filtering keeps the matching
// trailing slots.
export function seriesForRange(
	series: DailyPoint[],
	range: "week" | "month",
	nowMs: number,
): DailyPoint[] {
	const from =
		range === "month"
			? startOfTrailingMonth(nowMs)
			: startOfTrailingWeek(nowMs);
	return series.filter((p) => p.dayStartMs >= from);
}
