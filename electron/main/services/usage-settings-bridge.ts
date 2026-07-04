import type { UsageTelemetrySettings } from "../../../shared/models/persisted-workspace-state.js";
import type { SettingsService } from "../../../services/settings/settings-service.js";

export interface UsageSettingsBridge {
	settings: UsageTelemetrySettings; // synchronous snapshot for UsageHost.loadSettings
	persist: (patch: Partial<UsageTelemetrySettings>) => Promise<void>;
}

// Load persisted usage settings once (async) via SettingsService, then return a
// bridge whose `persist` updates the in-memory snapshot synchronously and writes
// it back through SettingsService.writeState({ usageTelemetry }). writeState()
// deep-merges the nested usageTelemetry object against the current persisted
// settings, so a partial patch (e.g. just chipRange) can't clobber the other two
// fields — no read-modify-write of the whole file is needed here. It returns a
// Promise so tests can await the disk write; the app fires it without awaiting —
// `(patch) => Promise<void>` is assignable to the host's
// `persistSettings: (patch) => void`.
export async function createUsageSettingsBridge(
	settingsService: SettingsService,
): Promise<UsageSettingsBridge> {
	const initial = await settingsService.readState();
	let settings = initial.settings.usageTelemetry;
	const bridge: UsageSettingsBridge = {
		settings,
		async persist(patch) {
			settings = { ...settings, ...patch };
			bridge.settings = settings;
			try {
				await settingsService.writeState({ usageTelemetry: settings });
			} catch (err) {
				console.error("usage settings persist failed:", err);
			}
		},
	};
	return bridge;
}
