import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLedger, createSession, ingestEvent, bucketKey, startOfLocalDay } from "../../../services/usage/ledger.js";
import {
	LEDGER_VERSION,
	deserializeLedger,
	loadLedger,
	saveLedger,
	serializeLedger,
} from "../../../services/usage/ledger-store.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "codex", timestampMs: 0, cwd: "/a", sessionId: "s", model: "m",
	input: 0, output: 0, billable: 0, raw: 0, ...over,
});

describe("ledger-store", () => {
	it("save -> load round-trips the ledger and writes the \\u0000 as an escape", () => {
		const ledger = createLedger();
		const session = createSession();
		const t = startOfLocalDay(Date.now()) + 3_600_000;
		// timestampMs MUST be `t` so the event lands in the startOfLocalDay(t) bucket the
		// assertion below looks up. The factory default of 0 would bucket it under epoch,
		// making this test pass/fail for the wrong reason instead of proving persistence.
		ingestEvent(ledger, session, ev({ timestampMs: t, cwd: "/a", provider: "claude", model: "claude-opus-4-8", billable: 7, raw: 70, input: 5, output: 2 }), 0);
		const dir = mkdtempSync(join(tmpdir(), "ledger-"));
		const path = join(dir, "usage-ledger.json");
		saveLedger(path, ledger);
		// The persisted JSON must NOT contain a raw NUL byte — the BucketKey separator is
		// serialized as a JSON unicode escape, so the on-disk bytes stay pure UTF-8.
		const bytes = readFileSync(path);
		expect(bytes.includes(0)).toBe(false); // no raw NUL byte (char code 0) on disk
		const loaded = loadLedger(path);
		expect(loaded).not.toBeNull();
		const day = loaded!.days.get(startOfLocalDay(t));
		// round-trip proves the NUL-separated key survived save -> load intact
		expect(day?.get(bucketKey("/a", "claude", "claude-opus-4-8"))).toEqual({ input: 5, output: 2, billable: 7, raw: 70 });
	});

	it("serializeLedger stamps the current version", () => {
		expect(serializeLedger(createLedger()).version).toBe(LEDGER_VERSION);
	});

	it("deserializeLedger returns null on a lower version (forces a rebuild)", () => {
		expect(deserializeLedger({ version: 1, days: {} })).toBeNull();
		expect(deserializeLedger("garbage")).toBeNull();
		expect(deserializeLedger({ version: LEDGER_VERSION, days: {} })).not.toBeNull();
	});

	it("loadLedger returns null when the file is missing", () => {
		expect(loadLedger(join(mkdtempSync(join(tmpdir(), "ledger-")), "nope.json"))).toBeNull();
	});
});
