import { describe, expect, it } from "vitest";
import { UsageTelemetrySettingsSchema } from "../../../shared/models/persisted-workspace-state.js";

describe("UsageTelemetrySettingsSchema", () => {
	it("defaults enabled on with seeded-null budgets", () => {
		const parsed = UsageTelemetrySettingsSchema.parse({});
		expect(parsed).toEqual({
			enabled: true,
			fiveHourBudget: null,
			weeklyBudget: null,
			includeUntracked: false,
			weeklyResetDay: 1,
			weeklyResetHour: 7,
		});
	});
	it("accepts overrides", () => {
		const parsed = UsageTelemetrySettingsSchema.parse({
			enabled: false,
			weeklyBudget: 30_000_000,
		});
		expect(parsed.enabled).toBe(false);
		expect(parsed.weeklyBudget).toBe(30_000_000);
	});
});
