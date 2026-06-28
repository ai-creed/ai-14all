import { describe, expect, it } from "vitest";
import {
	EZIO_MARKER,
	ezioSlug,
	parseEzioLine,
} from "../../../services/usage/ezio-source.js";

describe("ezioSlug", () => {
	it("strips the leading slash and replaces / and . with -", () => {
		expect(ezioSlug("/Users/vuphan/Dev/ai-14all/.worktrees/bugs-hardening")).toBe(
			"Users-vuphan-Dev-ai-14all--worktrees-bugs-hardening",
		);
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
});
