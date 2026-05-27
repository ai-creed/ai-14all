import { describe, expect, it } from "vitest";
import {
	CLAUDE_MARKER,
	parseClaudeLine,
} from "../../../services/usage/claude-source.js";

const assistant = JSON.stringify({
	type: "assistant",
	timestamp: "2026-04-28T02:09:04.904Z",
	cwd: "/Users/me/Dev/app",
	sessionId: "sess-1",
	message: {
		model: "claude-opus-4-7",
		usage: {
			input_tokens: 6,
			output_tokens: 166,
			cache_creation_input_tokens: 10141,
			cache_read_input_tokens: 15132,
		},
	},
});

describe("parseClaudeLine", () => {
	it("parses an assistant usage line", () => {
		const e = parseClaudeLine(assistant);
		expect(e).toMatchObject({
			provider: "claude",
			cwd: "/Users/me/Dev/app",
			sessionId: "sess-1",
			model: "claude-opus-4-7",
			billable: 6 + 166 + 10141,
			raw: 6 + 166 + 10141 + 15132,
		});
		expect(e?.timestampMs).toBe(Date.parse("2026-04-28T02:09:04.904Z"));
	});
	it("returns null for non-assistant, no-usage, or malformed lines", () => {
		expect(
			parseClaudeLine(JSON.stringify({ type: "user", message: {} })),
		).toBeNull();
		expect(
			parseClaudeLine(JSON.stringify({ type: "assistant", message: {} })),
		).toBeNull();
		expect(parseClaudeLine("{not json")).toBeNull();
	});
	it("marker matches lines that carry usage", () => {
		expect(assistant.includes(CLAUDE_MARKER)).toBe(true);
	});
});
