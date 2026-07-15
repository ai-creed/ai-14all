import { describe, it, expect, vi } from "vitest";

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
	PHONE_BRIDGE_FORGET,
	PHONE_BRIDGE_CANCEL_PAIRING,
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

	it("phoneBridge:forget invokes forgetDevice() and returns the post-forget status", async () => {
		const ipcMain = makeIpcMain();
		const forgetDevice = vi.fn(async () => {});
		const service = {
			forgetDevice,
			getStatus: () => ({
				enabled: true,
				listening: true,
				addr: "10.0.0.5",
				port: 51820,
				paired: false,
				sas: null,
			}),
		};
		registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => service as never,
			getWebContents: () => undefined,
		});
		const status = await ipcMain.invoke(PHONE_BRIDGE_FORGET);
		expect(forgetDevice).toHaveBeenCalledTimes(1);
		expect(status).toMatchObject({ enabled: true, paired: false });
	});

	it("phoneBridge:forget is a graceful no-op returning undefined when the service is null", async () => {
		const ipcMain = makeIpcMain();
		registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => null,
			getWebContents: () => undefined,
		});
		await expect(ipcMain.invoke(PHONE_BRIDGE_FORGET)).resolves.toBeUndefined();
	});

	it("dispose() removes the phoneBridge:forget handler", async () => {
		const ipcMain = makeIpcMain();
		const service = {
			forgetDevice: vi.fn(async () => {}),
			getStatus: () => ({
				enabled: true,
				listening: true,
				addr: null,
				port: null,
				paired: false,
				sas: null,
			}),
		};
		const reg = registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => service as never,
			getWebContents: () => undefined,
		});
		expect(await ipcMain.invoke(PHONE_BRIDGE_FORGET)).toBeDefined();
		reg.dispose();
		expect(await ipcMain.invoke(PHONE_BRIDGE_FORGET)).toBeUndefined();
	});

	const extendedStatus = {
		enabled: true,
		listening: true,
		addr: "10.0.0.5",
		port: 51820,
		paired: false,
		sas: null,
		pairing: "idle",
		offer: null,
		offerExpiresAt: null,
		pairedAt: null,
		grantedPermissions: null,
		lastError: null,
	};

	it("phoneBridge:cancelPairing invokes cancelPairing() and returns the post-cancel status", async () => {
		const ipcMain = makeIpcMain();
		const cancelPairing = vi.fn(async () => {});
		const service = { cancelPairing, getStatus: () => extendedStatus };
		registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => service as never,
			getWebContents: () => undefined,
		});
		const status = await ipcMain.invoke(PHONE_BRIDGE_CANCEL_PAIRING);
		expect(cancelPairing).toHaveBeenCalledTimes(1);
		expect(status).toMatchObject({ pairing: "idle" });
	});

	it("phoneBridge:cancelPairing is a graceful no-op returning undefined when the service is null", async () => {
		const ipcMain = makeIpcMain();
		registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => null,
			getWebContents: () => undefined,
		});
		expect(await ipcMain.invoke(PHONE_BRIDGE_CANCEL_PAIRING)).toBeUndefined();
	});

	it("dispose() removes the cancelPairing handler", async () => {
		const ipcMain = makeIpcMain();
		const { dispose } = registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => null,
			getWebContents: () => undefined,
		});
		dispose();
		expect(await ipcMain.invoke(PHONE_BRIDGE_CANCEL_PAIRING)).toBeUndefined();
	});

	it("null-service status fallback carries the extended state-machine fields", async () => {
		const ipcMain = makeIpcMain();
		registerXbpIpc({
			ipcMain: ipcMain as never,
			getService: () => null,
			getWebContents: () => undefined,
		});
		expect(await ipcMain.invoke(PHONE_BRIDGE_STATUS)).toMatchObject({
			enabled: false,
			pairing: "idle",
			offer: null,
			offerExpiresAt: null,
			pairedAt: null,
			grantedPermissions: null,
			lastError: null,
		});
	});
});
