import { describe, expect, it } from "vitest";
import {
	budgetPercent,
	seedFiveHourBudget,
	seedWeeklyBudget,
	weeklyAnchorMs,
} from "../../../services/usage/budget.js";

describe("budget", () => {
	it("seeds weekly budget from tier", () => {
		expect(seedWeeklyBudget("default_claude_pro")).toBe(22_400_000);
		expect(seedWeeklyBudget("default_claude_max_5x")).toBe(112_000_000);
		expect(seedWeeklyBudget("default_claude_max_20x")).toBe(448_000_000);
		expect(seedWeeklyBudget("unknown")).toBe(112_000_000);
	});
	it("seeds the 5h budget from tier", () => {
		expect(seedFiveHourBudget("default_claude_pro")).toBe(1_000_000);
		expect(seedFiveHourBudget("default_claude_max_5x")).toBe(5_000_000);
		expect(seedFiveHourBudget("default_claude_max_20x")).toBe(20_000_000);
		expect(seedFiveHourBudget("unknown")).toBe(5_000_000);
	});
	it("computes a clamped integer percent", () => {
		expect(budgetPercent(2_500_000, 9_000_000)).toBe(28);
		expect(budgetPercent(20_000_000, 9_000_000)).toBe(100);
		expect(budgetPercent(5, 0)).toBe(0);
	});
});

describe("weeklyAnchorMs", () => {
	it("returns the most recent {day} at {hour}:00 local at or before now", () => {
		// Wed 2026-05-27 09:00 local → most recent Monday 07:00 is Mon 2026-05-25.
		const now = new Date(2026, 4, 27, 9, 0, 0, 0).getTime();
		const anchor = weeklyAnchorMs(now, 1, 7); // Monday 07:00
		const a = new Date(anchor);
		expect(a.getDay()).toBe(1);
		expect(a.getHours()).toBe(7);
		expect(anchor).toBeLessThanOrEqual(now);
		expect(now - anchor).toBeLessThan(7 * 24 * 3_600_000);
	});
	it("steps back a full week when today is the day but before the hour", () => {
		// Monday 06:00, reset hour 07:00 → anchor is the previous Monday.
		const now = new Date(2026, 4, 25, 6, 0, 0, 0).getTime();
		const anchor = weeklyAnchorMs(now, 1, 7);
		expect(new Date(anchor).getDay()).toBe(1);
		expect(now - anchor).toBeGreaterThan(6 * 24 * 3_600_000);
	});
});
