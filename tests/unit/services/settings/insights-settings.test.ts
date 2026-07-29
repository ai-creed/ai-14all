import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsService } from "../../../../services/settings/settings-service.js";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../../shared/models/persisted-settings.js";
import {
	isInsightsCaptureEnabled,
	UsageTelemetrySettingsSchema,
} from "../../../../shared/models/persisted-workspace-state.js";

const dirs: string[] = [];
const service = () => {
	const d = mkdtempSync(join(tmpdir(), "ins-set-"));
	dirs.push(d);
	return new SettingsService(join(d, "settings.json"), join(d, "legacy.json"));
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const t = (over = {}) => ({
	enabled: true,
	includeUntracked: false,
	chipRange: "week" as const,
	insights: { enabled: true, noticeShown: false },
	...over,
});

describe("insights settings", () => {
	it("defaults insights on across schema, DEFAULT_PERSISTED_SETTINGS, and a fresh service read", async () => {
		expect(UsageTelemetrySettingsSchema.parse({}).insights).toEqual({
			enabled: true,
			noticeShown: false,
		});
		expect(DEFAULT_PERSISTED_SETTINGS.usageTelemetry.insights).toEqual({
			enabled: true,
			noticeShown: false,
		}); // outer default literal
		const { settings } = await service().readState(); // first-run seed writes the file
		expect(settings.usageTelemetry.insights).toEqual({
			enabled: true,
			noticeShown: false,
		});
	});

	it("isInsightsCaptureEnabled honors the master kill (either toggle false → false)", () => {
		expect(isInsightsCaptureEnabled(t())).toBe(true);
		expect(isInsightsCaptureEnabled(t({ enabled: false }))).toBe(false); // global opt-out wins
		expect(
			isInsightsCaptureEnabled(
				t({ insights: { enabled: false, noticeShown: false } }),
			),
		).toBe(false);
	});

	it("the REAL SettingsService.writeState deep-merges insights, preserving noticeShown", async () => {
		const s = service();
		await s.readState(); // seed defaults into the temp file
		await s.writeState({ usageTelemetry: { insights: { noticeShown: true } } });
		await s.writeState({ usageTelemetry: { insights: { enabled: false } } }); // partial — must NOT reset noticeShown
		const { settings } = await s.readState(); // reload from disk
		expect(settings.usageTelemetry.insights).toEqual({
			enabled: false,
			noticeShown: true,
		});
		expect(settings.usageTelemetry.enabled).toBe(true); // sibling untouched
	});
});
