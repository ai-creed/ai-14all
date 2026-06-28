import type {
	CostSnapshot,
	DailyPoint,
	UsageProvider,
	UsageRow,
} from "../../../shared/models/usage.js";

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

export interface ProviderRollupRow {
	provider: UsageProvider;
	tokens: number; // billable over the period (from the daily series)
	costUsd: number | null; // notional; null when unpriced/absent
}

// Period token totals per provider (from the chart's daily series) joined with
// notional $ from the cost snapshot. Sorted by tokens, descending.
export function providerRollup(
	series: DailyPoint[],
	range: "week" | "month",
	cost: CostSnapshot | null,
	nowMs: number,
): { rows: ProviderRollupRow[]; totalTokens: number; totalCost: number | null } {
	const slice = seriesForRange(series, range, nowMs);
	const tokens = new Map<UsageProvider, number>();
	for (const point of slice) {
		for (const [id, v] of Object.entries(point.tokens)) {
			tokens.set(
				id as UsageProvider,
				(tokens.get(id as UsageProvider) ?? 0) + (v ?? 0),
			);
		}
	}
	const rows: ProviderRollupRow[] = [...tokens.entries()]
		.filter(([, t]) => t > 0)
		.map(([provider, t]) => ({
			provider,
			tokens: t,
			costUsd: cost?.perProvider[provider] ?? null,
		}))
		.sort((a, b) => b.tokens - a.tokens);
	const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
	return { rows, totalTokens, totalCost: cost ? cost.total : null };
}

// Notional $ for one row: the provider's notional cost split by the row's share
// of that provider's billable tokens. Cost is notional, so this allocation is too.
export function rowCostUsd(
	row: UsageRow,
	rows: UsageRow[],
	cost: CostSnapshot | null,
): number | null {
	const c = cost?.perProvider[row.provider];
	if (c == null) return null;
	const providerBillable = rows
		.filter((r) => r.provider === row.provider)
		.reduce((s, r) => s + r.sinceLaunch.billable, 0);
	if (providerBillable <= 0) return null;
	return c * (row.sinceLaunch.billable / providerBillable);
}
