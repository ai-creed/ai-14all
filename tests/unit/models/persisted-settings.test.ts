import { describe, expect, it } from "vitest";
import {
	DEFAULT_PERSISTED_SETTINGS,
	PersistedSettingsV1Schema,
	SettingsPatchSchema,
} from "../../../shared/models/persisted-settings";

describe("PersistedSettingsV1Schema", () => {
	it("fills every field with its default from a bare version stamp", () => {
		const parsed = PersistedSettingsV1Schema.parse({ version: 1 });
		expect(parsed).toEqual({
			version: 1,
			theme: "system",
			terminalFontSize: 13,
			restorePreference: "prompt",
			restoreDepth: "stateEagerTerminalsLazy",
			agentResume: "auto",
			usageTelemetry: { enabled: true, includeUntracked: false, chipRange: "week" },
		});
	});

	it("DEFAULT_PERSISTED_SETTINGS equals the parsed bare stamp", () => {
		expect(DEFAULT_PERSISTED_SETTINGS).toEqual(
			PersistedSettingsV1Schema.parse({ version: 1 }),
		);
	});

	it("rejects out-of-range font size and unknown enum values", () => {
		expect(
			PersistedSettingsV1Schema.safeParse({ version: 1, terminalFontSize: 9 }).success,
		).toBe(false);
		expect(
			PersistedSettingsV1Schema.safeParse({ version: 1, theme: "solarized" }).success,
		).toBe(false);
	});

	it("SettingsPatchSchema accepts partial updates and rejects version", () => {
		expect(SettingsPatchSchema.parse({ theme: "warm" })).toEqual({ theme: "warm" });
		expect("version" in SettingsPatchSchema.parse({ version: 1 } as never)).toBe(false);
	});
});
