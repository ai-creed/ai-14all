import { describe, expect, it } from "vitest";
import {
	buildCostSnapshot,
	estimateCostUsd,
	type CostEntry,
} from "../../../services/usage/cost/cost.js";
import { rateFor } from "../../../services/usage/cost/pricing.js";

describe("buildCostSnapshot (blended)", () => {
	it("prices a dated/unknown model id non-zero via the provider median", () => {
		const entries: CostEntry[] = [
			{
				provider: "claude",
				model: "claude-opus-4-8",
				tokens: {
					input: 1_000_000,
					output: 0,
					billable: 1_000_000,
					raw: 1_000_000,
				},
			},
		];
		const snap = buildCostSnapshot(entries);
		expect(snap.unpricedTokens).toBe(0);
		expect(snap.total).toBeCloseTo(3, 6); // 1M input * $3/M
		expect(snap.perProvider.claude).toBeCloseTo(3, 6);
	});

	it("charges cache reads (raw - billable) at the cacheRead rate", () => {
		// raw 2M, billable 1M => 1M cache-read tokens @ $0.3/M for claude
		const usd = estimateCostUsd(
			{ input: 1_000_000, output: 0, billable: 1_000_000, raw: 2_000_000 },
			rateFor("claude"),
		);
		expect(usd).toBeCloseTo(3 + 0.3, 6);
	});
});
