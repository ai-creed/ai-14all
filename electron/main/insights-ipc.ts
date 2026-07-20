import type { IpcMain } from "electron";
import { isInsightsCaptureEnabled } from "../../shared/models/persisted-workspace-state.js";
import type { PersistedSettingsV1 } from "../../shared/models/persisted-settings.js";
import type { SettingsService } from "../../services/settings/settings-service.js";
import type { InsightsHost } from "./services/insights-host.js";

// Registers the three renderer-facing insights IPC handlers.
//
// insights:setEnabled deliberately routes through the `setInsightsEnabled`
// closure (see makeSetInsightsEnabled) rather than calling host.setEnabled
// directly: the renderer boolean is a REQUEST to persist the sub-setting, from
// which effective consent is then DERIVED server-side (§7.2 master kill). The
// raw boolean must never reach the host, or a renderer could force capture on
// while global telemetry is opted out.
export function registerInsightsIpc(
	ipcMain: Pick<IpcMain, "handle">,
	host: Pick<InsightsHost, "deleteAll" | "ackNotice">,
	setInsightsEnabled: (enabled: boolean) => void | Promise<void>,
): void {
	ipcMain.handle("insights:setEnabled", async (_event, enabled: unknown) => {
		await setInsightsEnabled(Boolean(enabled));
	});
	ipcMain.handle("insights:deleteAll", async () => {
		await host.deleteAll();
	});
	ipcMain.handle("insights:noticeAck", () => {
		host.ackNotice();
	});
}

// Derives effective insights-capture consent (global telemetry AND the insights
// sub-toggle) from persisted settings and applies it to the host. Called at
// startup and on every settings:write so the master kill (§7.2) is enforced
// server-side, never from a renderer-supplied boolean.
export function applyInsightsConsent(
	host: Pick<InsightsHost, "setEnabled">,
	settings: PersistedSettingsV1,
): void {
	host.setEnabled(isInsightsCaptureEnabled(settings.usageTelemetry));
}

// The persist-then-derive closure the insights:setEnabled handler uses: persist
// the requested sub-setting, then derive effective consent from the WRITTEN
// settings — never the raw renderer boolean. Exported so the master-kill test
// exercises this exact function rather than a local copy.
export function makeSetInsightsEnabled(
	settingsService: Pick<SettingsService, "writeState">,
	host: Pick<InsightsHost, "setEnabled">,
): (enabled: boolean) => Promise<void> {
	return async (enabled) => {
		const next = await settingsService.writeState({
			usageTelemetry: { insights: { enabled } },
		});
		applyInsightsConsent(host, next);
	};
}
