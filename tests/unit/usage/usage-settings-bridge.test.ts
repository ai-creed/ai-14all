import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsService } from "../../../services/settings/settings-service.js";
import { createUsageSettingsBridge } from "../../../electron/main/services/usage-settings-bridge.js";

function makePaths(): { settingsPath: string; legacyPath: string } {
	const dir = mkdtempSync(join(tmpdir(), "settings-bridge-"));
	return {
		settingsPath: join(dir, "settings.json"),
		legacyPath: join(dir, "workspace-state.json"),
	};
}

describe("usage settings bridge (real async persistence via SettingsService)", () => {
	it("persists chipRange to disk so the next run seeds Month", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const run1 = await createUsageSettingsBridge(
			new SettingsService(settingsPath, legacyPath),
		);
		expect(run1.settings.chipRange).toBe("week"); // default on first run (missing file)
		await run1.persist({ chipRange: "month" }); // awaitable async write
		// next run: a fresh service + bridge over the same file
		const run2 = await createUsageSettingsBridge(
			new SettingsService(settingsPath, legacyPath),
		);
		expect(run2.settings.chipRange).toBe("month");
	});

	it("a chipRange write preserves the other settings fields", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		await svc.readState();
		await svc.writeState({ theme: "warm" });
		const bridge = await createUsageSettingsBridge(svc);
		await bridge.persist({ chipRange: "month" });
		const after = await svc.readState();
		expect(after.settings.usageTelemetry.chipRange).toBe("month");
		expect(after.settings.theme).toBe("warm"); // didn't clobber unrelated settings
	});

	it("a partial usageTelemetry persist preserves the other usageTelemetry fields", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		await svc.readState();
		await svc.writeState({
			usageTelemetry: {
				enabled: true,
				includeUntracked: true,
				chipRange: "month",
			},
		});
		const bridge = await createUsageSettingsBridge(svc);
		await bridge.persist({ enabled: false });
		const after = await svc.readState();
		expect(after.settings.usageTelemetry).toEqual({
			enabled: false,
			includeUntracked: true,
			chipRange: "month",
		});
	});
});
