import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLedger, createSession, ingestEvent, bucketKey, startOfLocalDay } from "../../../services/usage/ledger.js";
import {
	LEDGER_VERSION,
	deserializeLedger,
	loadState,
	saveState,
	serializeLedger,
} from "../../../services/usage/ledger-store.js";
import type { OffsetCache } from "../../../services/usage/scanner.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "codex", timestampMs: 0, cwd: "/a", sessionId: "s", model: "m",
	input: 0, output: 0, billable: 0, raw: 0, ...over,
});

describe("ledger-store", () => {
	it("saveState -> loadState round-trips the ledger + offsets and writes the \\u0000 as an escape", () => {
		const ledger = createLedger();
		const session = createSession();
		const t = startOfLocalDay(Date.now()) + 3_600_000;
		// timestampMs MUST be `t` so the event lands in the startOfLocalDay(t) bucket the
		// assertion below looks up. The factory default of 0 would bucket it under epoch,
		// making this test pass/fail for the wrong reason instead of proving persistence.
		ingestEvent(ledger, session, ev({ timestampMs: t, cwd: "/a", provider: "claude", model: "claude-opus-4-8", billable: 7, raw: 70, input: 5, output: 2 }), 0);
		const offsets: OffsetCache = new Map([
			["/a/s1.jsonl", { offset: 42, mtime: 1_700_000_000_000 }],
		]);
		const dir = mkdtempSync(join(tmpdir(), "ledger-"));
		const path = join(dir, "usage-ledger.json");
		saveState(path, ledger, offsets, null);
		// The persisted JSON must NOT contain a raw NUL byte — the BucketKey separator is
		// serialized as a JSON unicode escape, so the on-disk bytes stay pure UTF-8.
		const bytes = readFileSync(path);
		expect(bytes.includes(0)).toBe(false); // no raw NUL byte (char code 0) on disk
		const loaded = loadState(path);
		expect(loaded).not.toBeNull();
		const day = loaded!.ledger.days.get(startOfLocalDay(t));
		// round-trip proves the NUL-separated key survived save -> load intact
		expect(day?.get(bucketKey("/a", "claude", "claude-opus-4-8"))).toEqual({ input: 5, output: 2, billable: 7, raw: 70 });
		// the offset cache round-trips alongside the ledger (one atomic file)
		expect(loaded!.offsets.get("/a/s1.jsonl")).toEqual({ offset: 42, mtime: 1_700_000_000_000 });
	});

	it("round-trips codexLimits so the gauge survives a restart; null when absent", () => {
		const limits = {
			capturedAtMs: 1_700_000_000_000,
			planType: "pro",
			primary: { usedPercent: 72, windowMinutes: 300, resetsAtMs: 1_700_000_018_000 },
			secondary: { usedPercent: 11, windowMinutes: 10_080, resetsAtMs: 1_700_000_604_000 },
		};
		const dir = mkdtempSync(join(tmpdir(), "ledger-"));
		const path = join(dir, "usage-ledger.json");
		saveState(path, createLedger(), new Map(), limits);
		expect(loadState(path)?.codexLimits).toEqual(limits);
		// a state written without limits (no codex yet) restores null
		saveState(path, createLedger(), new Map(), null);
		expect(loadState(path)?.codexLimits).toBeNull();
	});

	it("serializeLedger stamps the current version", () => {
		expect(serializeLedger(createLedger()).version).toBe(LEDGER_VERSION);
	});

	it("deserializeLedger returns null on a lower version (forces a rebuild)", () => {
		expect(deserializeLedger({ version: 1, days: {} })).toBeNull();
		expect(deserializeLedger("garbage")).toBeNull();
		expect(deserializeLedger({ version: LEDGER_VERSION, days: {} })).not.toBeNull();
	});

	it("loadState returns null for missing / corrupt / lower-version / no-offsets-field files", () => {
		const dir = mkdtempSync(join(tmpdir(), "ledger-"));
		// missing file
		expect(loadState(join(dir, "nope.json"))).toBeNull();
		// corrupt JSON
		const corrupt = join(dir, "corrupt.json");
		writeFileSync(corrupt, "{ not json", "utf8");
		expect(loadState(corrupt)).toBeNull();
		// lower-version payload (rejected by deserializeLedger before offsets are read)
		const lower = join(dir, "lower.json");
		writeFileSync(lower, JSON.stringify({ version: 1, days: {}, offsets: {} }), "utf8");
		expect(loadState(lower)).toBeNull();
		// old two-file format: a valid ledger but NO offsets field
		const noOffsets = join(dir, "no-offsets.json");
		writeFileSync(noOffsets, JSON.stringify({ version: LEDGER_VERSION, days: {} }), "utf8");
		expect(loadState(noOffsets)).toBeNull();
	});
});
