// Local-calendar edge generators for the insights dashboard charts. Every
// walk uses calendar-date mutation (setDate/setHours/setMinutes) on a Date
// cursor and re-normalizes each emitted value — never fixed +=86_400_000
// (or similar) millisecond steps, which drift across DST transitions. This
// mirrors the pattern in services/usage/ledger.ts (dailySeries et al.).

export type RangeKey = "today" | "7d" | "30d" | "all";

export interface DomainAnchors {
	earliestDayMs: number | null;
	appRetainedSinceMs: number | null;
	runsRetainedSinceMs: number | null;
}

const SEVEN_COLUMN_FLOOR_WEEKS = 6; // + the current week = 7 columns
const RHYTHM_FLOOR_DAYS = 365; // OBSERVATION_RETENTION_DAYS (services/insights/retention.ts)

export function startOfLocalDayMs(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function startOfLocalHourMs(ms: number): number {
	const d = new Date(ms);
	d.setMinutes(0, 0, 0);
	return d.getTime();
}

// Local Monday 00:00 for the week containing `ms`.
export function weekStartOf(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return startOfLocalDayMs(d.getTime());
}

// `days + 1` local-midnight edges: starts `days - 1` days before `nowMs`'s
// local midnight, walks forward one calendar day at a time, and stops right
// after the first edge past `nowMs` (so the window always covers `now`).
export function dayEdges(nowMs: number, days: number): number[] {
	const cursor = new Date(nowMs);
	cursor.setHours(0, 0, 0, 0);
	cursor.setDate(cursor.getDate() - (days - 1));
	const edges: number[] = [];
	for (let i = 0; i <= days; i++) {
		edges.push(startOfLocalDayMs(cursor.getTime()));
		cursor.setDate(cursor.getDate() + 1);
	}
	return edges;
}

// Local hour-aligned edges covering [fromMs, toMs]: starts at the local hour
// containing `fromMs`, walks forward one hour at a time, and stops right
// after the first edge past `toMs`.
export function hourEdges(fromMs: number, toMs: number): number[] {
	const cursor = new Date(fromMs);
	cursor.setMinutes(0, 0, 0);
	const edges: number[] = [];
	let v = startOfLocalHourMs(cursor.getTime());
	edges.push(v);
	while (v <= toMs) {
		cursor.setHours(cursor.getHours() + 1);
		v = startOfLocalHourMs(cursor.getTime());
		edges.push(v);
	}
	return edges;
}

// hourEdges over [max(domainStartMs, 365-local-day floor), now]. The rhythm
// read must ALWAYS satisfy the host's 9,001-edge cap (spec §4.3): the `all`
// domain can start at unbounded ledger history (tokens), but app-time data
// older than OBSERVATION_RETENTION_DAYS = 365 cannot exist, so clamping the
// rhythm window to the trailing 365 local days loses nothing and keeps the
// edge count <= ~366*24+1 < 9,001 even across DST.
export function rhythmEdges(domainStartMs: number, nowMs: number): number[] {
	const floorCursor = new Date(nowMs);
	floorCursor.setHours(0, 0, 0, 0);
	floorCursor.setDate(floorCursor.getDate() - RHYTHM_FLOOR_DAYS);
	const floor = startOfLocalDayMs(floorCursor.getTime());
	return hourEdges(Math.max(domainStartMs, floor), nowMs);
}

// Same truth-preservation doctrine as `rhythmEdges`, applied to the bucketed
// app-time SERIES read instead of the rhythm read: app-time data older than
// OBSERVATION_RETENTION_DAYS = 365 cannot exist, so a `queryAppTimeSeries`
// call never needs to reach further back than that, however deep the `all`
// domain's OWN start goes (which tracks the token ledger's unbounded depth,
// not app-time's). Returns the SUFFIX of `domainEdges` from the largest
// domain edge at-or-before the 365-local-day floor onward — anchoring on a
// real domain edge (not the bare floor value) guarantees the clamped window
// still starts exactly on a domain boundary AND fully covers
// [floor, nowMs], so no possible app-time data is ever excluded. If no
// domain edge is that old (the domain doesn't reach back 365 days at all —
// every 7d/30d domain), this is the identity: every edge qualifies. Bounded
// to at most ~55 weekly edges (365/7 + 1) or ~367 daily edges (365 + 2) —
// either way comfortably under the host's 2..9001 cap (spec §4.3), so that
// cap becomes unreachable from any real dashboard fetch and remains purely
// an absurd-input guard, never something a legitimate `all` domain can trip.
export function seriesEdgesFor(domainEdges: number[], nowMs: number): number[] {
	const floorCursor = new Date(nowMs);
	floorCursor.setHours(0, 0, 0, 0);
	floorCursor.setDate(floorCursor.getDate() - RHYTHM_FLOOR_DAYS);
	const floor = startOfLocalDayMs(floorCursor.getTime());

	// Walk from the end backward for the LARGEST index whose edge is <=
	// floor (domainEdges is always ascending) — stays 0 or the array's own
	// identity when no edge is that old.
	let anchorIdx = 0;
	for (let i = domainEdges.length - 1; i >= 0; i--) {
		if (domainEdges[i] <= floor) {
			anchorIdx = i;
			break;
		}
	}
	const clamped = domainEdges.slice(anchorIdx);
	if (clamped.length >= 2) return clamped;
	// Degenerate fallback (a domain with fewer than 2 edges past the
	// anchor — shouldn't happen for any real domain, but never emit
	// something isValidBucketEdges would reject): the last two domain
	// edges, guaranteed to exist for any domain this function is ever
	// called with (domainForRange never returns fewer than 2 edges).
	return domainEdges.slice(-2);
}

// Local Monday-start week edges from `startWeekMs` (already week-aligned)
// through the first week boundary past `toMs`, walking a week (7 days) at a
// time and re-normalizing via weekStartOf each step.
function weekEdgesFrom(startWeekMs: number, toMs: number): number[] {
	const cursor = new Date(startWeekMs);
	const edges: number[] = [];
	let v = weekStartOf(cursor.getTime());
	edges.push(v);
	while (v <= toMs) {
		cursor.setDate(cursor.getDate() + 7);
		v = weekStartOf(cursor.getTime());
		edges.push(v);
	}
	return edges;
}

export function domainForRange(
	range: RangeKey,
	anchors: DomainAnchors,
	nowMs: number,
): { mode: "day" | "week"; edges: number[] } {
	if (range === "today" || range === "7d") {
		return { mode: "day", edges: dayEdges(nowMs, 7) };
	}
	if (range === "30d") {
		return { mode: "day", edges: dayEdges(nowMs, 30) };
	}

	// range === "all"
	const candidates = [
		anchors.earliestDayMs,
		anchors.appRetainedSinceMs,
		anchors.runsRetainedSinceMs,
	].filter((v): v is number => v !== null);
	if (candidates.length === 0) {
		return { mode: "day", edges: dayEdges(nowMs, 7) };
	}

	const dataStartMs = Math.min(...candidates);
	let edges = weekEdgesFrom(weekStartOf(dataStartMs), nowMs);
	if (edges.length - 1 < 7) {
		// Seven-column floor: pad back to `currentWeekStart - 6 weeks`.
		const floorCursor = new Date(weekStartOf(nowMs));
		floorCursor.setDate(floorCursor.getDate() - SEVEN_COLUMN_FLOOR_WEEKS * 7);
		edges = weekEdgesFrom(weekStartOf(floorCursor.getTime()), nowMs);
	}
	return { mode: "week", edges };
}

function weekBucketIndex(ms: number, weekEdges: number[]): number {
	for (let i = 0; i < weekEdges.length - 1; i++) {
		if (ms >= weekEdges[i] && ms < weekEdges[i + 1]) return i;
	}
	return -1;
}

// Folds local-day token points into the week buckets described by
// `weekEdges` (as returned by domainForRange's "week" mode). Each day lands
// in exactly one bucket (half-open [edge[i], edge[i+1]) partition), so
// per-provider sums are preserved exactly.
export function foldDaysToWeeks(
	days: Array<{ dayStartMs: number; tokens: Partial<Record<string, number>> }>,
	weekEdges: number[],
): Array<Partial<Record<string, number>>> {
	const buckets: Array<Partial<Record<string, number>>> = Array.from(
		{ length: Math.max(weekEdges.length - 1, 0) },
		() => ({}),
	);
	for (const day of days) {
		const idx = weekBucketIndex(day.dayStartMs, weekEdges);
		if (idx === -1) continue;
		const bucket = buckets[idx];
		for (const [key, value] of Object.entries(day.tokens)) {
			if (value === undefined) continue;
			bucket[key] = (bucket[key] ?? 0) + value;
		}
	}
	return buckets;
}
