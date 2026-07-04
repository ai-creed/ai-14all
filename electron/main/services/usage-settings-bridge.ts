import type { PersistedSettingsV1 } from "../../../shared/models/persisted-settings.js";
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
//
// `onPersisted` is the other half of the settings:write <-> usage bridge seam
// (spec §3.2): this bridge is a second writer to SettingsService that bypasses
// the `settings:write` IPC handler entirely (e.g. the usage popover's "include
// untracked" / chipRange toggles), so without this hook the Settings dialog's
// renderer state goes stale until restart. The caller (main/index.ts) wires it
// to broadcast `settings:changed` to renderer windows — the same event
// `settings:write` sends — so both surfaces converge. It fires only from a
// successful `writeState()` call and never re-enters `persist()`, so there is
// no write -> broadcast -> write loop.
export async function createUsageSettingsBridge(
	settingsService: SettingsService,
	onPersisted?: (settings: PersistedSettingsV1) => void,
): Promise<UsageSettingsBridge> {
	const initial = await settingsService.readState();
	let settings = initial.settings.usageTelemetry;
	const bridge: UsageSettingsBridge = {
		settings,
		async persist(patch) {
			settings = { ...settings, ...patch };
			bridge.settings = settings;
			try {
				const merged = await settingsService.writeState({
					usageTelemetry: settings,
				});
				onPersisted?.(merged);
			} catch (err) {
				console.error("usage settings persist failed:", err);
			}
		},
	};
	return bridge;
}
