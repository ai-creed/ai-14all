import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeDriver } from "../../../services/usage/providers/claude.js";
import { codexDriver } from "../../../services/usage/providers/codex.js";
import { cursorDriver } from "../../../services/usage/providers/cursor.js";
import { antigravityDriver } from "../../../services/usage/providers/antigravity.js";
import { ezioDriver } from "../../../services/usage/providers/ezio.js";
import {
	TELEMETRY_DRIVERS,
	jsonlDrivers,
	driverFor,
} from "../../../services/usage/providers/index.js";
import { AGENT_PROVIDER_IDS } from "../../../shared/models/agent-provider.js";

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
			codexDriver.recoverCtx?.(
				file,
				Buffer.byteLength(metaLine + turnLine, "utf8"),
			)?.cwd,
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

describe("ezio driver", () => {
	it("declares per-event/dir-slug capabilities and a sessions root", () => {
		expect(ezioDriver.capabilities).toEqual({
			tokenLog: true,
			storeKind: "jsonl-tree",
			timeSource: "per-event",
			cwdSource: "dir-slug",
			nativeLimits: false,
		});
		expect(ezioDriver.roots("/home/me")).toEqual([
			"/home/me/.local/state/ezio/sessions",
		]);
	});

	it("seedCtx pulls the dir slug as cwd and the file basename as sessionId", () => {
		const ctx = ezioDriver.seedCtx?.(
			"/home/me/.local/state/ezio/sessions/Users-me-Dev-app/abc.record.jsonl",
		);
		expect(ctx?.cwd).toBe("Users-me-Dev-app");
		expect(ctx?.sessionId).toBe("abc.record");
	});

	it("parseLine maps a usage record using the seeded ctx", () => {
		const ctx = { cwd: "Users-me-Dev-app", sessionId: "abc.record" };
		const line = JSON.stringify({
			model: "gpt-5-codex",
			usage: { contextTokens: 1000, outputTokens: 200, cachedTokens: 600 },
		});
		const r = ezioDriver.parseLine?.(line, ctx);
		expect(r?.event?.provider).toBe("ezio");
		expect(r?.event?.cwd).toBe("Users-me-Dev-app");
		expect(r?.event?.billable).toBe(600);
	});
});

describe("registry", () => {
	it("is ordered to match AGENT_PROVIDERS", () => {
		expect(TELEMETRY_DRIVERS.map((d) => d.id)).toEqual([...AGENT_PROVIDER_IDS]);
	});
	it("jsonlDrivers are only the three real ones", () => {
		expect(jsonlDrivers.map((d) => d.id)).toEqual(["claude", "codex", "ezio"]);
	});
	it("driverFor resolves by id", () => {
		expect(driverFor("codex")?.id).toBe("codex");
		expect(driverFor("nope" as never)).toBeUndefined();
	});
});
