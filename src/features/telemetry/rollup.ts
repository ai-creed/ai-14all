import type { DailyPoint } from "../../../shared/models/usage.js";

// Local calendar boundaries — Monday-start week; 1st-of-month.
function startOfLocalDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}
function startOfWeekMonday(ms: number): number {
	const d = new Date(startOfLocalDay(ms));
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon=0 … Sun=6
	return d.getTime();
}
function startOfMonth(ms: number): number {
	const d = new Date(startOfLocalDay(ms));
	d.setDate(1);
	return d.getTime();
}

// Spec semantics (§4.7): "current week" = calendar week (local, Monday start);
// "current month" = calendar month. The daily series is local-day aligned, so we
// keep only buckets at or after the calendar-period start — NOT a trailing
// window. A Monday shows one bar; the 1st of the month shows one bar.
export function seriesForRange(
	series: DailyPoint[],
	range: "week" | "month",
	nowMs: number,
): DailyPoint[] {
	const from = range === "month" ? startOfMonth(nowMs) : startOfWeekMonday(nowMs);
	return series.filter((p) => p.dayStartMs >= from);
}
