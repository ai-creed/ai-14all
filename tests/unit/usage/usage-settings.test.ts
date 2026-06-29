import { describe, expect, it } from "vitest";
import { UsageTelemetrySettingsSchema } from "../../../shared/models/persisted-workspace-state.js";

describe("UsageTelemetrySettingsSchema", () => {
	it("defaults to enabled, tracked-only, week chip range", () => {
		expect(UsageTelemetrySettingsSchema.parse({})).toEqual({
			enabled: true,
			includeUntracked: false,
			chipRange: "week",
		});
	});

	it("rejects a popoverScope field is irrelevant — it simply isn't part of the schema", () => {
		const parsed = UsageTelemetrySettingsSchema.parse({
			chipRange: "month",
			popoverScope: "all-time",
		});
		expect(parsed).toEqual({
			enabled: true,
			includeUntracked: false,
			chipRange: "month",
		});
		expect("popoverScope" in parsed).toBe(false);
	});
});
