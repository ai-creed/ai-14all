import type { IpcMain } from "electron";
import { isInsightsCaptureEnabled } from "../../shared/models/persisted-workspace-state.js";
import type { PersistedSettingsV1 } from "../../shared/models/persisted-settings.js";
import type { SettingsService } from "../../services/settings/settings-service.js";
import {
	INSIGHTS_TEST_CHANNEL,
	INSIGHTS_TEST_SIGNALS,
	isInsightsTestSeamEnabled,
	type InsightsTestSignal,
} from "../../shared/models/insights-test-seam.js";
import type { InsightsHost } from "./services/insights-host.js";

export interface InsightsTestSeam {
	signal(
		type: InsightsTestSignal,
		arg: { atMs?: number; idleSeconds: number },
	): void;
	/**
	 * Arm a one-shot crash that fires immediately before the next producer post,
	 * so the next span is deterministically unacked and must arrive via the real
	 * `exit` handler's re-fork + outbox replay.
	 */
	crashWorker(): void;
}

// Registers the three renderer-facing insights IPC handlers.
//
// insights:setEnabled deliberately routes through the `setInsightsEnabled`
// closure (see makeSetInsightsEnabled) rather than calling host.setEnabled
// directly: the renderer boolean is a REQUEST to persist the sub-setting, from
// which effective consent is then DERIVED server-side (§7.2 master kill). The
// raw boolean must never reach the host, or a renderer could force capture on
// while global telemetry is opted out.
// Coerce a renderer-supplied range to a trusted { fromMs, toMs } of finite
// numbers. The value crosses the IPC boundary untyped, so any non-finite field
// (missing, string, NaN, Infinity) collapses to 0 rather than reaching the
// worker's SQL bind params.
function normalizeRange(range: unknown): { fromMs: number; toMs: number } {
	const r = (range ?? {}) as { fromMs?: unknown; toMs?: unknown };
	const num = (v: unknown): number =>
		typeof v === "number" && Number.isFinite(v) ? v : 0;
	return { fromMs: num(r.fromMs), toMs: num(r.toMs) };
}

export function registerInsightsIpc(
	ipcMain: Pick<IpcMain, "handle">,
	host: Pick<
		InsightsHost,
		"deleteAll" | "ackNotice" | "isNoticePending" | "query" | "queryAppTime"
	>,
	setInsightsEnabled: (enabled: boolean) => void | Promise<void>,
	testSeam?: { seam: InsightsTestSeam; env: { AI14ALL_E2E?: string } },
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
	// Pull-on-mount recovery: the renderer asks whether the one-time first-capture
	// notice is still pending, so a shell that mounted AFTER the boot-time push
	// (which reaches no listener) can recover it. See InsightsHost.isNoticePending.
	ipcMain.handle("insights:noticePending", () => host.isNoticePending());
	// Typed read contract (spec §10.4 getWhisperRuns): the renderer-facing entry
	// point to the correlated worker query. The range is renderer-supplied, so it
	// is normalized before reaching the host/worker.
	ipcMain.handle("insights:query", (_event, range: unknown) =>
		host.query(normalizeRange(range)),
	);
	ipcMain.handle("insights:queryAppTime", (_event, range: unknown) =>
		host.queryAppTime(normalizeRange(range)),
	);

	// Test seam: registered ONLY under the E2E flag, and then it accepts only the
	// enumerated signals — anything else is rejected without touching the
	// collector (spec §4 security contract).
	if (!testSeam || !isInsightsTestSeamEnabled(testSeam.env)) return;
	const allowed = new Set<string>(INSIGHTS_TEST_SIGNALS);
	ipcMain.handle(INSIGHTS_TEST_CHANNEL, (_event, payload: unknown) => {
		const p = (payload ?? {}) as {
			type?: unknown;
			atMs?: unknown;
			idleSeconds?: unknown;
		};
		const type = typeof p.type === "string" ? p.type : "";
		if (type === "crashWorker") {
			testSeam.seam.crashWorker();
			return { ok: true };
		}
		if (!allowed.has(type)) return { ok: false, error: "unsupported_signal" };
		const num = (v: unknown): number | undefined =>
			typeof v === "number" && Number.isFinite(v) ? v : undefined;
		testSeam.seam.signal(type as InsightsTestSignal, {
			atMs: num(p.atMs),
			idleSeconds: num(p.idleSeconds) ?? 0,
		});
		return { ok: true };
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
