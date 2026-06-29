import { mkdirSync, mkdtempSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createSweepState,
	loadPersistedState,
	recoverCodexLimits,
	sweepFiles,
} from "../../../services/usage/sweep.js";
import { saveState } from "../../../services/usage/ledger-store.js";
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

describe("loadPersistedState single atomic state file", () => {
	// state file == the single combined ledger+offsets file the worker now persists.
	function setup(): { proj: string; statePath: string; driver: TelemetryDriver } {
		const root = mkdtempSync(join(tmpdir(), "sweep-persist-"));
		const proj = join(root, "-Users-me-Dev-app");
		mkdirSync(proj);
		const driver: TelemetryDriver = {
			id: "claude",
			capabilities: claudeDriver.capabilities,
			roots: () => [root],
			keep: claudeDriver.keep,
			seedCtx: claudeDriver.seedCtx,
			parseLine: claudeDriver.parseLine,
		};
		return { proj, statePath: join(root, "usage-ledger.json"), driver };
	}

	it("crash between ledger and offset writes does NOT double-count", async () => {
		const { proj, statePath, driver } = setup();
		writeFileSync(join(proj, "a.jsonl"), claudeLine(10)); // file A: 10 billable

		// Sweep A, then commit the fully-persisted state (ledger=10 + offsets listing A).
		const s1 = createSweepState();
		await sweepFiles(s1, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s1)).toBe(10);
		saveState(statePath, s1.ledger, s1.offsets, null); // the last fully-committed state

		// A NEW file B lands on disk, but the next persist never runs (crash before persist).
		writeFileSync(join(proj, "b.jsonl"), claudeLine(7)); // file B: 7 billable

		// Restart: the loaded state is the consistent committed pair → ledger is exactly 10.
		const s2 = loadPersistedState(statePath);
		expect(sumBillable(s2)).toBe(10);

		// Next sweep ingests B exactly once → 17, NOT 24 (a stale-offset re-read of B
		// onto an already-counted ledger). This is THE regression for spec §4.3.
		await sweepFiles(s2, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s2)).toBe(17);
	});

	it("missing state file → rebuild", () => {
		const { statePath } = setup();
		const s = loadPersistedState(statePath); // never written
		expect(sumBillable(s)).toBe(0);
		expect(s.offsets.size).toBe(0);
	});

	it("corrupt state file → rebuild", () => {
		const { statePath } = setup();
		writeFileSync(statePath, "{ not json", "utf8");
		const s = loadPersistedState(statePath);
		expect(sumBillable(s)).toBe(0);
		expect(s.offsets.size).toBe(0);
	});

	it("valid committed state → resumes without re-read", async () => {
		const { proj, statePath, driver } = setup();
		writeFileSync(join(proj, "a.jsonl"), claudeLine(10)); // 10 billable

		const s1 = createSweepState();
		await sweepFiles(s1, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s1)).toBe(10);
		saveState(statePath, s1.ledger, s1.offsets, null);

		const s2 = loadPersistedState(statePath);
		expect(sumBillable(s2)).toBe(10);

		// No new bytes → still 10 (resumed from the saved offset, not re-read from byte 0).
		await sweepFiles(s2, [driver], "ignored-home", 0, 8);
		expect(sumBillable(s2)).toBe(10);
	});

	it("old two-file format (ledger JSON without offsets field) → rebuild", () => {
		const { statePath } = setup();
		// A legacy ledger-only file: valid version 2 + one day/bucket, but NO offsets key.
		const payload = {
			version: 2,
			days: { "100000": { k: { input: 0, output: 10, billable: 10, raw: 100 } } },
		};
		writeFileSync(statePath, JSON.stringify(payload), "utf8");
		const s = loadPersistedState(statePath);
		expect(sumBillable(s)).toBe(0);
	});

	it("restores persisted codexLimits so the Codex gauge survives a restart", () => {
		const { statePath } = setup();
		const limits = {
			capturedAtMs: 1_700_000_000_000,
			planType: "pro",
			primary: { usedPercent: 72, windowMinutes: 300, resetsAtMs: 1_700_000_018_000 },
			secondary: { usedPercent: 11, windowMinutes: 10_080, resetsAtMs: 1_700_000_604_000 },
		};
		saveState(statePath, createSweepState().ledger, new Map(), limits);
		expect(loadPersistedState(statePath).codexLimits).toEqual(limits);
	});

	it("recoverCodexLimits reads the latest codex rate-limit straight from the logs (offset-independent, latest wins)", () => {
		const home = mkdtempSync(join(tmpdir(), "codex-home-"));
		const dir = join(home, ".codex", "sessions", "2026", "06", "29");
		mkdirSync(dir, { recursive: true });
		const line = (pct: number, ts: string): string =>
			JSON.stringify({
				timestamp: ts,
				type: "event_msg",
				payload: {
					type: "token_count",
					info: {},
					rate_limits: {
						primary: { used_percent: pct, window_minutes: 300, resets_at: 1_782_739_536 },
						secondary: { used_percent: 11, window_minutes: 10_080, resets_at: 1_783_302_935 },
						plan_type: "plus",
					},
				},
			});
		// two rate-limit lines; the one with the LATER timestamp must win
		writeFileSync(
			join(dir, "roll.jsonl"),
			`${line(1, "2026-06-29T08:00:00.000Z")}\n${line(72, "2026-06-29T09:00:00.000Z")}\n`,
		);
		const rl = recoverCodexLimits(home);
		expect(rl?.primary?.usedPercent).toBe(72);
		expect(rl?.secondary?.usedPercent).toBe(11);
		expect(rl?.planType).toBe("plus");
		// resets_at (seconds) is converted to ms
		expect(rl?.primary?.resetsAtMs).toBe(1_782_739_536_000);
	});
});
