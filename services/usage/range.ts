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
 * via `startOfLocalDay` and that snapped value drives the bucket-merge
 * predicate (a mid-day `fromMs` pulls in that whole local day — this is what
 * keeps Σ byWorkspace = Σ byProvider = the merge's own total). Callers should
 * pass day-aligned edges (Task 8's edge generator does).
 *
 * `days` is SPARSE (§4.7/AC3/AC4/AC5, replacing an earlier dense
 * calendar-day walk that had to be clamped to bound its iteration count for
 * an absurd `toMs` — that clamp created a regime where `days` could silently
 * truncate while `byWorkspace`/`byProvider`/`cost` did not, breaking AC5's
 * tile-equals-table exactness for any consumer summing `days`). Instead:
 * ONE pass over `ledger.days` (the SAME map, SAME `[fromDay, toMs)`
 * predicate the merge above uses) collects a day-point for every ledger day
 * WITH DATA in the window, sorted ascending. Consequences:
 *   - `days.length` is bounded by the ledger's own real entry count, not by
 *     the requested window's calendar span — an absurdly wide (or narrow)
 *     `toMs`/`fromMs` costs nothing extra; there is no truncation regime and
 *     nothing to clamp.
 *   - A day absent from `days` had ZERO usage — it is not "trimmed", it
 *     never existed as ledger data. Consumers must render it as an
 *     empty/zero column via their own domain-edge walk (bucket-keyed lookup
 *     by `dayStartMs`), never assume `days` is index-aligned with a dense
 *     calendar sequence.
 *   - Σ `days` ≡ Σ `byWorkspace` ≡ Σ `byProvider` BY CONSTRUCTION: every
 *     `days` entry and the merge draw from the exact same ledger entries
 *     under the exact same predicate.
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
	const days: DailyPoint[] = [];
	for (const [day, buckets] of ledger.days) {
		if (buckets.size === 0) continue;
		if (earliestDayMs === null || day < earliestDayMs) earliestDayMs = day;
		if (day >= fromDay && day < query.toMs) {
			mergeInto(merged, buckets);
			const tokens: Partial<Record<AgentProviderId, number>> = {};
			for (const [key, t] of buckets) {
				const { provider } = parseBucketKey(key);
				tokens[provider] = (tokens[provider] ?? 0) + t.billable;
			}
			days.push({ dayStartMs: day, tokens });
		}
	}
	// `ledger.days` is a Map, iterated in INSERTION order (whenever each day
	// was first written to), not chronological order — sort explicitly so
	// `days` stays a predictable, ascending time series for callers.
	days.sort((a, b) => a.dayStartMs - b.dayStartMs);

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

	return {
		days,
		byWorkspace: scope.rows,
		byProvider: scope.byProvider,
		cost: scope.cost,
		earliestDayMs,
	};
}
