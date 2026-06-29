import type { AgentProviderId } from "../../../shared/models/agent-provider.js";

export interface ProviderRate {
	inputPerM: number;
	outputPerM: number;
	cacheReadPerM: number;
} // USD per 1M tokens, last verified 2026-06

// Blended per-provider median rate. This deliberately OVERRIDES Slice 1's strict
// exact `(provider, model)` lookup: `model` is ignored, every known-provider token
// is priced at its provider median, so notional cost is never $0. Unknown provider
// falls back to GLOBAL_AVG. Update these medians in a commit when prices drift; no
// runtime network. See spec §7.
const PROVIDER_RATE: Partial<Record<AgentProviderId, ProviderRate>> = {
	claude: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 }, // Anthropic median (sonnet-class)
	codex: { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.125 }, // OpenAI median (gpt-5-class)
	ezio: { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.125 }, // runs on the codex/OpenAI provider
};

const GLOBAL_AVG: ProviderRate = {
	inputPerM: 2,
	outputPerM: 12,
	cacheReadPerM: 0.2,
};

export function rateFor(provider: AgentProviderId): ProviderRate {
	return PROVIDER_RATE[provider] ?? GLOBAL_AVG;
}
