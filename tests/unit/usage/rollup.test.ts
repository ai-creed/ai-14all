import { describe, expect, it } from "vitest";
import { providerRollup, seriesForRange } from "../../../src/features/telemetry/rollup.js";
import type { DailyPoint } from "../../../shared/models/usage.js";

const DAY = 86_400_000;
// Local calendar helpers, recomputed in the test so assertions are timezone- and
// weekday-agnostic (no hardcoded "which day is Monday").
const localDay = (ms: number): number => {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};
const monday = (ms: number): number => {
	const d = new Date(localDay(ms));
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d.getTime();
};
const first = (ms: number): number => {
	const d = new Date(localDay(ms));
	d.setDate(1);
	return d.getTime();
};

const NOW = new Date("2026-06-17T12:00:00").getTime();
// 45 consecutive local days ending today — spans the current week and month.
const series: DailyPoint[] = Array.from({ length: 45 }, (_, i) => ({
	dayStartMs: localDay(NOW) - (44 - i) * DAY,
	tokens: { claude: 10, codex: 5 },
}));

describe("seriesForRange (calendar)", () => {
	it("week starts at this Monday; month starts at the 1st — not a trailing window", () => {
		const wk = seriesForRange(series, "week", NOW);
		expect(wk[0].dayStartMs).toBe(monday(NOW));
		expect(wk.every((p) => p.dayStartMs >= monday(NOW))).toBe(true);
		const mo = seriesForRange(series, "month", NOW);
		expect(mo[0].dayStartMs).toBe(first(NOW));
		expect(mo.every((p) => p.dayStartMs >= first(NOW))).toBe(true);
	});
});

describe("providerRollup", () => {
	it("sums per provider over the calendar period and attaches notional cost", () => {
		const cost = {
			perProvider: { claude: 2.5 },
			total: 2.5,
			currency: "USD" as const,
			notional: true as const,
			unpricedTokens: 0,
		};
		const days = seriesForRange(series, "week", NOW).length;
		const { rows, totalTokens } = providerRollup(series, "week", cost, NOW);
		const claude = rows.find((r) => r.provider === "claude");
		expect(claude?.tokens).toBe(10 * days);
		expect(claude?.costUsd).toBe(2.5);
		expect(rows.find((r) => r.provider === "codex")?.costUsd).toBeNull();
		expect(totalTokens).toBe(15 * days); // 10 claude + 5 codex per day
		expect(rows[0].provider).toBe("claude"); // sorted desc by tokens
	});
});
