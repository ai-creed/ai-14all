import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clampDays,
	logsDir,
	matches,
	parseArgs,
	readEvents,
	selectFiles,
} from "../../../scripts/dump-attention-log.mjs";

describe("parseArgs", () => {
	it("defaults to no filters and a 1-day window", () => {
		expect(parseArgs([])).toEqual({
			type: null,
			state: null,
			worktree: null,
			provider: null,
			dir: null,
			days: 1,
			help: false,
		});
	});

	it("parses --key=value string filters", () => {
		const f = parseArgs([
			"--type=classifier",
			"--state=failed",
			"--worktree=wt-1",
			"--provider=claude",
			"--dir=/tmp/x",
		]);
		expect(f.type).toBe("classifier");
		expect(f.state).toBe("failed");
		expect(f.worktree).toBe("wt-1");
		expect(f.provider).toBe("claude");
		expect(f.dir).toBe("/tmp/x");
	});

	it("supports both --days=N and --days N as a clamped positive int", () => {
		expect(parseArgs(["--days=3"]).days).toBe(3);
		expect(parseArgs(["--days", "5"]).days).toBe(5);
		expect(parseArgs(["--days=0"]).days).toBe(1);
		expect(parseArgs(["--days=-2"]).days).toBe(1);
		expect(parseArgs(["--days=abc"]).days).toBe(1);
		expect(parseArgs(["--days"]).days).toBe(1);
	});

	it("recognizes --help and -h", () => {
		expect(parseArgs(["--help"]).help).toBe(true);
		expect(parseArgs(["-h"]).help).toBe(true);
		expect(parseArgs([]).help).toBe(false);
	});

	it("ignores unknown --key=value flags", () => {
		expect(parseArgs(["--bogus=1"])).toMatchObject({ type: null });
	});
});

describe("clampDays", () => {
	it("coerces strings, clamps to >= 1, defaults on garbage", () => {
		expect(clampDays("4")).toBe(4);
		expect(clampDays(7)).toBe(7);
		expect(clampDays("0")).toBe(1);
		expect(clampDays(-1)).toBe(1);
		expect(clampDays(undefined)).toBe(1);
		expect(clampDays("nope")).toBe(1);
	});
});

describe("logsDir", () => {
	it("resolves under %APPDATA% (Roaming, NOT %LOCALAPPDATA%) on win32", () => {
		const dir = logsDir("win32", "/ignored", {
			APPDATA: "C:\\Users\\u\\AppData\\Roaming",
			LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
		});
		expect(dir).toBe(join("C:\\Users\\u\\AppData\\Roaming", "ai-14all/logs"));
		expect(dir).toContain("Roaming");
		expect(dir).not.toContain("Local");
	});

	it("uses the ai-14all segment under ~/Library/Logs on darwin", () => {
		expect(logsDir("darwin", "/Users/u", {})).toBe(
			join("/Users/u", "Library/Logs/ai-14all"),
		);
	});

	it("uses ~/.config/ai-14all/logs on linux", () => {
		expect(logsDir("linux", "/home/u", {})).toBe(
			join("/home/u", ".config/ai-14all/logs"),
		);
	});
});

describe("selectFiles", () => {
	const files = [
		"agent-attention-2026-05-14.jsonl",
		"agent-attention-2026-05-16.jsonl",
		"agent-attention-2026-05-16.1.jsonl",
		"agent-attention-2026-05-16.2.jsonl",
		"agent-attention-2026-05-15.jsonl",
		"agent-attention-2026-05-15.1.jsonl",
		"not-a-log.txt",
		"agent-attention-bad.jsonl",
	];

	it("includes ALL rollover parts of each included date (distinct-date slice)", () => {
		// --days=1 must keep base + .1 + .2 of the single most recent date,
		// NOT just one file (the original slice(0, days) bug).
		expect(selectFiles(files, 1)).toEqual([
			"agent-attention-2026-05-16.jsonl",
			"agent-attention-2026-05-16.1.jsonl",
			"agent-attention-2026-05-16.2.jsonl",
		]);
	});

	it("selects the most recent N distinct dates, newest first", () => {
		expect(selectFiles(files, 2)).toEqual([
			"agent-attention-2026-05-16.jsonl",
			"agent-attention-2026-05-16.1.jsonl",
			"agent-attention-2026-05-16.2.jsonl",
			"agent-attention-2026-05-15.jsonl",
			"agent-attention-2026-05-15.1.jsonl",
		]);
	});

	it("ignores files that do not match the logger filename pattern", () => {
		expect(selectFiles(files, 99)).not.toContain("not-a-log.txt");
		expect(selectFiles(files, 99)).not.toContain("agent-attention-bad.jsonl");
	});
});

describe("matches", () => {
	const ev = {
		type: "classifier",
		state: "failed",
		worktreeId: "wt-1",
		provider: "claude",
	};

	it("passes when all active filters match", () => {
		expect(
			matches(ev, {
				type: "classifier",
				state: "failed",
				worktree: "wt-1",
				provider: "claude",
			}),
		).toBe(true);
	});

	it("rejects on any non-matching filter", () => {
		expect(matches(ev, { type: "mcp" })).toBe(false);
		expect(matches(ev, { state: "ready" })).toBe(false);
		expect(matches(ev, { worktree: "wt-2" })).toBe(false);
		expect(matches(ev, { provider: "codex" })).toBe(false);
	});

	it("always rejects _meta events", () => {
		expect(matches({ type: "_meta" }, {})).toBe(false);
	});
});

describe("readEvents over a seeded temp dir", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "attn-log-"));
		const meta = JSON.stringify({
			type: "_meta",
			ts: 1,
			warning: "full mode",
		});
		const base16 = [
			meta,
			JSON.stringify({
				type: "classifier",
				ts: 2,
				worktreeId: "wt-1",
				provider: "claude",
				state: "failed",
			}),
			"{ not json",
			"",
			JSON.stringify({
				type: "mcp",
				ts: 3,
				worktreeId: "wt-2",
				provider: "codex",
				state: "ready",
			}),
		].join("\n");
		const roll16 = JSON.stringify({
			type: "lifecycle",
			ts: 4,
			worktreeId: "wt-1",
			provider: null,
			state: "active",
		});
		const day15 = JSON.stringify({
			type: "resolution",
			ts: 1,
			worktreeId: "wt-9",
			provider: null,
		});
		writeFileSync(join(dir, "agent-attention-2026-05-16.jsonl"), base16);
		writeFileSync(join(dir, "agent-attention-2026-05-16.1.jsonl"), roll16);
		writeFileSync(join(dir, "agent-attention-2026-05-15.jsonl"), day15);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("excludes _meta + malformed lines and includes the rollover part", () => {
		const events = [...readEvents({ dir, days: 1, type: null, state: null })];
		const types = events.map((e) => e.type);
		expect(types).not.toContain("_meta");
		// base classifier + mcp from base file, lifecycle from the .1 rollover.
		expect(types.sort()).toEqual(["classifier", "lifecycle", "mcp"]);
	});

	it("distinct-date slicing: --days=1 excludes the older day's file", () => {
		const events = [...readEvents({ dir, days: 1 })];
		expect(events.some((e) => e.type === "resolution")).toBe(false);
		const events2 = [...readEvents({ dir, days: 2 })];
		expect(events2.some((e) => e.type === "resolution")).toBe(true);
	});

	it("type/state/provider/worktree filters narrow the matched set", () => {
		const filters = {
			dir,
			days: 2,
			type: "classifier",
			state: "failed",
			worktree: "wt-1",
			provider: "claude",
		};
		const matched = [...readEvents(filters)].filter((e) => matches(e, filters));
		expect(matched).toHaveLength(1);
		expect(matched[0]).toMatchObject({ type: "classifier", state: "failed" });
	});

	it("invokes onMissingDir and yields nothing for a missing directory", () => {
		let missing: string | null = null;
		const events = [
			...readEvents({ dir: join(dir, "nope"), days: 1 }, (d: string) => {
				missing = d;
			}),
		];
		expect(events).toHaveLength(0);
		expect(missing).toBe(join(dir, "nope"));
	});
});
