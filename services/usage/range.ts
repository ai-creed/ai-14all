import type {
	DailyPoint,
	KnownWorktree,
	TokenTotals,
	UsageRangeQuery,
	UsageRangeData,
} from "../../shared/models/usage.js";
import type { AgentProviderId } from "../../shared/models/agent-provider.js";
import { type RateLookup } from "./cost/cost.js";
import { rateFor } from "./cost/pricing.js";
import {
	type BucketKey,
	type DailyLedger,
	mergeInto,
	parseBucketKey,
	startOfLocalDay,
} from "./ledger.js";
import { buildScopeData } from "./snapshot.js";

/**
 * Exact-range rollup over the local-day ledger (spec §4.6). One merged bucket
 * map feeds rows, provider roll-up, and cost — so every number agrees by
 * construction. NO untracked filtering anywhere (decision 14); the snapshot
 * path's includeUntracked config is deliberately not an input.
 *
 * Bounds are snapped to local-day starts: `query.fromMs` is normalized ONCE
 * via `startOfLocalDay` and that snapped value drives BOTH the bucket-merge
 * predicate and the day walk, so the two windows are always the same window
 * (a mid-day `fromMs` pulls in that whole local day on both sides — this is
 * what keeps Σ days = Σ byWorkspace = Σ byProvider). Callers should pass
 * day-aligned edges (Task 8's edge generator does).
 */
export function buildRangeResult(
	ledger: DailyLedger,
	known: KnownWorktree[],
	activeWorktreeIds: string[],
	query: UsageRangeQuery,
	rate: RateLookup = rateFor,
): UsageRangeData {
	const fromDay = startOfLocalDay(query.fromMs);
	const merged = new Map<BucketKey, TokenTotals>();
	let earliestDayMs: number | null = null;
	for (const [day, buckets] of ledger.days) {
		if (buckets.size === 0) continue;
		if (earliestDayMs === null || day < earliestDayMs) earliestDayMs = day;
		if (day >= fromDay && day < query.toMs) mergeInto(merged, buckets);
	}
	// The scope label is not part of the range contract — rows/byProvider/cost
	// are lifted; includeUntracked=true (buildScopeData ignores it for totals).
	const scope = buildScopeData(
		"all-time",
		merged,
		known,
		activeWorktreeIds,
		true,
		rate,
	);

	// DST-safe local-day walk (same calendar iteration as dailySeries): the
	// cursor is only a calendar-date carrier, so EVERY tick is re-normalized
	// through startOfLocalDay before use as the ledger key — a raw
	// cursor.getTime() would drift off local midnight in timezones whose DST
	// transition lands at 00:00 (e.g. America/Santiago), where setDate()
	// cannot land back on the hour it started at.
	const days: DailyPoint[] = [];
	const cursor = new Date(fromDay);
	while (cursor.getTime() < query.toMs) {
		const dayStartMs = startOfLocalDay(cursor.getTime());
		const tokens: Partial<Record<AgentProviderId, number>> = {};
		const buckets = ledger.days.get(dayStartMs);
		if (buckets) {
			for (const [key, t] of buckets) {
				const { provider } = parseBucketKey(key);
				tokens[provider] = (tokens[provider] ?? 0) + t.billable;
			}
		}
		days.push({ dayStartMs, tokens });
		cursor.setDate(cursor.getDate() + 1);
	}
	return {
		days,
		byWorkspace: scope.rows,
		byProvider: scope.byProvider,
		cost: scope.cost,
		earliestDayMs,
	};
}
