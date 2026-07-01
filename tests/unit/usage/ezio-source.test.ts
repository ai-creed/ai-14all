import { describe, expect, it } from "vitest";
import {
	EZIO_MARKER,
	ezioSlug,
	parseEzioLine,
} from "../../../services/usage/ezio-source.js";

describe("ezioSlug", () => {
	it("strips the leading slash and replaces / and . with -", () => {
		expect(
			ezioSlug("/Users/vuphan/Dev/ai-14all/.worktrees/bugs-hardening"),
		).toBe("Users-vuphan-Dev-ai-14all--worktrees-bugs-hardening");
	});
});

describe("parseEzioLine", () => {
	const ctx = { cwd: "Users-me-Dev-app", sessionId: "rec1" };

	it("maps a usage record to an event with ctx cwd and zero timestamp", () => {
		const line = JSON.stringify({
			model: "gpt-5-codex",
			usage: { contextTokens: 1000, outputTokens: 200, cachedTokens: 600 },
		});
		expect(parseEzioLine(line, ctx)).toEqual({
			provider: "ezio",
			timestampMs: 0,
			cwd: "Users-me-Dev-app",
			sessionId: "rec1",
			model: "gpt-5-codex",
			input: 400,
			output: 200,
			billable: 600,
			raw: 1200,
		});
	});

	it("returns null for non-usage / unparseable lines", () => {
		expect(parseEzioLine('{"type":"hello"}', ctx)).toBeNull();
		expect(parseEzioLine("not json", ctx)).toBeNull();
		expect(parseEzioLine(EZIO_MARKER, ctx)).toBeNull();
	});

	it("parses a valid ISO timestamp into timestampMs and passes model through", () => {
		const iso = "2026-06-30T12:34:56.000Z";
		const line = JSON.stringify({
			timestamp: iso,
			model: "gpt-5-codex",
			usage: { contextTokens: 1000, outputTokens: 200, cachedTokens: 600 },
		});
		const event = parseEzioLine(line, ctx);
		expect(event?.timestampMs).toBe(Date.parse(iso));
		expect(event?.model).toBe("gpt-5-codex");
	});

	it("maps an absent or malformed timestamp to the 0 sentinel, never NaN", () => {
		const malformed = JSON.stringify({
			timestamp: "not-a-date",
			model: "m",
			usage: { contextTokens: 10, outputTokens: 2, cachedTokens: 0 },
		});
		const absent = JSON.stringify({
			model: "m",
			usage: { contextTokens: 10, outputTokens: 2, cachedTokens: 0 },
		});
		const fromMalformed = parseEzioLine(malformed, ctx);
		const fromAbsent = parseEzioLine(absent, ctx);
		expect(fromMalformed?.timestampMs).toBe(0);
		expect(fromAbsent?.timestampMs).toBe(0);
		// Headline invariant: 0, not NaN. (`?? NaN` keeps the arg typed as number.)
		expect(Number.isNaN(fromMalformed?.timestampMs ?? NaN)).toBe(false);
	});
});
