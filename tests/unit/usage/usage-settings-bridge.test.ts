import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SettingsService } from "../../../services/settings/settings-service.js";
import { createUsageSettingsBridge } from "../../../electron/main/services/usage-settings-bridge.js";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings.js";

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

	// Direction 2 of the settings:write <-> usage bridge seam: the bridge is a
	// second writer to SettingsService (used by the usage popover's chipRange /
	// includeUntracked toggles) that bypasses the settings:write IPC handler's
	// own settings:changed broadcast entirely. Without `onPersisted`, the
	// Settings dialog's renderer state goes stale until restart.
	it("a bridge persist invokes onPersisted exactly once with the merged settings", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		const onPersisted = vi.fn();
		const bridge = await createUsageSettingsBridge(svc, onPersisted);

		await bridge.persist({ chipRange: "month" });

		expect(onPersisted).toHaveBeenCalledTimes(1);
		expect(onPersisted).toHaveBeenCalledWith(
			expect.objectContaining({
				usageTelemetry: expect.objectContaining({ chipRange: "month" }),
			}),
		);
	});

	it("does not loop back into another persist when onPersisted is called", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		const writeStateSpy = vi.spyOn(svc, "writeState");
		// A pathological consumer that itself tries to react to the broadcast —
		// the bridge must not re-enter persist()/writeState() as a result of
		// firing onPersisted, no matter what the callback does.
		const onPersisted = vi.fn();
		const bridge = await createUsageSettingsBridge(svc, onPersisted);

		await bridge.persist({ includeUntracked: true });

		expect(writeStateSpy).toHaveBeenCalledTimes(1);
		expect(onPersisted).toHaveBeenCalledTimes(1);
	});

	it("omitting onPersisted still persists normally (backward compatible)", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		const bridge = await createUsageSettingsBridge(svc);

		await expect(
			bridge.persist({ chipRange: "month" }),
		).resolves.toBeUndefined();
		expect(bridge.settings.chipRange).toBe("month");
	});

	// The bridge must hand writeState() the *bare* patch and let writeState()'s
	// deep-merge own the merge, rather than pre-merging the patch into a possibly
	// stale in-memory snapshot and writing the whole sub-object back.
	it("persist writes the bare patch (not the full snapshot) so writeState's deep-merge owns the merge", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		await svc.writeState({
			usageTelemetry: {
				enabled: true,
				includeUntracked: true,
				chipRange: "week",
			},
		});
		const bridge = await createUsageSettingsBridge(svc);
		const writeStateSpy = vi.spyOn(svc, "writeState");

		await bridge.persist({ chipRange: "month" });

		expect(writeStateSpy).toHaveBeenCalledTimes(1);
		expect(writeStateSpy).toHaveBeenCalledWith({
			usageTelemetry: { chipRange: "month" },
		});
	});

	// Regression for the pre-existing stale-snapshot write-back: an external
	// writer (the settings:write IPC handler) flips a field on disk while the
	// bridge's in-memory snapshot still holds the old value. A later popover
	// click must not resurrect the stale value, and the snapshot must end up
	// refreshed from writeState()'s merged result.
	it("does not resurrect a stale snapshot value after an external write", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		const bridge = await createUsageSettingsBridge(svc);
		expect(bridge.settings.enabled).toBe(true); // fresh snapshot from defaults

		// External writer flips `enabled` on disk; bridge snapshot is now stale.
		await svc.writeState({ usageTelemetry: { enabled: false } });

		// Later popover chipRange click funnels through the bridge.
		await bridge.persist({ chipRange: "month" });

		const after = await svc.readState();
		expect(after.settings.usageTelemetry).toEqual({
			enabled: false, // NOT clobbered back to the stale `true`
			includeUntracked: false,
			chipRange: "month",
		});
		expect(bridge.settings.enabled).toBe(false); // snapshot refreshed from merged
	});

	it("refresh() updates the in-memory snapshot from an external merged settings write", async () => {
		const { settingsPath, legacyPath } = makePaths();
		const svc = new SettingsService(settingsPath, legacyPath);
		const bridge = await createUsageSettingsBridge(svc);
		expect(bridge.settings.chipRange).toBe("week");

		bridge.refresh({
			...DEFAULT_PERSISTED_SETTINGS,
			usageTelemetry: {
				enabled: true,
				includeUntracked: true,
				chipRange: "month",
			},
		});

		expect(bridge.settings).toEqual({
			enabled: true,
			includeUntracked: true,
			chipRange: "month",
		});
	});
});
