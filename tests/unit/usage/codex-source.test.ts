import { describe, expect, it } from "vitest";
import {
	CODEX_MARKER,
	parseCodexRateLimits,
	parseCodexSessionMeta,
	parseCodexTokenLine,
	parseCodexTurnContext,
	sessionIdFromCodexFile,
} from "../../../services/usage/codex-source.js";

const tokenLine = JSON.stringify({
	timestamp: "2026-05-21T13:37:43.374Z",
	type: "event_msg",
	payload: {
		type: "token_count",
		info: {
			last_token_usage: {
				input_tokens: 19542,
				cached_input_tokens: 6528,
				output_tokens: 257,
				reasoning_output_tokens: 0,
				total_tokens: 19799,
			},
		},
		rate_limits: {
			plan_type: "plus",
			primary: { used_percent: 3, window_minutes: 300, resets_at: 1779378867 },
			secondary: {
				used_percent: 41,
				window_minutes: 10080,
				resets_at: 1779853672,
			},
		},
	},
});

describe("codex parsers", () => {
	it("derives sessionId from filename", () => {
		expect(
			sessionIdFromCodexFile(
				"rollout-2026-05-21T20-37-23-019e4ac1-5145-7150-bb64-7c5199a54342.jsonl",
			),
		).toBe("019e4ac1-5145-7150-bb64-7c5199a54342");
	});
	it("reads cwd from session_meta and turn_context", () => {
		expect(
			parseCodexSessionMeta(
				JSON.stringify({ type: "session_meta", payload: { cwd: "/a" } }),
			),
		).toEqual({ cwd: "/a" });
		expect(
			parseCodexTurnContext(
				JSON.stringify({
					type: "turn_context",
					payload: { model: "gpt-5.5", cwd: "/b" },
				}),
			),
		).toEqual({ model: "gpt-5.5", cwd: "/b" });
	});
	it("parses token_count via last_token_usage delta", () => {
		const e = parseCodexTokenLine(tokenLine, {
			cwd: "/a",
			sessionId: "s1",
			model: "gpt-5.5",
		});
		expect(e).toMatchObject({
			provider: "codex",
			cwd: "/a",
			sessionId: "s1",
			model: "gpt-5.5",
			billable: 19799 - 6528,
			raw: 19799,
		});
	});
	it("returns null when last_token_usage is absent (never sums cumulative)", () => {
		const noDelta = JSON.stringify({
			timestamp: "2026-05-21T13:37:43.374Z",
			type: "event_msg",
			payload: {
				type: "token_count",
				info: { total_token_usage: { total_tokens: 5 } },
			},
		});
		expect(
			parseCodexTokenLine(noDelta, { cwd: "/a", sessionId: "s1", model: "" }),
		).toBeNull();
	});
	it("extracts rate limits with epoch→ms reset", () => {
		const rl = parseCodexRateLimits(tokenLine);
		expect(rl?.planType).toBe("plus");
		expect(rl?.primary).toEqual({
			usedPercent: 3,
			windowMinutes: 300,
			resetsAtMs: 1779378867 * 1000,
		});
		expect(rl?.secondary?.usedPercent).toBe(41);
	});
	it("marker matches token_count lines", () => {
		expect(tokenLine.includes(CODEX_MARKER)).toBe(true);
	});
});
