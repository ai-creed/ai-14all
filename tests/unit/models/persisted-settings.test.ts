import { describe, expect, it } from "vitest";
import {
	DEFAULT_PERSISTED_SETTINGS,
	isPhoneBridgeEnabled,
	isPushWakeEnabled,
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
			usageTelemetry: {
				enabled: true,
				includeUntracked: false,
				chipRange: "week",
			},
			phoneBridge: {
				enabled: false,
				pushWakeEnabled: true,
			},
		});
	});

	it("DEFAULT_PERSISTED_SETTINGS equals the parsed bare stamp", () => {
		expect(DEFAULT_PERSISTED_SETTINGS).toEqual(
			PersistedSettingsV1Schema.parse({ version: 1 }),
		);
	});

	it("rejects out-of-range font size and unknown enum values", () => {
		expect(
			PersistedSettingsV1Schema.safeParse({ version: 1, terminalFontSize: 9 })
				.success,
		).toBe(false);
		expect(
			PersistedSettingsV1Schema.safeParse({ version: 1, theme: "solarized" })
				.success,
		).toBe(false);
	});

	it("SettingsPatchSchema accepts partial updates and rejects version", () => {
		expect(SettingsPatchSchema.parse({ theme: "warm" })).toEqual({
			theme: "warm",
		});
		expect(
			"version" in SettingsPatchSchema.parse({ version: 1 } as never),
		).toBe(false);
	});
});

describe("phoneBridge flag", () => {
	it("defaults phoneBridge.enabled to false", () => {
		expect(DEFAULT_PERSISTED_SETTINGS.phoneBridge.enabled).toBe(false);
		expect(
			PersistedSettingsV1Schema.parse({ version: 1 }).phoneBridge.enabled,
		).toBe(false);
	});

	it("parses a legacy object with no phoneBridge to the false default", () => {
		const parsed = PersistedSettingsV1Schema.parse({
			version: 1,
			theme: "dark",
		});
		expect(parsed.phoneBridge.enabled).toBe(false);
	});

	it("accepts an explicit phoneBridge.enabled true", () => {
		const parsed = PersistedSettingsV1Schema.parse({
			version: 1,
			phoneBridge: { enabled: true },
		});
		expect(parsed.phoneBridge.enabled).toBe(true);
	});

	it("SettingsPatchSchema accepts a phoneBridge sub-patch", () => {
		expect(
			SettingsPatchSchema.parse({ phoneBridge: { enabled: true } }).phoneBridge,
		).toEqual({ enabled: true });
	});

	it("isPhoneBridgeEnabled returns the flag value", () => {
		expect(
			isPhoneBridgeEnabled(
				PersistedSettingsV1Schema.parse({
					version: 1,
					phoneBridge: { enabled: true },
				}),
			),
		).toBe(true);
		expect(
			isPhoneBridgeEnabled(PersistedSettingsV1Schema.parse({ version: 1 })),
		).toBe(false);
	});

	it("defaults pushWakeEnabled to true, including for pre-existing files without the key", () => {
		const parsed = PersistedSettingsV1Schema.parse({
			version: 1,
			phoneBridge: { enabled: true },
		});
		expect(parsed.phoneBridge.pushWakeEnabled).toBe(true);
		expect(isPushWakeEnabled(parsed)).toBe(true);
	});

	it("pushWakeEnabled=false is honored and patchable", () => {
		const parsed = PersistedSettingsV1Schema.parse({
			version: 1,
			phoneBridge: { enabled: true, pushWakeEnabled: false },
		});
		expect(isPushWakeEnabled(parsed)).toBe(false);
		const patch = SettingsPatchSchema.parse({
			phoneBridge: { pushWakeEnabled: false },
		});
		// zod-v4 trap regression: a sub-patch must NOT re-inject sibling defaults.
		expect(patch.phoneBridge).toEqual({ pushWakeEnabled: false });
	});
});
