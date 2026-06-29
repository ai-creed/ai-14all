import type { TokenTotals } from "../../shared/models/usage.js";

export interface ClaudeUsageRaw {
	input_tokens?: number;
	output_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

export interface CodexUsageRaw {
	input_tokens?: number;
	cached_input_tokens?: number;
	output_tokens?: number;
	reasoning_output_tokens?: number;
	total_tokens?: number;
}

const n = (v: unknown): number =>
	typeof v === "number" && Number.isFinite(v) ? v : 0;

export function claudeTokens(u: ClaudeUsageRaw): TokenTotals {
	const input = n(u.input_tokens) + n(u.cache_creation_input_tokens);
	const output = n(u.output_tokens);
	const billable = input + output;
	return {
		input,
		output,
		billable,
		raw: billable + n(u.cache_read_input_tokens),
	};
}

export function codexTokens(u: CodexUsageRaw): TokenTotals {
	const raw = n(u.total_tokens);
	const output = n(u.output_tokens);
	// total_tokens = input (incl. cached) + output; non-cached input is billable.
	const input = Math.max(0, raw - n(u.cached_input_tokens) - output);
	return { input, output, billable: input + output, raw };
}

export interface EzioUsageRaw {
	contextTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	contextLimit?: number;
}

// ezio (hax engine) reports the running context size + output per turn. Non-cached
// context is the billable input; cached context is the free re-read. raw = the
// full context plus output (what actually moved through the model this turn).
export function ezioTokens(u: EzioUsageRaw): TokenTotals {
	const context = n(u.contextTokens);
	const output = n(u.outputTokens);
	const input = Math.max(0, context - n(u.cachedTokens));
	return { input, output, billable: input + output, raw: context + output };
}
