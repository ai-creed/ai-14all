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
 */
export function buildRangeResult(
	ledger: DailyLedger,
	known: KnownWorktree[],
	activeWorktreeIds: string[],
	query: UsageRangeQuery,
	rate: RateLookup = rateFor,
): UsageRangeData {
	const merged = new Map<BucketKey, TokenTotals>();
	let earliestDayMs: number | null = null;
	for (const [day, buckets] of ledger.days) {
		if (buckets.size === 0) continue;
		if (earliestDayMs === null || day < earliestDayMs) earliestDayMs = day;
		if (day >= query.fromMs && day < query.toMs) mergeInto(merged, buckets);
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

	// DST-safe local-day walk (same calendar iteration as dailySeries).
	const days: DailyPoint[] = [];
	const cursor = new Date(startOfLocalDay(query.fromMs));
	while (cursor.getTime() < query.toMs) {
		const dayStartMs = cursor.getTime();
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
