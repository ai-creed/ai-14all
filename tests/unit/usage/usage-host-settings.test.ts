import { describe, expect, it } from "vitest";
import { UsageHost } from "../../../electron/main/services/usage-host.js";
import {
	UsageTelemetrySettingsSchema,
	type UsageTelemetrySettings,
} from "../../../shared/models/persisted-workspace-state.js";

function makeStore(init: Partial<UsageTelemetrySettings> = {}) {
	let settings = UsageTelemetrySettingsSchema.parse(init);
	return {
		loadSettings: () => settings,
		persistSettings: (patch: Partial<UsageTelemetrySettings>) => {
			settings = { ...settings, ...patch };
		},
		get current() {
			return settings;
		},
	};
}

const opts = (store: ReturnType<typeof makeStore>) => ({
	userDataDir: "/tmp/ud",
	launchMs: 0,
	send: () => {},
	loadSettings: store.loadSettings,
	persistSettings: store.persistSettings,
});

describe("UsageHost chipRange persistence (host contract)", () => {
	it("setChipRange writes the new range to the settings store", () => {
		const store = makeStore({ chipRange: "week" });
		new UsageHost(opts(store)).setChipRange("month");
		expect(store.current.chipRange).toBe("month");
	});

	it("a host recreated from the persisted store seeds chipRange into the next worker config", () => {
		const store = makeStore({ chipRange: "week" });
		new UsageHost(opts(store)).setChipRange("month"); // run 1 persists month
		const next = new UsageHost(opts(store)); // run 2 reads the persisted store
		expect(next.buildConfig().chipRange).toBe("month"); // seeds the config the worker receives
	});
});

// The settings:write funnel already persists (via SettingsService) before it
// live-applies to the host, so the host's appliers invoked from that path must
// NOT persist again — a second write would double-write settings.json and
// desync the usage-settings-bridge snapshot.
describe("UsageHost non-persisting appliers (settings:write live-apply seam)", () => {
	it("applyChipRange updates the effective range without persisting", () => {
		const store = makeStore({ chipRange: "week" });
		const host = new UsageHost(opts(store));

		host.applyChipRange("month");

		expect(store.current.chipRange).toBe("week"); // store untouched
		expect(host.buildConfig().chipRange).toBe("month"); // but live config updated
	});

	it("applyIncludeUntracked updates the effective flag without persisting", () => {
		const store = makeStore({ includeUntracked: false });
		const host = new UsageHost(opts(store));

		host.applyIncludeUntracked(true);

		expect(store.current.includeUntracked).toBe(false); // store untouched
		expect(host.buildConfig().includeUntracked).toBe(true); // but live config updated
	});
});
