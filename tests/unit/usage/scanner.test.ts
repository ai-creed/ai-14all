import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { UsageEvent } from "../../../shared/models/usage.js";
import { WEEK_MS } from "../../../services/usage/aggregator.js";
import {
	processCodexFile,
	resetRecentOffsets,
	scanClaude,
	scanCodex,
	type OffsetCache,
} from "../../../services/usage/scanner.js";

function writeClaudeEvent(dir: string, file: string, isoTs: string): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, file);
	writeFileSync(
		path,
		JSON.stringify({
			type: "assistant",
			timestamp: isoTs,
			cwd: "/Users/me/Dev/app",
			sessionId: "s1",
			message: { model: "m", usage: { output_tokens: 10 } },
		}) + "\n",
	);
	return path;
}

describe("scanners", () => {
	it("scanClaude parses assistant usage lines under project dirs", () => {
		const root = mkdtempSync(join(tmpdir(), "claude-"));
		const proj = join(root, "-Users-me-Dev-app");
		mkdirSync(proj);
		writeFileSync(
			join(proj, "s1.jsonl"),
			JSON.stringify({
				type: "assistant",
				timestamp: "2026-05-01T00:00:00.000Z",
				cwd: "/Users/me/Dev/app",
				sessionId: "s1",
				message: { model: "m", usage: { output_tokens: 10 } },
			}) + "\n",
		);
		const offsets = new Map<string, { offset: number; mtime: number }>();
		const events = scanClaude(root, offsets);
		expect(events).toHaveLength(1);
		expect(events[0].billable).toBe(10);
		expect(scanClaude(root, offsets)).toHaveLength(0);
	});
	it("resetRecentOffsets makes a relaunch re-read recently-active files (rebuilds the week window)", () => {
		// Simulates: app run 1 ingests a file, persists offsets at EOF; on relaunch
		// the aggregator is empty, so resuming at the persisted offset would lose
		// this week's pre-launch usage. resetRecentOffsets forces a re-read.
		const root = mkdtempSync(join(tmpdir(), "claude-relaunch-"));
		writeClaudeEvent(
			join(root, "-Users-me-Dev-app"),
			"s1.jsonl",
			new Date().toISOString(),
		);

		const offsets: OffsetCache = new Map();
		expect(scanClaude(root, offsets)).toHaveLength(1);
		// Same cache (as if persisted + reloaded): resume at EOF => nothing.
		expect(scanClaude(root, offsets)).toHaveLength(0);

		// The fix: drop offsets for files active within the window so the next
		// scan re-ingests them into the fresh aggregator.
		resetRecentOffsets([root], offsets, Date.now(), WEEK_MS);
		expect(scanClaude(root, offsets)).toHaveLength(1);
	});

	it("resetRecentOffsets leaves files older than the window untouched", () => {
		const root = mkdtempSync(join(tmpdir(), "claude-stale-"));
		const file = writeClaudeEvent(
			join(root, "-Users-me-Dev-app"),
			"old.jsonl",
			"2026-01-01T00:00:00.000Z",
		);
		const offsets: OffsetCache = new Map();
		scanClaude(root, offsets);
		expect(offsets.has(file)).toBe(true);

		// Mark the file as last-modified 8 days ago.
		const eightDaysAgoSec = (Date.now() - 8 * 24 * 3_600_000) / 1000;
		utimesSync(file, eightDaysAgoSec, eightDaysAgoSec);

		resetRecentOffsets([root], offsets, Date.now(), WEEK_MS);
		// Outside the window => offset preserved (not re-read on relaunch).
		expect(offsets.has(file)).toBe(true);
	});

	it("scanCodex parses token_count and captures rate limits", () => {
		const root = mkdtempSync(join(tmpdir(), "codex-"));
		const day = join(root, "2026", "05", "21");
		mkdirSync(day, { recursive: true });
		const f = join(day, "rollout-2026-05-21T20-37-23-abc.jsonl");
		writeFileSync(
			f,
			[
				JSON.stringify({
					type: "session_meta",
					payload: { cwd: "/Users/me/Dev/app" },
				}),
				JSON.stringify({
					type: "turn_context",
					payload: { model: "gpt-5.5", cwd: "/Users/me/Dev/app" },
				}),
				JSON.stringify({
					timestamp: "2026-05-21T20:38:00.000Z",
					type: "event_msg",
					payload: {
						type: "token_count",
						info: {
							last_token_usage: { total_tokens: 100, cached_input_tokens: 40 },
						},
						rate_limits: {
							plan_type: "plus",
							primary: { used_percent: 3, window_minutes: 300, resets_at: 1 },
							secondary: {
								used_percent: 41,
								window_minutes: 10080,
								resets_at: 2,
							},
						},
					},
				}),
			].join("\n") + "\n",
		);
		const offsets = new Map<string, { offset: number; mtime: number }>();
		const result = scanCodex(root, offsets);
		expect(result.events[0]).toMatchObject({
			provider: "codex",
			cwd: "/Users/me/Dev/app",
			model: "gpt-5.5",
			billable: 60,
			raw: 100,
		});
		expect(result.limits?.secondary?.usedPercent).toBe(41);
	});

	it("processCodexFile threads cwd/model across worker restarts via cache", async () => {
		const root = mkdtempSync(join(tmpdir(), "codex-resume-"));
		const day = join(root, "2026", "05", "21");
		mkdirSync(day, { recursive: true });
		const f = join(day, "rollout-2026-05-21T20-37-23-abc.jsonl");
		writeFileSync(
			f,
			[
				JSON.stringify({
					type: "session_meta",
					payload: { cwd: "/Users/me/Dev/app" },
				}),
				JSON.stringify({
					type: "turn_context",
					payload: { model: "gpt-5.5", cwd: "/Users/me/Dev/app" },
				}),
				JSON.stringify({
					timestamp: "2026-05-21T20:38:00.000Z",
					type: "event_msg",
					payload: {
						type: "token_count",
						info: { last_token_usage: { total_tokens: 100 } },
					},
				}),
			].join("\n") + "\n",
		);
		const cache: OffsetCache = new Map();
		const first: UsageEvent[] = [];
		processCodexFile(f, cache, (e) => first.push(e));
		expect(first[0]?.cwd).toBe("/Users/me/Dev/app");
		expect(first[0]?.model).toBe("gpt-5.5");

		// Persist cache via JSON (the only thing that survives across worker
		// restarts) and reload it; then re-import the scanner so its module
		// state starts fresh (simulating the new utilityProcess instance).
		const persisted = JSON.parse(JSON.stringify(Object.fromEntries(cache)));
		const restored: OffsetCache = new Map(Object.entries(persisted));

		vi.resetModules();
		const fresh = await import("../../../services/usage/scanner.js");

		appendFileSync(
			f,
			JSON.stringify({
				timestamp: "2026-05-21T20:39:00.000Z",
				type: "event_msg",
				payload: {
					type: "token_count",
					info: { last_token_usage: { total_tokens: 50 } },
				},
			}) + "\n",
		);
		const second: UsageEvent[] = [];
		fresh.processCodexFile(f, restored, (e) => second.push(e));
		expect(second).toHaveLength(1);
		expect(second[0]?.cwd).toBe("/Users/me/Dev/app");
		expect(second[0]?.model).toBe("gpt-5.5");
	});
});
