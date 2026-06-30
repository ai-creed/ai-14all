import { describe, it, expect } from "vitest";

function makeIpcMain() {
	const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();
	return {
		handle: (ch: string, h: (e: unknown, raw: unknown) => unknown) =>
			handlers.set(ch, h),
		removeHandler: (ch: string) => handlers.delete(ch),
		invoke: (ch: string, raw?: unknown) => handlers.get(ch)?.(undefined, raw),
	};
}

import {
	registerXbpIpc,
	PHONE_BRIDGE_STATUS,
} from "../../../electron/main/xbp-ipc";

describe("registerXbpIpc", () => {
	it("returns the service status over phoneBridge:status", async () => {
		const ipcMain = makeIpcMain();
		const service = {
			getStatus: () => ({
				enabled: true,
				listening: true,
				addr: "10.0.0.5",
				port: 51820,
				paired: false,
				sas: "048213",
			}),
		};
		registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => service as never,
			getWebContents: () => undefined,
		});
		const status = await ipcMain.invoke(PHONE_BRIDGE_STATUS);
		expect(status).toMatchObject({
			listening: true,
			port: 51820,
			sas: "048213",
		});
	});
});
