import type { PersistedSettingsV1 } from "../../../shared/models/persisted-settings.js";
import type { UsageTelemetrySettings } from "../../../shared/models/persisted-workspace-state.js";
import type { SettingsService } from "../../../services/settings/settings-service.js";

export interface UsageSettingsBridge {
	settings: UsageTelemetrySettings; // synchronous snapshot for UsageHost.loadSettings
	persist: (patch: Partial<UsageTelemetrySettings>) => Promise<void>;
	// Refresh the in-memory snapshot from an external merged settings write (the
	// settings:write IPC handler, which persists usageTelemetry itself). Without
	// this the bridge snapshot goes stale, and a later popover chipRange /
	// includeUntracked click would seed the worker from — and (pre-fix) write
	// back — the stale value.
	refresh: (settings: PersistedSettingsV1) => void;
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
		refresh(next) {
			settings = next.usageTelemetry;
			bridge.settings = settings;
		},
		async persist(patch) {
			try {
				// Hand writeState() the *bare* patch and let its deep-merge own the
				// merge against the authoritative on-disk state. Pre-merging into the
				// local `settings` snapshot (which an external settings:write may have
				// left stale) then writing the whole sub-object back would resurrect
				// the stale value. Refresh the snapshot from the returned merged
				// result so it stays coherent for the next popover click.
				const merged = await settingsService.writeState({
					usageTelemetry: patch,
				});
				settings = merged.usageTelemetry;
				bridge.settings = settings;
				onPersisted?.(merged);
			} catch (err) {
				console.error("usage settings persist failed:", err);
			}
		},
	};
	return bridge;
}
