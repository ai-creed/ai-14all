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
		agg.setCodexLimits({
			capturedAtMs: 10,
			planType: "plus",
			primary: null,
			secondary: null,
		});
		agg.setCodexLimits({
			capturedAtMs: 5,
			planType: "old",
			primary: null,
			secondary: null,
		});
		expect(agg.latestCodexLimits()?.planType).toBe("plus");
	});
});
