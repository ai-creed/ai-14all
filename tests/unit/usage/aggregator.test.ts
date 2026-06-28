import { describe, expect, it } from "vitest";
import { UsageAggregator } from "../../../services/usage/aggregator.js";
import type { UsageEvent } from "../../../shared/models/usage.js";

const HOUR = 3_600_000;
const ev = (over: Partial<UsageEvent>): UsageEvent => ({
	provider: "codex",
	timestampMs: 0,
	cwd: "/a",
	sessionId: "s",
	model: "m",
	input: 0,
	output: 0,
	billable: 0,
	raw: 0,
	...over,
});

describe("UsageAggregator", () => {
	it("tracks since-launch per provider+cwd only for ts >= launch", () => {
		const launch = 1000 * HOUR;
		const agg = new UsageAggregator(launch);
		agg.ingest(ev({ timestampMs: launch - HOUR, billable: 5, raw: 50 })); // before launch
		agg.ingest(ev({ timestampMs: launch + HOUR, billable: 7, raw: 70 }));
		const key = agg.sinceLaunch().get("codex /a");
		expect(key).toEqual({ input: 0, output: 0, billable: 7, raw: 70 });
	});
	it("rolling billable sums within the window regardless of launch", () => {
		const now = 2000 * HOUR;
		const agg = new UsageAggregator(now);
		agg.ingest(ev({ timestampMs: now - 2 * HOUR, billable: 3, raw: 9 }));
		agg.ingest(ev({ timestampMs: now - 200 * HOUR, billable: 100, raw: 100 }));
		expect(agg.rollingBillable("codex", 5 * HOUR, now)).toBe(3);
	});
	it("keeps the newest codex rate limits", () => {
		const agg = new UsageAggregator(0);
		agg.setProviderLimits("codex", {
			capturedAtMs: 10,
			planType: "plus",
			primary: null,
			secondary: null,
		});
		agg.setProviderLimits("codex", {
			capturedAtMs: 5,
			planType: "old",
			primary: null,
			secondary: null,
		});
		expect(agg.getProviderLimits("codex")?.planType).toBe("plus");
	});
});

describe("UsageAggregator analytics additions", () => {
	it("buckets a daily series by provider (local day)", () => {
		const agg = new UsageAggregator(0);
		const t0 = new Date("2026-06-10T10:00:00").getTime();
		const t1 = new Date("2026-06-11T09:00:00").getTime();
		agg.ingest(ev({ timestampMs: t0, billable: 5, provider: "claude" }));
		agg.ingest(ev({ timestampMs: t0, billable: 2, provider: "codex" }));
		agg.ingest(ev({ timestampMs: t1, billable: 9, provider: "claude" }));
		const series = agg.dailySeries(t1, 35);
		const d0 = series.find((p) => p.tokens.claude === 5);
		expect(d0?.tokens.codex).toBe(2);
		expect(series.find((p) => p.tokens.claude === 9)).toBeTruthy();
	});

	it("accumulates a per-(provider, model) cost ledger", () => {
		const agg = new UsageAggregator(0);
		agg.ingest(ev({ model: "claude-opus-4", input: 10, output: 5, billable: 15, raw: 15 }));
		agg.ingest(ev({ model: "claude-opus-4", input: 1, output: 1, billable: 2, raw: 2 }));
		agg.ingest(ev({ provider: "codex", model: "gpt-5", billable: 4, input: 4, raw: 4 }));
		const entries = agg.costEntries();
		const opus = entries.find((e) => e.model === "claude-opus-4");
		expect(opus?.tokens.billable).toBe(17);
		expect(entries.some((e) => e.provider === "codex")).toBe(true);
	});

	it("scopes the cost ledger to this sitting: pre-launch backfilled events are excluded", () => {
		const launch = 1000 * HOUR;
		const agg = new UsageAggregator(launch);
		// Pre-launch event replayed by the 35-day backfill — must NOT be priced.
		agg.ingest(ev({ timestampMs: launch - HOUR, billable: 100, input: 100, raw: 100 }));
		// Post-launch "this sitting" event — counts toward cost.
		agg.ingest(ev({ timestampMs: launch + HOUR, billable: 5, input: 5, raw: 5 }));
		const entry = agg
			.costEntries()
			.find((e) => e.provider === "codex" && e.model === "m");
		// Only the post-launch billable reaches the cost ledger.
		expect(entry?.tokens.billable).toBe(5);
		// ...but the range-scoped daily series (the chart) still includes BOTH days.
		const series = agg.dailySeries(launch + HOUR, 35);
		const codexTotal = series.reduce((s, p) => s + (p.tokens.codex ?? 0), 0);
		expect(codexTotal).toBe(105);
	});

	it("stores provider limits by id and tracks which providers had data", () => {
		const agg = new UsageAggregator(0);
		agg.setProviderLimits("codex", {
			capturedAtMs: 1,
			planType: "plus",
			primary: null,
			secondary: null,
		});
		expect(agg.getProviderLimits("codex")?.planType).toBe("plus");
		agg.ingest(ev({ provider: "ezio", billable: 1 }));
		expect(agg.providersWithData().has("ezio")).toBe(true);
		expect(agg.providersWithData().has("cursor")).toBe(false);
	});
});
