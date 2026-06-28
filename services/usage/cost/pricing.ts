import type { AgentProviderId } from "../../../shared/models/agent-provider.js";

export interface ModelRate {
	inputPerM: number;
	outputPerM: number;
	cacheReadPerM: number;
} // USD per 1M tokens

// Notional list-price "API-equivalent value" (USD per 1M tokens), keyed by an
// EXACT `${provider} ${model}` composite (space separator; ids contain no spaces).
// Lookup is STRICT: an unrecognized model returns null (=> unpricedTokens) — never
// a prefix match or provider-default guess. VERIFY the rates AND enumerate every
// exact model id the agents actually emit (including dated variants such as
// "claude-opus-4-6-20260101") at implementation time — Claude via the claude-api
// skill; codex/ezio via OpenAI's published list price.
const SEP = " ";
const RATES: Record<string, ModelRate> = {
	[`claude${SEP}claude-opus-4-6`]: { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5 },
	[`claude${SEP}claude-sonnet-4-6`]: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 },
	[`claude${SEP}claude-haiku-4-5`]: { inputPerM: 0.8, outputPerM: 4, cacheReadPerM: 0.08 },
	[`codex${SEP}gpt-5-codex`]: { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.125 },
	[`ezio${SEP}gpt-5-codex`]: { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.125 },
};

export function rateFor(provider: AgentProviderId, model: string): ModelRate | null {
	return RATES[`${provider}${SEP}${model}`] ?? null;
}
