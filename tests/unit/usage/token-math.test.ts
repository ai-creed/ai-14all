import { describe, expect, it } from "vitest";
import {
	claudeTokens,
	codexTokens,
	ezioTokens,
} from "../../../services/usage/token-math.js";

describe("claudeTokens", () => {
	it("billable excludes cache reads; raw includes them", () => {
		const t = claudeTokens({
			input_tokens: 6,
			output_tokens: 166,
			cache_creation_input_tokens: 10141,
			cache_read_input_tokens: 15132,
		});
		expect(t.input).toBe(6 + 10141); // input + cache_creation
		expect(t.output).toBe(166);
		expect(t.billable).toBe(6 + 166 + 10141);
		expect(t.raw).toBe(6 + 166 + 10141 + 15132);
	});
	it("treats missing fields as zero", () => {
		expect(claudeTokens({ output_tokens: 5 })).toEqual({
			input: 0,
			output: 5,
			billable: 5,
			raw: 5,
		});
	});
});

describe("codexTokens", () => {
	it("billable = total - cached_input; raw = total", () => {
		const t = codexTokens({
			input_tokens: 19542,
			cached_input_tokens: 6528,
			output_tokens: 257,
			reasoning_output_tokens: 0,
			total_tokens: 19799,
		});
		expect(t.input).toBe(19799 - 6528 - 257); // non-cached input
		expect(t.output).toBe(257);
		expect(t.billable).toBe(19799 - 6528);
		expect(t.raw).toBe(19799);
	});
});

describe("ezioTokens", () => {
	it("input = contextTokens - cachedTokens; raw = contextTokens + output", () => {
		expect(
			ezioTokens({ contextTokens: 1000, outputTokens: 200, cachedTokens: 600 }),
		).toEqual({ input: 400, output: 200, billable: 600, raw: 1200 });
	});

	it("clamps negative input to 0 and tolerates missing fields", () => {
		expect(
			ezioTokens({ contextTokens: 100, outputTokens: 0, cachedTokens: 500 }),
		).toEqual({ input: 0, output: 0, billable: 0, raw: 100 });
		expect(ezioTokens({})).toEqual({
			input: 0,
			output: 0,
			billable: 0,
			raw: 0,
		});
	});
});
