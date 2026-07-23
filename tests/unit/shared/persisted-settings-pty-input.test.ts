import { describe, expect, it } from "vitest";
import {
	DEFAULT_PERSISTED_SETTINGS,
	PersistedSettingsV1Schema,
	SettingsPatchSchema,
	isPtyInputEnabled,
} from "../../../shared/models/persisted-settings";

describe("phoneBridge.ptyInputEnabled (pty-input child spec §2)", () => {
	it("defaults ON — the grant is the opt-in; the toggle is a live disarm switch", () => {
		expect(DEFAULT_PERSISTED_SETTINGS.phoneBridge.ptyInputEnabled).toBe(true);
		expect(isPtyInputEnabled(DEFAULT_PERSISTED_SETTINGS)).toBe(true);
	});

	it("a stored file without the field parses to true (upgrade path)", () => {
		const parsed = PersistedSettingsV1Schema.parse({
			version: 1,
			phoneBridge: { enabled: true, pushWakeEnabled: true },
		});
		expect(parsed.phoneBridge.ptyInputEnabled).toBe(true);
	});

	it("patch schema carries ptyInputEnabled and leaves it absent when unmentioned", () => {
		const explicit = SettingsPatchSchema.parse({
			phoneBridge: { ptyInputEnabled: false },
		});
		expect(explicit.phoneBridge?.ptyInputEnabled).toBe(false);
		// Deep-merge safety: patching a sibling key must not inject a value for
		// ptyInputEnabled (same rationale as the bare patch-schema comment in
		// persisted-settings.ts).
		const sibling = SettingsPatchSchema.parse({
			phoneBridge: { enabled: true },
		});
		expect("ptyInputEnabled" in (sibling.phoneBridge ?? {})).toBe(false);
	});
});
