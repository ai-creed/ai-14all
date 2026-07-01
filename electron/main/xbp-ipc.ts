import type { XbpHostService } from "../../services/xbp/xbp-host-service.js";

export const PHONE_BRIDGE_STATUS = "phoneBridge:status";
export const PHONE_BRIDGE_SET_ENABLED = "phoneBridge:setEnabled";
export const PHONE_BRIDGE_START_PAIRING = "phoneBridge:startPairing";
export const PHONE_BRIDGE_CONFIRM_SAS = "phoneBridge:confirmSas";
export const PHONE_BRIDGE_STATUS_CHANGED = "phoneBridge:statusChanged";

export function registerXbpIpc(deps: {
	ipcMain: Electron.IpcMain;
	getService: () => XbpHostService | null;
	getWebContents: () => Electron.WebContents | undefined;
}): { dispose(): void } {
	const { ipcMain } = deps;
	ipcMain.handle(
		PHONE_BRIDGE_STATUS,
		() =>
			deps.getService()?.getStatus() ?? {
				enabled: false,
				listening: false,
				addr: null,
				port: null,
				paired: false,
				sas: null,
			},
	);
	ipcMain.handle(PHONE_BRIDGE_SET_ENABLED, async (_e, raw) => {
		await deps
			.getService()
			?.setEnabled(Boolean((raw as { enabled: boolean }).enabled));
		return deps.getService()?.getStatus();
	});
	ipcMain.handle(PHONE_BRIDGE_START_PAIRING, async () => {
		const offer = await deps.getService()?.startPairing();
		return { offer: offer ? JSON.stringify(offer) : null };
	});
	ipcMain.handle(PHONE_BRIDGE_CONFIRM_SAS, (_e, raw) =>
		Boolean(
			deps.getService()?.confirmPairing(Boolean((raw as { ok: boolean }).ok)),
		),
	);
	return {
		dispose() {
			ipcMain.removeHandler(PHONE_BRIDGE_STATUS);
			ipcMain.removeHandler(PHONE_BRIDGE_SET_ENABLED);
			ipcMain.removeHandler(PHONE_BRIDGE_START_PAIRING);
			ipcMain.removeHandler(PHONE_BRIDGE_CONFIRM_SAS);
		},
	};
}
