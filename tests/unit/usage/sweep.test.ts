import { mkdirSync, mkdtempSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSweepState, sweepFiles } from "../../../services/usage/sweep.js";
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
