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

// Structural defense against absurd inputs (e.g. a caller-bug `toMs` near
// Number.MAX_SAFE_INTEGER, which would otherwise drive the day-walk loop
// below through a trillion-plus iterations) — NOT a real-history cap. §4.7/
// AC3 require `all` to start at the real min(earliestDayMs, anchors) with no
// exception, so this must never reject or truncate a legitimate ledger: it
// only bounds how many CALENDAR DAYS the walk below ever produces day-points
// for, trailing back from `query.toMs`. ~27 years — comfortably past any
// plausible real retention depth. The bucket MERGE just below (which feeds
// rows/byProvider/cost/earliestDayMs) is NEVER clamped — it iterates only
// the ledger's own real entries, however far back they go, not a synthetic
// day count — so totals stay full-depth-true regardless of window size. Only
// the CHART's leading day-points beyond this floor would ever be trimmed for
// a ledger that deep; tracked as a residual in spec §9 item 7 (rollups are
// the durable fix for that case, not this clamp).
export const MAX_RANGE_DAYS = 10_000;

/**
 * Exact-range rollup over the local-day ledger (spec §4.6). One merged bucket
 * map feeds rows, provider roll-up, and cost — so every number agrees by
 * construction. NO untracked filtering anywhere (decision 14); the snapshot
 * path's includeUntracked config is deliberately not an input.
 *
 * Bounds are snapped to local-day starts: `query.fromMs` is normalized ONCE
 * via `startOfLocalDay` and that snapped value drives the bucket-merge
 * predicate (a mid-day `fromMs` pulls in that whole local day — this is what
 * keeps Σ byWorkspace = Σ byProvider = the merge's own total). The day WALK
 * (chart day-points) uses the same `fromDay`, floored at `MAX_RANGE_DAYS`
 * trailing days from `toMs` (see that constant's doc) — for any real window
 * this floor never binds, so `days` and the merge cover the identical window
 * and Σ days also agrees; only an absurdly wide window trims `days` alone.
 * Callers should pass day-aligned edges (Task 8's edge generator does).
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

	// Walk-clamp floor: the local-day start MAX_RANGE_DAYS trailing days before
	// `query.toMs` (see that constant's doc) — computed via the SAME
	// calendar-walk idiom as the walk itself (setDate, never fixed-ms
	// subtraction, which would drift across DST). An invalid `query.toMs`
	// (e.g. outside JS's representable Date range) collapses this to NaN,
	// which safely yields a zero-iteration walk below rather than a crash or
	// runaway loop — see MAX_RANGE_DAYS's doc for why that's an acceptable
	// (structural-defense-only) outcome for such an input.
	const walkFloorCursor = new Date(query.toMs);
	walkFloorCursor.setHours(0, 0, 0, 0);
	walkFloorCursor.setDate(walkFloorCursor.getDate() - MAX_RANGE_DAYS);
	const walkFloor = startOfLocalDay(walkFloorCursor.getTime());
	const walkStart = Math.max(fromDay, walkFloor);

	// DST-safe local-day walk (same calendar iteration as dailySeries): the
	// cursor is only a calendar-date carrier, so EVERY tick is re-normalized
	// through startOfLocalDay before use as the ledger key — a raw
	// cursor.getTime() would drift off local midnight in timezones whose DST
	// transition lands at 00:00 (e.g. America/Santiago), where setDate()
	// cannot land back on the hour it started at.
	const days: DailyPoint[] = [];
	const cursor = new Date(walkStart);
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
