import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createLedger,
	createSession,
	ingestEvent,
	bucketKey,
	startOfLocalDay,
} from "../../../services/usage/ledger.js";
import {
	CORRUPT_BUCKET_KEY,
	CORRUPT_DAY_KEY,
	LEDGER_VERSION,
	deserializeLedger,
	loadState,
	saveState,
	serializeLedger,
} from "../../../services/usage/ledger-store.js";
import type { OffsetCache } from "../../../services/usage/scanner.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "codex",
	timestampMs: 0,
	cwd: "/a",
	sessionId: "s",
	model: "m",
	input: 0,
	output: 0,
	billable: 0,
	raw: 0,
	...over,
});

describe("ledger-store", () => {
	it("saveState -> loadState round-trips the ledger + offsets and writes the \\u0000 as an escape", () => {
		const ledger = createLedger();
		const session = createSession();
		const t = startOfLocalDay(Date.now()) + 3_600_000;
		// timestampMs MUST be `t` so the event lands in the startOfLocalDay(t) bucket the
		// assertion below looks up. The factory default of 0 would bucket it under epoch,
		// making this test pass/fail for the wrong reason instead of proving persistence.
		ingestEvent(
			ledger,
			session,
			ev({
				timestampMs: t,
				cwd: "/a",
				provider: "claude",
				model: "claude-opus-4-8",
				billable: 7,
				raw: 70,
				input: 5,
				output: 2,
			}),
			0,
		);
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
		expect(day?.get(bucketKey("/a", "claude", "claude-opus-4-8"))).toEqual({
			input: 5,
			output: 2,
			billable: 7,
			raw: 70,
		});
		// the offset cache round-trips alongside the ledger (one atomic file)
		expect(loaded!.offsets.get("/a/s1.jsonl")).toEqual({
			offset: 42,
			mtime: 1_700_000_000_000,
		});
	});

	it("round-trips codexLimits so the gauge survives a restart; null when absent", () => {
		const limits = {
			capturedAtMs: 1_700_000_000_000,
			planType: "pro",
			primary: {
				usedPercent: 72,
				windowMinutes: 300,
				resetsAtMs: 1_700_000_018_000,
			},
			secondary: {
				usedPercent: 11,
				windowMinutes: 10_080,
				resetsAtMs: 1_700_000_604_000,
			},
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
		expect(
			deserializeLedger({ version: LEDGER_VERSION, days: {} }),
		).not.toBeNull();
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
		writeFileSync(
			lower,
			JSON.stringify({ version: 1, days: {}, offsets: {} }),
			"utf8",
		);
		expect(loadState(lower)).toBeNull();
		// old two-file format: a valid ledger but NO offsets field
		const noOffsets = join(dir, "no-offsets.json");
		writeFileSync(
			noOffsets,
			JSON.stringify({ version: LEDGER_VERSION, days: {} }),
			"utf8",
		);
		expect(loadState(noOffsets)).toBeNull();
	});
});

describe("v2 -> v3 migration (D3 surgical strip)", () => {
	// The expected corrupt identity is written out as INDEPENDENT literals from
	// spec §4 D3 — never derived from the implementation's exported constants.
	// If a production constant regressed (typo'd day key, wrong cwd slug), fixtures
	// built FROM those constants would drift with the bug and the migration would
	// strip the test's equally-wrong entry while missing the real one on disk.
	const NUL = "\u0000"; // BUCKET_SEP, spelled out independently
	const EXPECTED_DAY = 1782838800000; // 2026-06-30T17:00:00.000Z — spec §4 literal
	const EXPECTED_KEY = `SMOKE-perEvent-test${NUL}ezio${NUL}gpt-5-codex`; // spec §4 literal
	const DAY = 86_400_000;
	const t = (n: number) => ({ input: 0, output: n, billable: n, raw: n });
	const corrupt = t(1_332_000);
	const otherDayKey = EXPECTED_DAY + 10 * DAY;

	it("production constants equal the spec's literal corrupt identity", () => {
		expect(CORRUPT_DAY_KEY).toBe(EXPECTED_DAY);
		expect(CORRUPT_BUCKET_KEY).toBe(EXPECTED_KEY);
	});

	const v2Payload = () => ({
		version: 2,
		days: {
			[String(EXPECTED_DAY)]: {
				[EXPECTED_KEY]: corrupt,
				[`/Users/me/Dev/app${NUL}ezio${NUL}gpt-5-codex`]: t(11), // different cwd, SAME day
				[`/Users/me/Dev/app${NUL}claude${NUL}claude-opus-4-8`]: t(22),
			},
			[String(EXPECTED_DAY - DAY)]: { [EXPECTED_KEY]: t(33) }, // June-29 neighbor
			[String(EXPECTED_DAY + DAY)]: { [EXPECTED_KEY]: t(44) }, // July-1 neighbor
			[String(otherDayKey)]: { [EXPECTED_KEY]: t(55) }, // distant day
		},
		offsets: {
			"/home/me/.local/state/ezio/sessions/Users-me-Dev-app/unknown-0.record.jsonl":
				{ offset: 10, mtime: 1 },
			"/home/me/.local/state/hax/sessions/d.abc/f.jsonl": {
				offset: 20,
				mtime: 2,
			},
			"/home/me/.claude/projects/p/s.jsonl": { offset: 30, mtime: 3 },
			"/home/me/.codex/sessions/r.jsonl": { offset: 40, mtime: 4 },
		} as Record<string, { offset: number; mtime: number }>,
		codexLimits: null,
	});

	const writeAndLoad = (payload: unknown) => {
		const dir = mkdtempSync(join(tmpdir(), "ledger-mig-"));
		const path = join(dir, "usage-ledger.json");
		writeFileSync(path, JSON.stringify(payload));
		return loadState(path);
	};

	it("strips exactly the corrupt bucket and preserves every neighbor", () => {
		const st = writeAndLoad(v2Payload());
		expect(st).not.toBeNull();
		const days = st!.ledger.days;
		// Corrupt bucket gone; same-day survivors intact (day entry NOT dropped).
		expect(days.get(EXPECTED_DAY)?.has(EXPECTED_KEY)).toBe(false);
		expect(
			days
				.get(EXPECTED_DAY)
				?.get(`/Users/me/Dev/app${NUL}ezio${NUL}gpt-5-codex`),
		).toEqual(t(11));
		expect(
			days
				.get(EXPECTED_DAY)
				?.get(`/Users/me/Dev/app${NUL}claude${NUL}claude-opus-4-8`),
		).toEqual(t(22));
		// Adjacent-day and distant-day same-key buckets survive.
		expect(days.get(EXPECTED_DAY - DAY)?.get(EXPECTED_KEY)).toEqual(t(33));
		expect(days.get(EXPECTED_DAY + DAY)?.get(EXPECTED_KEY)).toEqual(t(44));
		expect(days.get(otherDayKey)?.get(EXPECTED_KEY)).toEqual(t(55));
	});

	it("drops the day entry when the strip empties it", () => {
		const p = v2Payload();
		p.days[String(EXPECTED_DAY)] = { [EXPECTED_KEY]: corrupt };
		const st = writeAndLoad(p);
		expect(st!.ledger.days.has(EXPECTED_DAY)).toBe(false);
	});

	it("prunes retired ezio-root offsets and keeps claude/codex/hax offsets", () => {
		const st = writeAndLoad(v2Payload());
		const keys = [...st!.offsets.keys()];
		expect(keys.some((k) => k.includes("/.local/state/ezio/sessions/"))).toBe(
			false,
		);
		expect(keys).toContain("/home/me/.local/state/hax/sessions/d.abc/f.jsonl");
		expect(keys).toContain("/home/me/.claude/projects/p/s.jsonl");
		expect(keys).toContain("/home/me/.codex/sessions/r.jsonl");
	});

	it("is an idempotent no-op on a v2 file without the corrupt entry", () => {
		const p = v2Payload();
		delete p.days[String(EXPECTED_DAY)];
		p.offsets = {
			"/home/me/.claude/projects/p/s.jsonl": { offset: 30, mtime: 3 },
		};
		const st = writeAndLoad(p);
		expect(st).not.toBeNull();
		expect(st!.ledger.days.get(otherDayKey)?.get(EXPECTED_KEY)).toEqual(t(55));
		expect(st!.offsets.size).toBe(1);
	});

	it("round-trips version 3 and still rejects version 1", () => {
		expect(LEDGER_VERSION).toBe(3);
		const v3 = { ...v2Payload(), version: 3 };
		const st3 = writeAndLoad(v3);
		// v3 loads WITHOUT migration: the corrupt bucket is trusted as-is.
		expect(st3!.ledger.days.get(EXPECTED_DAY)?.has(EXPECTED_KEY)).toBe(true);
		expect(writeAndLoad({ ...v2Payload(), version: 1 })).toBeNull();
	});
});
