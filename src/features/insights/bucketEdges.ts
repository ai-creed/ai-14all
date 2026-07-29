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
//
// DEFERRED (round 7): `seriesEdgesFor` takes an `appAnchorMs` floor input to
// close a sliver where the real retained anchor sits slightly earlier than
// this bare 365-day floor (prune-straddling spans, UTC-vs-local-day skew,
// first-prune-race — see that function's doc). The SAME doctrine was tried
// here too, but rhythm buckets are HOURLY (24x denser than the weekly `all`
// buckets seriesEdgesFor widens) — for the realistic sliver (hours, per the
// scenarios above) that widening is harmless (~8,761 -> ~8,809 edges), but
// for a genuinely stale anchor (e.g. the app went unopened long enough that
// the retention prune hasn't caught up yet — `appRetainedSinceMs` can then
// legitimately sit weeks, not hours, before this floor) the same `Math.min`
// pushes the hourly edge count PAST the host's 9,001 cap (empirically
// confirmed: a 35-day-stale anchor alone produces ~9,601 edges), which would
// turn the RHYTHM read's own `bad-request` into a hard error for the WHOLE
// dashboard — worse than this function's current (much narrower, hours-
// scale-only) undercount. Safely closing this needs an additional bound on
// how far the floor may widen, which is more than "a few lines" — left as a
// documented residual rather than risking that regression.
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
// not app-time's).
//
// `appAnchorMs` (the caller's OWN `appRetainedSinceMs` coverage anchor) is a
// SECOND, independent floor input, not a redundant one: the bare 365-local-
// day floor below is an upper bound on how far back app-time COULD exist,
// but the real retained anchor can legitimately sit slightly earlier than
// that local floor — a span straddling the prune cutoff survives with an
// `occurred_start` older than the cutoff (coverage-anchors' own test case
// (c) pins this), the prune cutoff itself is UTC-day-aligned while this
// floor is LOCAL-day-aligned (up to ~14-15h of skew in positive-UTC-offset
// zones), and a fetch racing the session's very first prune can observe an
// anchor that predates 365 days by a few hours. In that sliver, clamping to
// the bare 365-day floor alone would start the series request AFTER the
// real anchor — `precaptureFlags` (computed from the SAME unclamped
// `appAnchorMs`, independently) would still correctly mark those columns
// non-precapture (real data expected), but the series response would have
// no bucket for them, so `AppTimeArea`'s `byStart` lookup misses and they
// render as a false zero — an undercount, not just a missing chart column
// (spec AC4: non-precapture columns must reflect real data).
//
// Fix: the effective floor is `min(the 365-day floor, appAnchorMs)` (a null
// anchor — nothing retained — leaves the bare floor as-is). This makes
// "every non-precapture column lies inside the clamped window" true BY
// CONSTRUCTION: the clamp can never start later than the retained anchor
// itself, regardless of any UTC/local skew or prune-race timing. Cost is
// negligible — the anchor is retention-bounded to begin with, so this only
// ever widens the clamp by hours, not days — and returns the SUFFIX of
// `domainEdges` from the largest domain edge at-or-before that effective
// floor onward: anchoring on a real domain edge (not the bare floor value)
// guarantees the clamped window still starts exactly on a domain boundary
// AND fully covers [floor, nowMs]. If no domain edge is that old (the
// domain doesn't reach back that far at all — every 7d/30d domain, and a
// shallow `all`), this is the identity: every edge qualifies. Still bounded
// well under the host's 2..9001 cap (spec §4.3) in every real case — the
// widening is hours, not the years it would take to approach that cap —
// so that cap remains purely an absurd-input guard, never something a
// legitimate `all` domain can trip.
export function seriesEdgesFor(
	domainEdges: number[],
	nowMs: number,
	appAnchorMs: number | null,
): number[] {
	const floorCursor = new Date(nowMs);
	floorCursor.setHours(0, 0, 0, 0);
	floorCursor.setDate(floorCursor.getDate() - RHYTHM_FLOOR_DAYS);
	const floor365 = startOfLocalDayMs(floorCursor.getTime());
	const floor = Math.min(floor365, appAnchorMs ?? floor365);

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
