import type { AgentProviderId } from "../../shared/models/agent-provider.js";
import type { DailyPoint, TokenTotals, UsageEvent } from "../../shared/models/usage.js";

// `${cwd}\u0000${provider}\u0000${model}` — NUL-separated; the separator is the
// \u0000 ESCAPE, never a raw control byte. cwd/provider/model never contain it.
export type BucketKey = string;
export const BUCKET_SEP = "\u0000";

export type TokenDelta = Pick<UsageEvent, "input" | "output" | "billable" | "raw">;

export interface DailyLedger {
	// dayStartMs (local midnight) -> BucketKey -> TokenTotals
	days: Map<number, Map<BucketKey, TokenTotals>>;
}

export interface SessionState {
	since: Map<BucketKey, TokenTotals>; // since launchMs
	hourly: Map<number, Partial<Record<AgentProviderId, number>>>; // hourStartMs -> per-provider billable
}

export function createLedger(): DailyLedger {
	return { days: new Map() };
}

export function createSession(): SessionState {
	return { since: new Map(), hourly: new Map() };
}

export function bucketKey(cwd: string, provider: AgentProviderId, model: string): BucketKey {
	return `${cwd}${BUCKET_SEP}${provider}${BUCKET_SEP}${model}`;
}

export function parseBucketKey(key: BucketKey): {
	cwd: string;
	provider: AgentProviderId;
	model: string;
} {
	const parts = key.split(BUCKET_SEP);
	return {
		cwd: parts[0] ?? "",
		provider: (parts[1] ?? "") as AgentProviderId,
		model: parts[2] ?? "",
	};
}

export function emptyTotals(): TokenTotals {
	return { input: 0, output: 0, billable: 0, raw: 0 };
}

export function addEvent(target: TokenTotals, e: TokenDelta): void {
	target.input += e.input;
	target.output += e.output;
	target.billable += e.billable;
	target.raw += e.raw;
}

// --- DST-safe local time helpers (calendar iteration, never fixed-step math) ---

export function startOfLocalDay(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function startOfHour(ms: number): number {
	const d = new Date(ms);
	d.setMinutes(0, 0, 0);
	return d.getTime();
}

export function startOfWeekMonday(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	const dow = d.getDay(); // 0 = Sun .. 6 = Sat
	const sinceMonday = (dow + 6) % 7; // Mon -> 0, Sun -> 6
	d.setDate(d.getDate() - sinceMonday);
	return d.getTime();
}

export function startOfMonth(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	d.setDate(1);
	return d.getTime();
}

// Update the ledger UNCONDITIONALLY; update the session accumulator only when the
// event is on/after launch. An event newly read this run but timestamped before
// launch (written while the app was closed) lands in the ledger only.
export function ingestEvent(
	ledger: DailyLedger,
	session: SessionState,
	e: UsageEvent,
	launchMs: number,
): void {
	const key = bucketKey(e.cwd, e.provider, e.model);
	const day = startOfLocalDay(e.timestampMs);
	let dayMap = ledger.days.get(day);
	if (!dayMap) {
		dayMap = new Map();
		ledger.days.set(day, dayMap);
	}
	let lt = dayMap.get(key);
	if (!lt) {
		lt = emptyTotals();
		dayMap.set(key, lt);
	}
	addEvent(lt, e);

	if (e.timestampMs >= launchMs) {
		let st = session.since.get(key);
		if (!st) {
			st = emptyTotals();
			session.since.set(key, st);
		}
		addEvent(st, e);
		const hour = startOfHour(e.timestampMs);
		const rec = session.hourly.get(hour) ?? {};
		rec[e.provider] = (rec[e.provider] ?? 0) + e.billable;
		session.hourly.set(hour, rec);
	}
}

// Temporary local type — REPLACE in Task 6 Step 4 with the shared HourlyPoint
// import (identical shape). Kept here so this task compiles before shared types land.
export interface HourlyPoint {
	hourStartMs: number;
	tokens: Partial<Record<AgentProviderId, number>>;
}

export type ScopeName = "session" | "week" | "month" | "all-time";

const SERIES_WINDOW_DAYS = 35;

function mergeInto(out: Map<BucketKey, TokenTotals>, buckets: Map<BucketKey, TokenTotals>): void {
	for (const [key, t] of buckets) {
		let cur = out.get(key);
		if (!cur) {
			cur = emptyTotals();
			out.set(key, cur);
		}
		addEvent(cur, t);
	}
}

// Merge the buckets that fall inside a scope's window into one flat map. Session
// reads the session accumulator (since launch); the day-aligned scopes read the
// ledger. Every derived number (totals, provider roll-up, rows, cost) comes from
// this single map, so they cannot disagree.
export function bucketsForScope(
	ledger: DailyLedger,
	session: SessionState,
	scope: ScopeName,
	nowMs: number,
): Map<BucketKey, TokenTotals> {
	const out = new Map<BucketKey, TokenTotals>();
	if (scope === "session") {
		mergeInto(out, session.since);
		return out;
	}
	let from = Number.NEGATIVE_INFINITY; // all-time
	if (scope === "week") from = startOfWeekMonday(nowMs);
	else if (scope === "month") from = startOfMonth(nowMs);
	for (const [day, buckets] of ledger.days) {
		if (day < from) continue;
		mergeInto(out, buckets);
	}
	return out;
}

// Per-provider daily billable over the trailing ~35 days (Week/Month chart). Walk
// CALENDAR dates so a DST 23h/25h day stays aligned with the ingest-side
// startOfLocalDay() keys.
export function dailySeries(
	ledger: DailyLedger,
	nowMs: number,
	windowDays = SERIES_WINDOW_DAYS,
): DailyPoint[] {
	const out: DailyPoint[] = [];
	const cursor = new Date(nowMs);
	cursor.setHours(0, 0, 0, 0);
	cursor.setDate(cursor.getDate() - (windowDays - 1)); // oldest first
	for (let i = 0; i < windowDays; i++) {
		const dayStartMs = startOfLocalDay(cursor.getTime());
		const tokens: Partial<Record<AgentProviderId, number>> = {};
		const buckets = ledger.days.get(dayStartMs);
		if (buckets) {
			for (const [key, t] of buckets) {
				const { provider } = parseBucketKey(key);
				tokens[provider] = (tokens[provider] ?? 0) + t.billable;
			}
		}
		out.push({ dayStartMs, tokens });
		cursor.setDate(cursor.getDate() + 1); // DST-safe advance
	}
	return out;
}

export function hourlySeries(session: SessionState): HourlyPoint[] {
	return [...session.hourly.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([hourStartMs, tokens]) => ({ hourStartMs, tokens: { ...tokens } }));
}

// Per-file contribution to the ledger, in JSON-native form (dayStartMs as a string
// key) so it persists inside the offset cache without custom Map serialization.
export type ContributionJson = Record<string, Record<BucketKey, TokenTotals>>;

export function recordContribution(
	contrib: ContributionJson,
	dayStartMs: number,
	key: BucketKey,
	e: TokenDelta,
): void {
	const dk = String(dayStartMs);
	const day = contrib[dk] ?? (contrib[dk] = {});
	const t = day[key] ?? (day[key] = emptyTotals());
	addEvent(t, e);
}

// Add (sign +1) or subtract (sign -1) a contribution to/from the global ledger.
// Subtraction is used to reconcile a truncated active file before re-reading it.
export function applyContribution(
	ledger: DailyLedger,
	contrib: ContributionJson,
	sign: 1 | -1,
): void {
	for (const [dk, buckets] of Object.entries(contrib)) {
		const day = Number(dk);
		let dayMap = ledger.days.get(day);
		if (!dayMap) {
			if (sign < 0) continue; // nothing to subtract from
			dayMap = new Map();
			ledger.days.set(day, dayMap);
		}
		for (const [key, t] of Object.entries(buckets)) {
			let cur = dayMap.get(key);
			if (!cur) {
				cur = emptyTotals();
				dayMap.set(key, cur);
			}
			cur.input += sign * t.input;
			cur.output += sign * t.output;
			cur.billable += sign * t.billable;
			cur.raw += sign * t.raw;
		}
	}
}
