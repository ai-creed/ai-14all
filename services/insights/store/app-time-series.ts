import type Database from "better-sqlite3";
import { APP_FOCUS_SOURCE } from "../app-focus/span-observation.js";
import type { AppTimeSeriesResult } from "../worker-protocol.js";
import { uptimeCompleteness } from "./app-time-view.js";

// `AppTimeSeriesResult` is declared ONCE, in worker-protocol.ts (Task 4) — it
// is the wire type. Re-exported here so callers can import it beside
// getAppTimeSeries.
export type { AppTimeSeriesResult };

interface SpanRow {
	occurred_start: number | null;
	occurred_end: number | null;
}

// Largest i with edges[i] <= v; -1 when v < edges[0]. Plain binary search.
function edgeIndex(edges: number[], v: number): number {
	let lo = 0,
		hi = edges.length - 1,
		ans = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (edges[mid] <= v) {
			ans = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return ans;
}

/**
 * Bucketed clipped-sum over the same overlap predicate as getAppTime (spec
 * §4.3). Edges are validated by the HOST (§4.1 bad-request); this view assumes
 * a valid, strictly-ascending array. A span crossing an edge contributes to
 * each bucket exactly its overlap, so bucket sums equal the whole-range
 * clipped sum by construction.
 */
export function getAppTimeSeries(
	db: Database.Database,
	bucketEdgesMs: number[],
): AppTimeSeriesResult {
	const fromMs = bucketEdgesMs[0];
	const toMs = bucketEdgesMs[bucketEdgesMs.length - 1];
	const stmt = db.prepare(
		`SELECT occurred_start, occurred_end FROM observations
		 WHERE kind = ? AND source = ?
		   AND occurred_end > ? AND occurred_start < ?`,
	);
	const rows = (kind: string): SpanRow[] =>
		stmt.all(kind, APP_FOCUS_SOURCE, fromMs, toMs) as SpanRow[];

	const bucketize = (rs: SpanRow[]): number[] => {
		const out = new Array<number>(bucketEdgesMs.length - 1).fill(0);
		for (const r of rs) {
			if (r.occurred_start === null || r.occurred_end === null) continue;
			let s = Math.max(r.occurred_start, fromMs);
			const e = Math.min(r.occurred_end, toMs);
			if (e <= s) continue;
			let i = Math.max(edgeIndex(bucketEdgesMs, s), 0);
			while (s < e && i < out.length) {
				const cut = Math.min(e, bucketEdgesMs[i + 1]);
				out[i] += cut - s;
				s = cut;
				i += 1;
			}
		}
		return out;
	};

	const focused = bucketize(rows("app.focused"));
	const engaged = bucketize(rows("app.engaged"));
	return {
		buckets: focused.map((f, i) => ({
			startMs: bucketEdgesMs[i],
			focusedMs: f,
			engagedMs: engaged[i],
		})),
		completeness: uptimeCompleteness(rows("app.uptime"), fromMs, toMs),
	};
}
