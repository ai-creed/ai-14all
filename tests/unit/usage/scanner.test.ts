import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	statSync,
	truncateSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { UsageEvent } from "../../../shared/models/usage.js";
// resetRecentOffsets windows (formerly imported from the retired aggregator).
const WEEK_MS = 7 * 24 * 3_600_000;
const SERIES_WINDOW_MS = 35 * 86_400_000;
import {
	processCodexFile,
	processJsonlFile,
	resetRecentOffsets,
	scanClaude,
	scanCodex,
	type OffsetCache,
	type ScanHandlers,
} from "../../../services/usage/scanner.js";
import { ezioDriver } from "../../../services/usage/providers/ezio.js";
import type { TelemetryDriver } from "../../../services/usage/providers/types.js";
import { claudeDriver } from "../../../services/usage/providers/claude.js";
import {
	applyContribution,
	createLedger,
	createSession,
	ingestEvent,
	type ContributionJson,
} from "../../../services/usage/ledger.js";
import type { AgentProviderId } from "../../../shared/models/agent-provider.js";
import type { ProviderRateLimits } from "../../../shared/models/usage.js";

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

	describe("processJsonlFile (generic)", () => {
		it("threads the hax header cwd across appends and stamps file mtime", () => {
			const root = mkdtempSync(join(tmpdir(), "hax-"));
			const dir = join(root, "Users-me-Dev-app.abc123");
			mkdirSync(dir, { recursive: true });
			const file = join(dir, "2026-07-17T08-00-00Z_u1.jsonl");

			// Append 1: header only — no events, but ctx.cwd must persist in the cache.
			writeFileSync(
				file,
				'{"type":"session","version":1,"id":"sess-1","cwd":"/Users/me/Dev/app"}\n',
			);
			const cache: OffsetCache = new Map();
			const events: UsageEvent[] = [];
			const handlers = {
				ingest: (e: UsageEvent) => void events.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			};
			processJsonlFile(ezioDriver, file, cache, handlers);
			expect(events).toHaveLength(0);
			expect(cache.get(file)?.ctx?.cwd).toBe("/Users/me/Dev/app");

			// Append 2: a turn_usage row. Bump mtime so change detection re-reads.
			appendFileSync(
				file,
				'{"kind":"turn_usage","model":"gpt-5.6-terra","usage":{"input":1000,"output":200,"cached":600}}\n',
			);
			const later = Date.now() + 5_000;
			utimesSync(file, new Date(later), new Date(later));
			processJsonlFile(ezioDriver, file, cache, handlers);

			expect(events).toHaveLength(1);
			expect(events[0].provider).toBe("ezio");
			expect(events[0].cwd).toBe("/Users/me/Dev/app"); // from the append-1 header, via persisted ctx
			expect(events[0].sessionId).toBe("sess-1");
			expect(events[0].billable).toBe(600);
			// file-mtime driver: the event is stamped with the file's mtime, never 0.
			expect(events[0].timestampMs).toBe(statSync(file).mtimeMs);
		});

		it("stamps file mtime for a falsy timestampMs even when the driver is not file-mtime", () => {
			const root = mkdtempSync(join(tmpdir(), "falsy-ts-"));
			const file = join(root, "x.jsonl");
			writeFileSync(file, "x\n"); // content ignored; the fake driver keeps all lines
			const mtime = new Date("2026-06-15T00:00:00.000Z");
			utimesSync(file, mtime, mtime);

			// A per-event driver (NOT file-mtime) whose parser emits a 0 timestamp,
			// mimicking a legacy/timestamp-less ezio row. The generalized fallback
			// must stamp file mtime so a 0 never reaches the ledger.
			const fakeDriver: TelemetryDriver = {
				id: "ezio",
				capabilities: {
					tokenLog: true,
					storeKind: "jsonl-tree",
					timeSource: "per-event",
					cwdSource: "dir-slug",
					nativeLimits: false,
				},
				roots: () => [],
				parseLine: () => ({
					event: {
						provider: "ezio",
						timestampMs: 0,
						cwd: "c",
						sessionId: "s",
						model: "m",
						input: 1,
						output: 1,
						billable: 1,
						raw: 1,
					},
				}),
			};

			const events: UsageEvent[] = [];
			processJsonlFile(fakeDriver, file, new Map(), {
				ingest: (e) => events.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			});
			expect(events).toHaveLength(1);
			expect(events[0].timestampMs).toBe(mtime.getTime());
		});

		it("does not overwrite a valid per-event timestampMs with file mtime", () => {
			const root = mkdtempSync(join(tmpdir(), "valid-ts-"));
			const file = join(root, "y.jsonl");
			writeFileSync(file, "y\n");
			const mtime = new Date("2026-06-15T00:00:00.000Z");
			utimesSync(file, mtime, mtime);
			const eventTs = Date.parse("2026-06-10T08:00:00.000Z");

			const fakeDriver: TelemetryDriver = {
				id: "ezio",
				capabilities: {
					tokenLog: true,
					storeKind: "jsonl-tree",
					timeSource: "per-event",
					cwdSource: "dir-slug",
					nativeLimits: false,
				},
				roots: () => [],
				parseLine: () => ({
					event: {
						provider: "ezio",
						timestampMs: eventTs,
						cwd: "c",
						sessionId: "s",
						model: "m",
						input: 1,
						output: 1,
						billable: 1,
						raw: 1,
					},
				}),
			};

			const events: UsageEvent[] = [];
			processJsonlFile(fakeDriver, file, new Map(), {
				ingest: (e) => events.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			});
			expect(events[0].timestampMs).toBe(eventTs);
			expect(events[0].timestampMs).not.toBe(mtime.getTime());
		});

		it("passes a per-line ezio timestamp through instead of overriding with file mtime", () => {
			const root = mkdtempSync(join(tmpdir(), "ezio-perevent-"));
			const dir = join(root, "Users-me-Dev-app.def456");
			mkdirSync(dir, { recursive: true });
			const file = join(dir, "2026-06-10T08-00-00Z_u2.jsonl");
			const mtime = new Date("2026-06-01T00:00:00.000Z");
			// Header with session context
			writeFileSync(
				file,
				'{"type":"session","version":1,"id":"sess-2","cwd":"/Users/me/Dev/app"}\n',
			);
			utimesSync(file, mtime, mtime);
			const cache: OffsetCache = new Map();
			// First scan to cache the header
			const firstEvents: UsageEvent[] = [];
			processJsonlFile(ezioDriver, file, cache, {
				ingest: (e) => firstEvents.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			});
			// Append turn_usage row
			appendFileSync(
				file,
				'{"kind":"turn_usage","model":"gpt-5-codex","usage":{"input":1000,"output":200,"cached":600}}\n',
			);
			const laterMtime = new Date("2026-06-10T08:00:00.000Z");
			utimesSync(file, laterMtime, laterMtime);
			const events: UsageEvent[] = [];
			processJsonlFile(ezioDriver, file, cache, {
				ingest: (e) => events.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			});
			expect(events).toHaveLength(1);
			expect(events[0].timestampMs).toBe(statSync(file).mtimeMs);
			expect(events[0].model).toBe("gpt-5-codex");
		});

		it("resets to offset 0 when a file is truncated/rotated", () => {
			const root = mkdtempSync(join(tmpdir(), "ezio-trunc-"));
			const dir = join(root, "Users-me-Dev-app.xyz789");
			mkdirSync(dir, { recursive: true });
			const file = join(dir, "2026-07-17T10-00-00Z_u3.jsonl");
			const rec = (out: number): string =>
				JSON.stringify({
					kind: "turn_usage",
					model: "m",
					usage: { input: 10, output: out, cached: 0 },
				}) + "\n";
			writeFileSync(
				file,
				'{"type":"session","version":1,"id":"sess-3","cwd":"/Users/me/Dev/app"}\n' +
					rec(1) +
					rec(2) +
					rec(3),
			);
			const cache: OffsetCache = new Map();
			const first: UsageEvent[] = [];
			processJsonlFile(ezioDriver, file, cache, {
				ingest: (e) => first.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			});
			expect(first).toHaveLength(3);
			// Rewrite shorter (rotation): header + single new record, smaller than the offset.
			const t = new Date(Date.now() + 1000);
			writeFileSync(
				file,
				'{"type":"session","version":1,"id":"sess-3","cwd":"/Users/me/Dev/app"}\n' +
					rec(9),
			);
			utimesSync(file, t, t);
			const second: UsageEvent[] = [];
			processJsonlFile(ezioDriver, file, cache, {
				ingest: (e) => second.push(e),
				onLimits: () => {},
				onSubtract: () => {},
				onSealedTruncation: () => {},
			});
			expect(second).toHaveLength(1);
			expect(second[0].output).toBe(9);
		});
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

describe("resetRecentOffsets analytics window", () => {
	it("re-reads month-old (>1wk, <35d) files but not files past the window", () => {
		const root = mkdtempSync(join(tmpdir(), "win-"));
		const now = Date.now();
		const recent = join(root, "recent.jsonl"); // ~20 days old (within 35d window)
		const old = join(root, "old.jsonl"); // ~40 days old (outside the window)
		writeFileSync(recent, "{}\n");
		writeFileSync(old, "{}\n");
		const t20 = new Date(now - 20 * 86_400_000);
		const t40 = new Date(now - 40 * 86_400_000);
		utimesSync(recent, t20, t20);
		utimesSync(old, t40, t40);
		const cache: OffsetCache = new Map([
			[recent, { offset: 5, mtime: t20.getTime() }],
			[old, { offset: 5, mtime: t40.getTime() }],
		]);
		resetRecentOffsets([root], cache, now, SERIES_WINDOW_MS);
		expect(cache.has(recent)).toBe(false); // dropped => re-read on next launch
		expect(cache.has(old)).toBe(true); // preserved => no needless re-parse
	});
});

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

describe("processJsonlFile idempotency", () => {
	const makeHandlers = (
		ledger = createLedger(),
		session = createSession(),
	): { ledger: typeof ledger; h: ScanHandlers } => {
		const h: ScanHandlers = {
			ingest: (e) => ingestEvent(ledger, session, e, 0),
			onLimits: (_id: AgentProviderId, _rl: ProviderRateLimits) => {},
			onSubtract: (contrib: ContributionJson) =>
				applyContribution(ledger, contrib, -1),
			onSealedTruncation: () => {},
		};
		return { ledger, h };
	};

	const sumBillable = (ledger: ReturnType<typeof createLedger>): number => {
		let n = 0;
		for (const buckets of ledger.days.values())
			for (const t of buckets.values()) n += t.billable;
		return n;
	};

	it("re-reading the same bytes does not double-count", () => {
		const dir = mkdtempSync(join(tmpdir(), "scan-idem-"));
		const proj = join(dir, "-Users-me-Dev-app");
		mkdirSync(proj);
		const file = join(proj, "s1.jsonl");
		writeFileSync(file, claudeLine(10));
		const { ledger, h } = makeHandlers();
		const cache: OffsetCache = new Map();
		processJsonlFile(claudeDriver, file, cache, h);
		processJsonlFile(claudeDriver, file, cache, h); // no new bytes
		expect(sumBillable(ledger)).toBe(10);
		expect(cache.get(file)?.contribution).toBeDefined();
	});

	it("truncation of an ACTIVE file subtracts its contribution then re-reads (no double-count)", () => {
		const dir = mkdtempSync(join(tmpdir(), "scan-trunc-"));
		const proj = join(dir, "-Users-me-Dev-app");
		mkdirSync(proj);
		const file = join(proj, "s1.jsonl");
		writeFileSync(file, claudeLine(10) + claudeLine(10)); // 20
		const { ledger, h } = makeHandlers();
		const cache: OffsetCache = new Map();
		processJsonlFile(claudeDriver, file, cache, h);
		expect(sumBillable(ledger)).toBe(20);
		// rewrite shorter (truncate + new single line of 4)
		truncateSync(file, 0);
		writeFileSync(file, claudeLine(4));
		// force mtime difference for changed() detection
		const future = Date.now() + 10_000;
		utimesSync(file, future / 1000, future / 1000);
		processJsonlFile(claudeDriver, file, cache, h);
		expect(sumBillable(ledger)).toBe(4); // 20 subtracted, 4 re-added
	});

	it("truncation of a SEALED file (no contribution) signals a rebuild instead of over-counting", () => {
		const dir = mkdtempSync(join(tmpdir(), "scan-sealed-"));
		const proj = join(dir, "-Users-me-Dev-app");
		mkdirSync(proj);
		const file = join(proj, "s1.jsonl");
		writeFileSync(file, claudeLine(10) + claudeLine(10));
		const { ledger, h } = makeHandlers();
		const cache: OffsetCache = new Map();
		processJsonlFile(claudeDriver, file, cache, h);
		// simulate sealing: drop the contribution detail, keep offset+mtime
		const entry = cache.get(file)!;
		delete entry.contribution;
		truncateSync(file, 0);
		writeFileSync(file, claudeLine(4));
		const future = Date.now() + 10_000;
		utimesSync(file, future / 1000, future / 1000);
		let rebuildRequested = false;
		processJsonlFile(claudeDriver, file, cache, {
			...h,
			onSealedTruncation: () => {
				rebuildRequested = true;
			},
		});
		expect(rebuildRequested).toBe(true);
		// sealed branch returns early without re-reading: ledger must stay at the stale 20, not 24 or 4
		expect(sumBillable(ledger)).toBe(20);
	});
});
