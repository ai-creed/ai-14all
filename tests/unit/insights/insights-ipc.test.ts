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
import {
	buildInsightsTestBridge,
	INSIGHTS_TEST_CHANNEL,
	INSIGHTS_TEST_SIGNALS,
	isInsightsTestSeamEnabled,
} from "../../../shared/models/insights-test-seam.js";

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

// The host surface registerInsightsIpc consumes — kept as one alias so the
// Pick<...> key list (widened for queryAppTimeSeries/coverageAnchors) stays in
// sync across every stub in this file instead of drifting per call site.
type InsightsIpcHost = Pick<
	InsightsHost,
	| "deleteAll"
	| "ackNotice"
	| "isNoticePending"
	| "query"
	| "queryAppTime"
	| "queryAppTimeSeries"
	| "coverageAnchors"
>;

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
	it("registers setEnabled + deleteAll + noticeAck + noticePending; setEnabled routes to the persist+derive closure (never host.setEnabled)", async () => {
		const ipc = stubIpcMain();
		const host: InsightsIpcHost = {
			deleteAll: vi.fn().mockResolvedValue(undefined),
			ackNotice: vi.fn(),
			isNoticePending: vi.fn().mockReturnValue(true),
			query: vi.fn().mockResolvedValue({ runs: [], completeness: "unknown" }),
			queryAppTime: vi.fn(),
			queryAppTimeSeries: vi.fn(),
			coverageAnchors: vi.fn(),
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
		// Pull-on-mount recovery channel routes straight to host.isNoticePending.
		expect(ipc.has("insights:noticePending")).toBe(true);
		expect(ipc.invoke("insights:noticePending")).toBe(true);
		expect(host.isNoticePending).toHaveBeenCalled();
	});

	it("registers insights:query and routes to host.query with a normalized range", async () => {
		const ipc = stubIpcMain();
		const query = vi
			.fn()
			.mockResolvedValue({ runs: [], completeness: "unknown" });
		const host = {
			deleteAll: vi.fn(),
			ackNotice: vi.fn(),
			isNoticePending: vi.fn(),
			query,
			queryAppTime: vi.fn(),
			queryAppTimeSeries: vi.fn(),
			coverageAnchors: vi.fn(),
		} as unknown as InsightsIpcHost;
		registerInsightsIpc(asIpc(ipc), host, vi.fn());

		expect(ipc.has("insights:query")).toBe(true);
		await ipc.invoke("insights:query", { fromMs: 10, toMs: 20 });
		expect(query).toHaveBeenCalledWith({ fromMs: 10, toMs: 20 });

		// The range is renderer-supplied: non-finite fields normalize to 0, never
		// reaching the worker's SQL bind params as strings/NaN/undefined.
		await ipc.invoke("insights:query", { fromMs: "x", toMs: null });
		expect(query).toHaveBeenLastCalledWith({ fromMs: 0, toMs: 0 });
		await ipc.invoke("insights:query", undefined);
		expect(query).toHaveBeenLastCalledWith({ fromMs: 0, toMs: 0 });
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

describe("insights seam guard + appTime query", () => {
	const host = () =>
		({
			deleteAll: vi.fn(),
			ackNotice: vi.fn(),
			isNoticePending: vi.fn(),
			query: vi.fn(),
			queryAppTime: vi.fn().mockResolvedValue({
				focusedMs: 1,
				engagedMs: 2,
				completeness: "partial",
			}),
			queryAppTimeSeries: vi.fn().mockResolvedValue({
				ok: true,
				data: { buckets: [], completeness: "partial" },
			}),
			coverageAnchors: vi.fn().mockResolvedValue({
				ok: true,
				data: {
					firstCaptureAt: null,
					appRetainedSinceMs: null,
					runsRetainedSinceMs: null,
				},
			}),
		}) as unknown as InsightsIpcHost;

	it("registers insights:queryAppTime and normalizes the range", async () => {
		const ipc = stubIpcMain();
		const h = host();
		registerInsightsIpc(asIpc(ipc), h, vi.fn());
		expect(ipc.has("insights:queryAppTime")).toBe(true);
		await ipc.invoke("insights:queryAppTime", { fromMs: 5, toMs: 9 });
		expect(
			(h as unknown as { queryAppTime: ReturnType<typeof vi.fn> }).queryAppTime,
		).toHaveBeenCalledWith({ fromMs: 5, toMs: 9 });
		await ipc.invoke("insights:queryAppTime", { fromMs: "x", toMs: null });
		expect(
			(h as unknown as { queryAppTime: ReturnType<typeof vi.fn> }).queryAppTime,
		).toHaveBeenLastCalledWith({ fromMs: 0, toMs: 0 });
	});

	it("registers insights:queryAppTimeSeries and insights:coverageAnchors, routing straight to the host", async () => {
		const ipc = stubIpcMain();
		const h = host();
		registerInsightsIpc(asIpc(ipc), h, vi.fn());

		expect(ipc.has("insights:queryAppTimeSeries")).toBe(true);
		await ipc.invoke("insights:queryAppTimeSeries", [0, 1000]);
		expect(
			(h as unknown as { queryAppTimeSeries: ReturnType<typeof vi.fn> })
				.queryAppTimeSeries,
		).toHaveBeenCalledWith([0, 1000]);

		expect(ipc.has("insights:coverageAnchors")).toBe(true);
		await ipc.invoke("insights:coverageAnchors");
		expect(
			(h as unknown as { coverageAnchors: ReturnType<typeof vi.fn> })
				.coverageAnchors,
		).toHaveBeenCalled();
	});

	it("insights:queryAppTimeSeries passes non-array input through UNVALIDATED — the host owns the bad-request path", async () => {
		const ipc = stubIpcMain();
		const h = host();
		registerInsightsIpc(asIpc(ipc), h, vi.fn());

		await ipc.invoke("insights:queryAppTimeSeries", "garbage");
		expect(
			(h as unknown as { queryAppTimeSeries: ReturnType<typeof vi.fn> })
				.queryAppTimeSeries,
		).toHaveBeenCalledWith("garbage");
	});

	it("the seam is ABSENT on BOTH sides without AI14ALL_E2E (unreachable in production)", () => {
		expect(isInsightsTestSeamEnabled({})).toBe(false);

		// Main side: the channel is never registered.
		const ipc = stubIpcMain();
		registerInsightsIpc(asIpc(ipc), host(), vi.fn(), {
			seam: { signal: vi.fn(), crashWorker: vi.fn() },
			env: {},
		});
		expect(ipc.has(INSIGHTS_TEST_CHANNEL)).toBe(false);

		// Renderer side: this is the EXACT call preload makes, so an unconditional
		// exposure cannot pass. No flag ⇒ undefined ⇒ window.ai14all.__insightsTest
		// is absent, and nothing is wired to ipcRenderer.
		const invoke = vi.fn().mockResolvedValue({ ok: true });
		expect(buildInsightsTestBridge({}, invoke)).toBeUndefined();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("with the flag, the real preload bridge is built and routes to the seam channel", async () => {
		const invoke = vi.fn().mockResolvedValue({ ok: true });
		const bridge = buildInsightsTestBridge({ AI14ALL_E2E: "1" }, invoke);
		expect(bridge).toBeDefined();
		await bridge!.signal("idle", { atMs: 7, idleSeconds: 3 });
		expect(invoke).toHaveBeenCalledWith(INSIGHTS_TEST_CHANNEL, {
			type: "idle",
			atMs: 7,
			idleSeconds: 3,
		});
		await bridge!.crashWorker();
		expect(invoke).toHaveBeenLastCalledWith(INSIGHTS_TEST_CHANNEL, {
			type: "crashWorker",
		});
	});

	it("with the flag it accepts ONLY enumerated signals and rejects anything else", () => {
		expect(isInsightsTestSeamEnabled({ AI14ALL_E2E: "1" })).toBe(true);
		const ipc = stubIpcMain();
		const seam = { signal: vi.fn(), crashWorker: vi.fn() };
		registerInsightsIpc(asIpc(ipc), host(), vi.fn(), {
			seam,
			env: { AI14ALL_E2E: "1" },
		});
		expect(ipc.has(INSIGHTS_TEST_CHANNEL)).toBe(true);

		// Pin the enumeration itself: the loop below proves every LISTED signal is
		// accepted, but only this catches the array silently growing an entry.
		expect(INSIGHTS_TEST_SIGNALS).toEqual([
			"focus",
			"blur",
			"idle",
			"suspend",
			"resume",
			"flush",
		]);

		// EVERY enumerated signal is accepted and forwarded — not just one.
		for (const type of INSIGHTS_TEST_SIGNALS) {
			seam.signal.mockClear();
			expect(
				ipc.invoke(INSIGHTS_TEST_CHANNEL, { type, atMs: 5, idleSeconds: 2 }),
			).toEqual({ ok: true });
			expect(seam.signal).toHaveBeenCalledWith(type, {
				atMs: 5,
				idleSeconds: 2,
			});
		}
		expect(ipc.invoke(INSIGHTS_TEST_CHANNEL, { type: "crashWorker" })).toEqual({
			ok: true,
		});
		expect(seam.crashWorker).toHaveBeenCalled();

		seam.signal.mockClear();
		expect(ipc.invoke(INSIGHTS_TEST_CHANNEL, { type: "evict" })).toEqual({
			ok: false,
			error: "unsupported_signal",
		});
		expect(ipc.invoke(INSIGHTS_TEST_CHANNEL, "focus")).toEqual({
			ok: false,
			error: "unsupported_signal",
		});
		expect(ipc.invoke(INSIGHTS_TEST_CHANNEL, undefined)).toEqual({
			ok: false,
			error: "unsupported_signal",
		});
		expect(seam.signal).not.toHaveBeenCalled(); // no collector input from a rejected signal
	});
});
