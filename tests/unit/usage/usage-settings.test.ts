import { describe, expect, it } from "vitest";
import { UsageTelemetrySettingsSchema } from "../../../shared/models/persisted-workspace-state.js";

describe("UsageTelemetrySettingsSchema", () => {
	it("defaults enabled on, untracked off, week range", () => {
		expect(UsageTelemetrySettingsSchema.parse({})).toEqual({
			enabled: true,
			includeUntracked: false,
			range: "week",
		});
	});
	it("accepts overrides", () => {
		const parsed = UsageTelemetrySettingsSchema.parse({
			enabled: false,
			range: "month",
		});
		expect(parsed.enabled).toBe(false);
		expect(parsed.range).toBe("month");
	});
	it("rejects a removed budget field by ignoring it", () => {
		const parsed = UsageTelemetrySettingsSchema.parse({ weeklyBudget: 5 } as never);
		expect("weeklyBudget" in parsed).toBe(false);
	});
});
