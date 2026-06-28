import type { AgentProviderId } from "../../../shared/models/agent-provider.js";
import type { CostSnapshot, TokenTotals } from "../../../shared/models/usage.js";
import type { CostEntry } from "../aggregator.js";
import { rateFor, type ProviderRate } from "./pricing.js";

export type RateLookup = (provider: AgentProviderId) => ProviderRate;

// Pure multiply. input already includes cache-creation (billable); cache reads
// are (raw - billable), priced at the cache-read rate.
export function estimateCostUsd(t: TokenTotals, rate: ProviderRate): number {
	const cacheRead = Math.max(0, t.raw - t.billable);
	return (
		(t.input * rate.inputPerM +
			t.output * rate.outputPerM +
			cacheRead * rate.cacheReadPerM) /
		1_000_000
	);
}

export function buildCostSnapshot(
	entries: CostEntry[],
	rate: RateLookup = rateFor,
): CostSnapshot {
	const perProvider: Partial<Record<AgentProviderId, number>> = {};
	let total = 0;
	for (const { provider, tokens } of entries) {
		const usd = estimateCostUsd(tokens, rate(provider));
		perProvider[provider] = (perProvider[provider] ?? 0) + usd;
		total += usd;
	}
	// Blended pricing always resolves a rate, so no token is ever "unpriced".
	return { perProvider, total, currency: "USD", notional: true, unpricedTokens: 0 };
}
