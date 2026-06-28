import { mkdirSync, mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSweepState, loadPersistedState, sweepFiles } from "../../../services/usage/sweep.js";
import { saveLedger } from "../../../services/usage/ledger-store.js";
import { claudeDriver } from "../../../services/usage/providers/claude.js";
import type { TelemetryDriver } from "../../../services/usage/providers/types.js";

function claudeLine(outputTokens: number): string {
	return (
		JSON.stringify({
			type: "assistant",
			timestamp: "2026-05-01T00:00:00.000Z",
			cwd: "/Users/me/Dev/app",
			sessionId: "s1",
			message: { model: "m", usage: { output_tokens: outputTokens } },
		}) + "\n"
	);
}

const sumBillable = (state: ReturnType<typeof createSweepState>): number => {
	let n = 0;
	for (const buckets of state.ledger.days.values())
		for (const t of buckets.values()) n += t.billable;
	return n;
};

describe("sweepFiles sealed-truncation full rebuild", () => {
	it("rebuilds to the correct non-double-counted total after a sealed-file truncation", async () => {
		const root = mkdtempSync(join(tmpdir(), "sweep-sealed-"));
		const proj = join(root, "-Users-me-Dev-app");
		mkdirSync(proj);
		const file = join(proj, "s1.jsonl");
		writeFileSync(file, claudeLine(10) + claudeLine(10)); // 20 billable

		// Stub driver: roots() IS our temp dir, parsing reuses claude — electron-free and
		// independent of claude's real ~/.claude path.
		const driver: TelemetryDriver = {
			id: "claude",
			capabilities: claudeDriver.capabilities,
			roots: () => [root],
			keep: claudeDriver.keep,
			seedCtx: claudeDriver.seedCtx,
			parseLine: claudeDriver.parseLine,
		};

		const state = createSweepState();
		const first = await sweepFiles(state, [driver], "ignored-home", 0, 8);
		expect(first.rebuilt).toBe(false);
		expect(sumBillable(state)).toBe(20);

		// Seal the file: drop its contribution detail (mirrors the worker's seal pass).
		const entry = state.offsets.get(file)!;
		expect(entry.contribution).toBeDefined();
		delete entry.contribution;

		// Truncate + rewrite shorter; bump mtime so changed() detects it.
		truncateSync(file, 0);
		writeFileSync(file, claudeLine(4)); // 4 billable
		const future = Date.now() + 10_000;
		utimesSync(file, future / 1000, future / 1000);

		const second = await sweepFiles(state, [driver], "ignored-home", 0, 8);
		expect(second.rebuilt).toBe(true); // the full rebuild RAN
		expect(sumBillable(state)).toBe(4); // re-read from byte 0 — not 24 (double), not 20 (stale)
	});
});

describe("loadPersistedState pair-consistency", () => {
	function makeRoot(): { root: string; driver: TelemetryDriver } {
		const root = mkdtempSync(join(tmpdir(), "sweep-persist-"));
		mkdirSync(join(root, "-Users-me-Dev-app"));
		writeFileSync(join(root, "-Users-me-Dev-app", "s1.jsonl"), claudeLine(10) + claudeLine(10)); // 20 billable
		const driver: TelemetryDriver = {
			id: "claude",
			capabilities: claudeDriver.capabilities,
			roots: () => [root],
			keep: claudeDriver.keep,
			seedCtx: claudeDriver.seedCtx,
			parseLine: claudeDriver.parseLine,
		};
		return { root, driver };
	}

	it("ledger present + offsets MISSING → fresh state (no double-count)", async () => {
		const { root, driver } = makeRoot();
		const ledgerPath = join(root, "usage-ledger.json");
		const offsetsPath = join(root, "usage-offsets.json");

		// First sweep → 20 billable; persist ledger only (no offsets file).
		const s1 = createSweepState();
		await sweepFiles(s1, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s1)).toBe(20);
		saveLedger(ledgerPath, s1.ledger);
		// deliberately do NOT write offsetsPath

		// loadPersistedState with missing offsets → fresh state.
		const s2 = loadPersistedState(ledgerPath, offsetsPath);
		expect(sumBillable(s2)).toBe(0);
		expect(s2.offsets.size).toBe(0);

		// A subsequent sweep on the fresh state reads the 20 lines exactly once.
		await sweepFiles(s2, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s2)).toBe(20); // NOT 40
	});

	it("ledger present + offsets CORRUPT → fresh state", () => {
		const { root } = makeRoot();
		const ledgerPath = join(root, "usage-ledger.json");
		const offsetsPath = join(root, "usage-offsets.json");

		const s1 = createSweepState();
		saveLedger(ledgerPath, s1.ledger);
		writeFileSync(offsetsPath, "{ not json", "utf8");

		const s2 = loadPersistedState(ledgerPath, offsetsPath);
		expect(sumBillable(s2)).toBe(0);
		expect(s2.offsets.size).toBe(0);
	});

	it("ledger + valid matching offsets → resumes (no re-read)", async () => {
		const { root, driver } = makeRoot();
		const ledgerPath = join(root, "usage-ledger.json");
		const offsetsPath = join(root, "usage-offsets.json");

		// First sweep → 20; persist both.
		const s1 = createSweepState();
		await sweepFiles(s1, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s1)).toBe(20);
		saveLedger(ledgerPath, s1.ledger);
		writeFileSync(offsetsPath, JSON.stringify(Object.fromEntries(s1.offsets)), "utf8");

		// Resume from persisted pair → ledger already populated.
		const s2 = loadPersistedState(ledgerPath, offsetsPath);
		expect(sumBillable(s2)).toBe(20);

		// Another sweep with no new bytes → still 20 (no re-read from byte 0).
		await sweepFiles(s2, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s2)).toBe(20);
	});

	it("no ledger → fresh state", () => {
		const root = mkdtempSync(join(tmpdir(), "sweep-nyledger-"));
		const ledgerPath = join(root, "usage-ledger.json");
		const offsetsPath = join(root, "usage-offsets.json");

		const s2 = loadPersistedState(ledgerPath, offsetsPath);
		expect(sumBillable(s2)).toBe(0);
		expect(s2.offsets.size).toBe(0);

		rmSync(root, { recursive: true, force: true });
	});
});
