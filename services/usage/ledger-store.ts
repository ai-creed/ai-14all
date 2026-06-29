import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ProviderRateLimits, TokenTotals } from "../../shared/models/usage.js";
import { type BucketKey, type DailyLedger, createLedger, emptyTotals } from "./ledger.js";
import type { OffsetCache, OffsetEntry } from "./scanner.js";

export const LEDGER_VERSION = 2;

export interface PersistedLedger {
	version: number;
	days: Record<string, Record<BucketKey, TokenTotals>>;
}

export function serializeLedger(ledger: DailyLedger): PersistedLedger {
	const days: Record<string, Record<BucketKey, TokenTotals>> = {};
	for (const [day, buckets] of ledger.days) {
		const rec: Record<BucketKey, TokenTotals> = {};
		for (const [key, t] of buckets) rec[key] = t;
		days[String(day)] = rec;
	}
	return { version: LEDGER_VERSION, days };
}

function isTotals(v: unknown): v is TokenTotals {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as TokenTotals).input === "number" &&
		typeof (v as TokenTotals).output === "number" &&
		typeof (v as TokenTotals).billable === "number" &&
		typeof (v as TokenTotals).raw === "number"
	);
}

// Returns null for anything we cannot safely accumulate onto — a missing/lower
// version or malformed shape. The caller responds by resetting offsets to 0 and
// doing the one-time full scan (spec §4.2), which rebuilds a clean ledger.
export function deserializeLedger(raw: unknown): DailyLedger | null {
	if (typeof raw !== "object" || raw === null) return null;
	const obj = raw as Partial<PersistedLedger>;
	if (obj.version !== LEDGER_VERSION || typeof obj.days !== "object" || obj.days === null) {
		return null;
	}
	const ledger = createLedger();
	for (const [dayStr, buckets] of Object.entries(obj.days)) {
		const day = Number(dayStr);
		if (!Number.isFinite(day) || typeof buckets !== "object" || buckets === null) continue;
		const map = new Map<BucketKey, TokenTotals>();
		for (const [key, t] of Object.entries(buckets)) {
			if (!isTotals(t)) continue;
			const dst = emptyTotals();
			dst.input = t.input;
			dst.output = t.output;
			dst.billable = t.billable;
			dst.raw = t.raw;
			map.set(key, dst);
		}
		ledger.days.set(day, map);
	}
	return ledger;
}

// Persist the ledger and offset cache as ONE combined state file, committed
// atomically (write a temp file, then rename over the target). A crash can never
// leave a torn pair: the on-disk state is always either the prior fully-committed
// state or the new fully-committed state (spec §4.3: a persisted, accumulated
// ledger must never double-count — even across a crash between writes).
export function saveState(
	path: string,
	ledger: DailyLedger,
	offsets: OffsetCache,
	codexLimits: ProviderRateLimits | null,
): void {
	const payload = {
		...serializeLedger(ledger),
		offsets: Object.fromEntries(offsets),
		// Last-known codex rate limits, cached so the "Codex limits" gauge survives a
		// restart (the worker no longer re-reads old log files on launch, so it would
		// otherwise show nothing until codex next appends a rate-limit line).
		codexLimits,
	};
	const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(tmp, JSON.stringify(payload), "utf8");
	renameSync(tmp, path); // atomic commit: a crash leaves the prior file intact
}

export function loadState(path: string): {
	ledger: DailyLedger;
	offsets: OffsetCache;
	codexLimits: ProviderRateLimits | null;
} | null {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null; // missing / corrupt → rebuild
	}
	const ledger = deserializeLedger(raw); // validates version === 2 + days shape
	if (!ledger) return null; // missing/lower/malformed → rebuild
	const offsetsRaw = (raw as { offsets?: unknown }).offsets;
	if (typeof offsetsRaw !== "object" || offsetsRaw === null) return null; // old two-file format (no offsets field) → rebuild
	const offsets = new Map(Object.entries(offsetsRaw as Record<string, OffsetEntry>));
	// Best-effort cache; the pre-codexLimits format omits it → null. It refreshes as
	// soon as the sweep reads a fresh codex rate-limit line.
	const cl = (raw as { codexLimits?: unknown }).codexLimits;
	const codexLimits = cl && typeof cl === "object" ? (cl as ProviderRateLimits) : null;
	return { ledger, offsets, codexLimits };
}
