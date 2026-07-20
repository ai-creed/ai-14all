import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	applyInsightsConsent,
	makeSetInsightsEnabled,
	registerInsightsIpc,
} from "../../../electron/main/insights-ipc.js";
import type { InsightsHost } from "../../../electron/main/services/insights-host.js";
import { SettingsService } from "../../../services/settings/settings-service.js";
import type { PersistedSettingsV1 } from "../../../shared/models/persisted-settings.js";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

// Minimal ipcMain double: records handle() registrations and lets tests invoke
// them by channel. Cast to Pick<IpcMain, "handle"> at the registrar seam (the
// registrar only calls handle()).
function stubIpcMain() {
	const handlers = new Map<string, IpcHandler>();
	return {
		handle: (channel: string, fn: IpcHandler) => handlers.set(channel, fn),
		invoke: (channel: string, ...args: unknown[]) =>
			handlers.get(channel)!({}, ...args),
		has: (channel: string) => handlers.has(channel),
	};
}
const asIpc = (s: ReturnType<typeof stubIpcMain>): Pick<IpcMain, "handle"> =>
	s as unknown as Pick<IpcMain, "handle">;

const sett = (
	over: Partial<PersistedSettingsV1["usageTelemetry"]> = {},
): PersistedSettingsV1 =>
	({
		usageTelemetry: {
			enabled: true,
			includeUntracked: false,
			chipRange: "week",
			insights: { enabled: true, noticeShown: false },
			...over,
		},
	}) as unknown as PersistedSettingsV1;

describe("insights IPC", () => {
	it("registers setEnabled + deleteAll + noticeAck; setEnabled routes to the persist+derive closure (never host.setEnabled)", async () => {
		const ipc = stubIpcMain();
		const host: Pick<InsightsHost, "deleteAll" | "ackNotice"> = {
			deleteAll: vi.fn().mockResolvedValue(undefined),
			ackNotice: vi.fn(),
		};
		const setInsightsEnabled = vi.fn();
		registerInsightsIpc(asIpc(ipc), host, setInsightsEnabled);
		expect(ipc.has("insights:setEnabled")).toBe(true);
		await ipc.invoke("insights:setEnabled", true);
		// Routed to the closure — the raw boolean never reaches the host directly.
		expect(setInsightsEnabled).toHaveBeenCalledWith(true);
		await ipc.invoke("insights:deleteAll");
		expect(host.deleteAll).toHaveBeenCalled();
		ipc.invoke("insights:noticeAck");
		expect(host.ackNotice).toHaveBeenCalled();
	});

	it("applyInsightsConsent enforces the master kill from persisted settings (raw true never forces start)", () => {
		const setEnabled = vi.fn();
		const host: Pick<InsightsHost, "setEnabled"> = { setEnabled };
		applyInsightsConsent(host, sett()); // both on
		applyInsightsConsent(host, sett({ enabled: false })); // global off
		applyInsightsConsent(
			host,
			sett({ insights: { enabled: false, noticeShown: false } }),
		); // sub off
		expect(setEnabled.mock.calls.map((c) => c[0])).toEqual([
			true,
			false,
			false,
		]);
	});

	it("makeSetInsightsEnabled persists then derives via the REAL SettingsService (global off => host stays stopped)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ins-ipc-"));
		try {
			const svc = new SettingsService(
				join(dir, "settings.json"),
				join(dir, "legacy.json"),
			);
			await svc.readState(); // seed defaults
			await svc.writeState({ usageTelemetry: { enabled: false } }); // global telemetry OFF (sub-toggle still on)
			const setEnabled = vi.fn();
			const host: Pick<InsightsHost, "setEnabled"> = { setEnabled };
			const setInsightsEnabled = makeSetInsightsEnabled(svc, host); // the ACTUAL wiring closure

			await setInsightsEnabled(true); // user flips the insights sub-toggle ON…
			expect(setEnabled).toHaveBeenCalledWith(false); // …global opt-out wins: host stays stopped (master kill)
			const { settings } = await svc.readState();
			expect(settings.usageTelemetry.insights.enabled).toBe(true); // …but the sub-preference IS persisted
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
