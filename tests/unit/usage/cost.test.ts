import { describe, expect, it } from "vitest";
import {
	buildCostSnapshot,
	estimateCostUsd,
} from "../../../services/usage/cost/cost.js";
import type { CostEntry } from "../../../services/usage/aggregator.js";

const stubRate = (_provider: string, model: string) =>
	model === "known"
		? { inputPerM: 10, outputPerM: 20, cacheReadPerM: 1 }
		: null;

describe("estimateCostUsd", () => {
	it("prices input/output/cache-read per million", () => {
		expect(
			estimateCostUsd(
				{ input: 1_000_000, output: 500_000, billable: 1_500_000, raw: 2_500_000 },
				{ inputPerM: 10, outputPerM: 20, cacheReadPerM: 1 },
			),
		).toBeCloseTo(10 + 10 + 1, 6); // 1M*10 + 0.5M*20 + 1M cacheRead*1
	});
});

describe("buildCostSnapshot", () => {
	const entries: CostEntry[] = [
		{ provider: "claude", model: "known", tokens: { input: 1_000_000, output: 0, billable: 1_000_000, raw: 1_000_000 } },
		{ provider: "claude", model: "unknown", tokens: { input: 0, output: 0, billable: 7000, raw: 7000 } },
		{ provider: "codex", model: "unknown", tokens: { input: 0, output: 0, billable: 3000, raw: 3000 } },
	];
	it("prices known models, excludes unknown into unpricedTokens, drops fully-unpriced providers", () => {
		const snap = buildCostSnapshot(entries, stubRate);
		expect(snap.perProvider.claude).toBeCloseTo(10, 6);
		expect(snap.perProvider.codex).toBeUndefined(); // all codex models unpriced => "—"
		expect(snap.total).toBeCloseTo(10, 6);
		expect(snap.unpricedTokens).toBe(10_000); // 7000 + 3000
		expect(snap.notional).toBe(true);
	});
});
