import { readFileSync, writeFileSync } from "node:fs";
import type { TokenTotals } from "../../shared/models/usage.js";
import { type BucketKey, type DailyLedger, createLedger, emptyTotals } from "./ledger.js";

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

export function loadLedger(path: string): DailyLedger | null {
	try {
		return deserializeLedger(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return null; // missing file / parse error -> rebuild
	}
}

export function saveLedger(path: string, ledger: DailyLedger): void {
	writeFileSync(path, JSON.stringify(serializeLedger(ledger)), "utf8");
}
