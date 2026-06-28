import {
	UsageTelemetrySettingsSchema,
	type UsageTelemetrySettings,
} from "../../../shared/models/persisted-workspace-state.js";
import type { WorkspacePersistenceService } from "../../../services/workspace/workspace-persistence-service.js";

export interface UsageSettingsBridge {
	settings: UsageTelemetrySettings; // synchronous snapshot for UsageHost.loadSettings
	persist: (patch: Partial<UsageTelemetrySettings>) => Promise<void>;
}

// Load persisted usage settings once (async), then return a bridge whose `persist`
// updates the in-memory snapshot synchronously and writes the FULL latest state back
// (read-modify-write, so a chipRange change preserves activeWorkspaceId, workspaces,
// etc.). It returns a Promise so tests can await the disk write; the app fires it
// without awaiting — `(patch) => Promise<void>` is assignable to the host's
// `persistSettings: (patch) => void`.
export async function createUsageSettingsBridge(
	persistence: WorkspacePersistenceService,
): Promise<UsageSettingsBridge> {
	const initial = await persistence.readState();
	let settings = UsageTelemetrySettingsSchema.parse(initial.usageTelemetry ?? {});
	const bridge: UsageSettingsBridge = {
		settings,
		async persist(patch) {
			settings = { ...settings, ...patch };
			bridge.settings = settings;
			const latest = await persistence.readState();
			await persistence.writeState({ ...latest, usageTelemetry: settings });
		},
	};
	return bridge;
}
