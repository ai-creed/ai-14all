import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeDriver } from "../../../services/usage/providers/claude.js";
import { codexDriver } from "../../../services/usage/providers/codex.js";
import { cursorDriver } from "../../../services/usage/providers/cursor.js";
import { antigravityDriver } from "../../../services/usage/providers/antigravity.js";

describe("real drivers", () => {
	it("claude declares per-event/in-line capabilities and a projects root", () => {
		expect(claudeDriver.capabilities).toEqual({
			tokenLog: true,
			storeKind: "jsonl-tree",
			timeSource: "per-event",
			cwdSource: "in-line",
			nativeLimits: false,
		});
		expect(claudeDriver.roots("/home/me")).toEqual([
			"/home/me/.claude/projects",
		]);
	});

	it("claude parseLine yields an event for an assistant usage line", () => {
		const line = JSON.stringify({
			type: "assistant",
			timestamp: "2026-05-01T00:00:00.000Z",
			cwd: "/x",
			sessionId: "s",
			message: { model: "m", usage: { output_tokens: 10 } },
		});
		expect(claudeDriver.parseLine?.(line, {})?.event?.billable).toBe(10);
	});

	it("codex declares nativeLimits and builds a real gauge", () => {
		expect(codexDriver.capabilities.nativeLimits).toBe(true);
		const gauge = codexDriver.buildGauge?.({
			nowMs: 0,
			providerLimits: {
				capturedAtMs: 0,
				planType: "plus",
				primary: { usedPercent: 41, windowMinutes: 300, resetsAtMs: 5 },
				secondary: { usedPercent: 23, windowMinutes: 10080, resetsAtMs: 9 },
			},
		});
		expect(gauge?.fiveHour.percent).toBe(41);
		expect(gauge?.weekly.percent).toBe(23);
	});
});

describe("codex recoverCtx bound", () => {
	it("scans only [0, upToOffset) — ignores context appended after the offset", () => {
		const dir = mkdtempSync(join(tmpdir(), "codex-rec-"));
		const file = join(dir, "rollout.jsonl");
		// Prefix [0, from): session_meta sets cwd=/A. Appended after `from`: a
		// turn_context with cwd=/B that recovery MUST NOT see.
		const metaLine =
			JSON.stringify({ type: "session_meta", payload: { cwd: "/A" } }) + "\n";
		const turnLine =
			JSON.stringify({ type: "turn_context", payload: { cwd: "/B" } }) + "\n";
		writeFileSync(file, metaLine + turnLine);
		const from = Buffer.byteLength(metaLine, "utf8");
		expect(codexDriver.recoverCtx?.(file, from)?.cwd).toBe("/A");
		// Scanning the whole file (no bound) would instead pick up "/B".
		expect(
			codexDriver.recoverCtx?.(file, Buffer.byteLength(metaLine + turnLine, "utf8"))?.cwd,
		).toBe("/B");
	});
});

describe("inert drivers", () => {
	it("cursor and antigravity expose no roots and no token log", () => {
		expect(cursorDriver.roots("/home/me")).toEqual([]);
		expect(cursorDriver.capabilities).toEqual({
			tokenLog: false,
			storeKind: "none",
			timeSource: "none",
			cwdSource: "none",
			nativeLimits: false,
		});
		expect(antigravityDriver.roots("/home/me")).toEqual([]);
		expect(antigravityDriver.capabilities.storeKind).toBe("sqlite-dir");
		expect(antigravityDriver.capabilities.timeSource).toBe("none");
	});
});
