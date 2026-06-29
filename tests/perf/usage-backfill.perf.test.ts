import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createLedger,
	createSession,
	ingestEvent,
} from "../../services/usage/ledger.js";
import { processInBatches } from "../../services/usage/batch.js";
import {
	listJsonlFiles,
	processClaudeFile,
	type OffsetCache,
} from "../../services/usage/scanner.js";

function buildFixture(fileCount: number, linesPerFile: number): string {
	const root = mkdtempSync(join(tmpdir(), "usage-perf-"));
	for (let f = 0; f < fileCount; f++) {
		const proj = join(root, `-proj-${f}`);
		mkdirSync(proj);
		const lines: string[] = [];
		for (let i = 0; i < linesPerFile; i++) {
			if (i % 5 === 0) {
				lines.push(
					JSON.stringify({
						type: "assistant",
						timestamp: "2026-05-01T00:00:00.000Z",
						cwd: `/p/${f}`,
						sessionId: `s${f}`,
						message: { model: "m", usage: { output_tokens: 1 } },
					}),
				);
			} else {
				// Large NON-usage line: must be skipped by the marker pre-filter before
				// any JSON.parse, which is what keeps the backfill within budget.
				lines.push(
					JSON.stringify({
						type: "user",
						message: { content: "x".repeat(4000) },
					}),
				);
			}
		}
		writeFileSync(join(proj, "s.jsonl"), lines.join("\n") + "\n");
	}
	return root;
}

describe("usage backfill perf guard", () => {
	it("chunked backfill over a large fixture stays within budget and yields the event loop", async () => {
		const fileCount = 250;
		const linesPerFile = 400; // 100k total lines; 80k are large non-usage lines
		const root = buildFixture(fileCount, linesPerFile);
		const files = listJsonlFiles(root);
		const offsets: OffsetCache = new Map();
		const ledger = createLedger();
		const session = createSession();

		let timerRan = false;
		setTimeout(() => {
			timerRan = true;
		}, 0);

		const start = Date.now();
		await processInBatches(files, 8, (file) =>
			processClaudeFile(file, offsets, (e) =>
				ingestEvent(ledger, session, e, 0),
			),
		);
		const elapsed = Date.now() - start;

		// Time budget: the marker pre-filter skips the 80k large lines, so only ~20k
		// usage lines are parsed — comfortably under budget on CI hardware.
		expect(elapsed).toBeLessThan(5000);
		// Off-main-thread proxy: the loop yielded between batches, so a 0ms timer ran
		// mid-backfill instead of being starved by a synchronous sweep.
		expect(timerRan).toBe(true);
		// Correctness sanity: one usage event per 5 lines per file.
		let billable = 0;
		for (const buckets of ledger.days.values())
			for (const t of buckets.values()) billable += t.billable;
		expect(billable).toBe(fileCount * (linesPerFile / 5)); // each file: linesPerFile/5 usage lines of 1 token
	});
});
