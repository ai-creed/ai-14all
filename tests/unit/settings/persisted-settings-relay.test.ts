import { describe, expect, it } from "vitest";
import {
	PersistedSettingsV1Schema,
	SettingsPatchSchema,
	isValidRelayBaseUrl,
} from "../../../shared/models/persisted-settings";

describe("phoneBridge.relayBaseUrl", () => {
	it("defaults to empty (LAN-only)", () => {
		const s = PersistedSettingsV1Schema.parse({ version: 1 });
		expect(s.phoneBridge.relayBaseUrl).toBe("");
	});
	it("accepts a wss URL and strips the trailing slash", () => {
		const p = SettingsPatchSchema.parse({
			phoneBridge: { relayBaseUrl: "wss://relay.example.com/" },
		});
		expect(p.phoneBridge?.relayBaseUrl).toBe("wss://relay.example.com");
	});
	it.each(["ws://relay.example.com", "http://x", "https://x", "not a url", "wss://x/?q=1", "wss://x/#f"])(
		"rejects %s at persist time",
		(bad) => {
			expect(() =>
				SettingsPatchSchema.parse({ phoneBridge: { relayBaseUrl: bad } }),
			).toThrow();
		},
	);
	it("accepts empty string (clears the setting)", () => {
		const p = SettingsPatchSchema.parse({ phoneBridge: { relayBaseUrl: "" } });
		expect(p.phoneBridge?.relayBaseUrl).toBe("");
	});
	it("a phoneBridge sub-patch without relayBaseUrl leaves the key absent (deep-merge safety)", () => {
		const p = SettingsPatchSchema.parse({ phoneBridge: { enabled: true } });
		expect(p.phoneBridge && "relayBaseUrl" in p.phoneBridge).toBe(false);
	});
	it("isValidRelayBaseUrl matches the schema verdicts", () => {
		expect(isValidRelayBaseUrl("wss://relay.example.com")).toBe(true);
		expect(isValidRelayBaseUrl("ws://relay.example.com")).toBe(false);
	});
});
