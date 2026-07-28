import type Database from "better-sqlite3";
import { APP_FOCUS_SOURCE } from "../app-focus/span-observation.js";
import type { AppTimeResult } from "../worker-protocol.js";
import type { Completeness } from "./coverage.js";

// `AppTimeResult` is declared ONCE, in worker-protocol.ts (Task 4) — it is the
// wire type. Re-exported here so callers can import it beside `getAppTime`.
export type { AppTimeResult };

interface SpanRow {
	occurred_start: number | null;
	occurred_end: number | null;
}

type Interval = [start: number, end: number];

// Clip each span to the range and keep only the part inside it. App time
// ACCUMULATES duration, so a straddling span contributes only its in-range ms —
// deliberately different from getWhisperRuns' start-inclusion (spec §7).
function clippedSum(rows: SpanRow[], fromMs: number, toMs: number): number {
	let total = 0;
	for (const r of rows) {
		if (r.occurred_start === null || r.occurred_end === null) continue;
		const start = Math.max(r.occurred_start, fromMs);
		const end = Math.min(r.occurred_end, toMs);
		if (end > start) total += end - start;
	}
	return total;
}

/**
 * Completeness from the UNION of recorded `app.uptime` intervals — never from
 * "a span touched this day" (spec §7). A forward-only collector knows nothing
 * about intervals it was not running, so an unobserved gap is never certified.
 */
export function uptimeCompleteness(
	rows: SpanRow[],
	fromMs: number,
	toMs: number,
): Completeness {
	const span = toMs - fromMs;
	if (span <= 0) return "unknown";
	const intervals: Interval[] = [];
	for (const r of rows) {
		if (r.occurred_start === null || r.occurred_end === null) continue;
		const start = Math.max(r.occurred_start, fromMs);
		const end = Math.min(r.occurred_end, toMs);
		if (end > start) intervals.push([start, end]);
	}
	if (intervals.length === 0) return "unknown";
	intervals.sort((a, b) => a[0] - b[0]);
	let covered = 0;
	let [curStart, curEnd] = intervals[0];
	for (let i = 1; i < intervals.length; i += 1) {
		const [s, e] = intervals[i];
		if (s > curEnd) {
			covered += curEnd - curStart;
			curStart = s;
			curEnd = e;
		} else if (e > curEnd) {
			curEnd = e;
		}
	}
	covered += curEnd - curStart;
	return covered >= span ? "complete" : "partial";
}

export function getAppTime(
	db: Database.Database,
	range: { fromMs: number; toMs: number },
): AppTimeResult {
	// Overlap predicate: any span that intersects the range at all.
	const stmt = db.prepare(
		`SELECT occurred_start, occurred_end FROM observations
		 WHERE kind = ? AND source = ?
		   AND occurred_end > ? AND occurred_start < ?`,
	);
	const rows = (kind: string): SpanRow[] =>
		stmt.all(kind, APP_FOCUS_SOURCE, range.fromMs, range.toMs) as SpanRow[];
	return {
		focusedMs: clippedSum(rows("app.focused"), range.fromMs, range.toMs),
		engagedMs: clippedSum(rows("app.engaged"), range.fromMs, range.toMs),
		completeness: uptimeCompleteness(
			rows("app.uptime"),
			range.fromMs,
			range.toMs,
		),
	};
}
