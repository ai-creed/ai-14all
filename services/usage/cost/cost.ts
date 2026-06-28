import type { AgentProviderId } from "../../../shared/models/agent-provider.js";
import type { CostSnapshot, TokenTotals } from "../../../shared/models/usage.js";
import type { CostEntry } from "../aggregator.js";
import { rateFor, type ModelRate } from "./pricing.js";

export type RateLookup = (
	provider: AgentProviderId,
	model: string,
) => ModelRate | null;

// Pure multiply. input already includes cache-creation (billable); cache reads
// are (raw - billable), priced at the cache-read rate.
export function estimateCostUsd(t: TokenTotals, rate: ModelRate): number {
	const cacheRead = Math.max(0, t.raw - t.billable);
	return (
		(t.input * rate.inputPerM +
			t.output * rate.outputPerM +
			cacheRead * rate.cacheReadPerM) /
		1_000_000
	);
}

// Walk the per-(provider, model) ledger. Priced models add dollars; unpriced
// models contribute nothing to any total and accrue into unpricedTokens. A
// provider whose models are all unpriced is absent from perProvider (=> "—").
export function buildCostSnapshot(
	entries: CostEntry[],
	rate: RateLookup = rateFor,
): CostSnapshot {
	const perProvider: Partial<Record<AgentProviderId, number>> = {};
	let total = 0;
	let unpricedTokens = 0;
	for (const { provider, model, tokens } of entries) {
		const r = rate(provider, model);
		if (!r) {
			unpricedTokens += tokens.billable;
			continue;
		}
		const usd = estimateCostUsd(tokens, r);
		perProvider[provider] = (perProvider[provider] ?? 0) + usd;
		total += usd;
	}
	return { perProvider, total, currency: "USD", notional: true, unpricedTokens };
}
