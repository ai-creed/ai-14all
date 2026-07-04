// @vitest-environment node
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsService } from "../../../../services/settings/settings-service.js";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../../shared/models/persisted-settings.js";

let dir: string;
let settingsPath: string;
let legacyPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ofa-settings-"));
	settingsPath = join(dir, "settings.json");
	legacyPath = join(dir, "workspace-state.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SettingsService.readState", () => {
	it("missing file → defaults, firstRun: true, file created", async () => {
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = await svc.readState();
		expect(firstRun).toBe(true);
		expect(settings).toEqual(DEFAULT_PERSISTED_SETTINGS);
		expect(JSON.parse(readFileSync(settingsPath, "utf8")).version).toBe(1);
	});

	it("missing file + legacy workspace-state → seeds restorePreference and usageTelemetry", async () => {
		writeFileSync(
			legacyPath,
			JSON.stringify({
				version: 2,
				restorePreference: "alwaysRestore",
				activeWorkspaceId: null,
				workspaceOrder: [],
				workspaces: [],
				usageTelemetry: { enabled: false, includeUntracked: true, chipRange: "month" },
			}),
		);
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = await svc.readState();
		expect(firstRun).toBe(true);
		expect(settings.restorePreference).toBe("alwaysRestore");
		expect(settings.usageTelemetry).toEqual({
			enabled: false,
			includeUntracked: true,
			chipRange: "month",
		});
	});

	it("corrupt JSON → overwritten with defaults, firstRun: false", async () => {
		writeFileSync(settingsPath, "{not json");
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = await svc.readState();
		expect(firstRun).toBe(false);
		expect(settings).toEqual(DEFAULT_PERSISTED_SETTINGS);
		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(DEFAULT_PERSISTED_SETTINGS);
	});

	it("newer schema → defaults served, file NOT overwritten", async () => {
		const future = JSON.stringify({ version: 99, mystery: true });
		writeFileSync(settingsPath, future);
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = await svc.readState();
		expect(firstRun).toBe(false);
		expect(settings).toEqual(DEFAULT_PERSISTED_SETTINGS);
		expect(readFileSync(settingsPath, "utf8")).toBe(future);
	});
});

describe("SettingsService.writeState", () => {
	it("merges a patch over current state and persists", async () => {
		const svc = new SettingsService(settingsPath, legacyPath);
		await svc.readState();
		const merged = await svc.writeState({ theme: "warm", terminalFontSize: 15 });
		expect(merged.theme).toBe("warm");
		expect(merged.terminalFontSize).toBe(15);
		expect(merged.agentResume).toBe("auto");
		expect(JSON.parse(readFileSync(settingsPath, "utf8")).theme).toBe("warm");
	});

	it("serializes overlapping writes (last submitted wins)", async () => {
		const svc = new SettingsService(settingsPath, legacyPath);
		await svc.readState();
		await Promise.all([
			svc.writeState({ theme: "dark" }),
			svc.writeState({ theme: "tui" }),
		]);
		expect(JSON.parse(readFileSync(settingsPath, "utf8")).theme).toBe("tui");
	});
});

// Mirrors the four async readState() cases above — readStateSync() backs the
// preload's synchronous settings:readSync IPC so settings.initial can be
// served before first paint, and must share identical parse/seed semantics.
describe("SettingsService.readStateSync", () => {
	it("missing file → defaults, firstRun: true, file created", () => {
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = svc.readStateSync();
		expect(firstRun).toBe(true);
		expect(settings).toEqual(DEFAULT_PERSISTED_SETTINGS);
		expect(JSON.parse(readFileSync(settingsPath, "utf8")).version).toBe(1);
	});

	it("missing file + legacy workspace-state → seeds restorePreference and usageTelemetry", () => {
		writeFileSync(
			legacyPath,
			JSON.stringify({
				version: 2,
				restorePreference: "alwaysRestore",
				activeWorkspaceId: null,
				workspaceOrder: [],
				workspaces: [],
				usageTelemetry: { enabled: false, includeUntracked: true, chipRange: "month" },
			}),
		);
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = svc.readStateSync();
		expect(firstRun).toBe(true);
		expect(settings.restorePreference).toBe("alwaysRestore");
		expect(settings.usageTelemetry).toEqual({
			enabled: false,
			includeUntracked: true,
			chipRange: "month",
		});
	});

	it("corrupt JSON → overwritten with defaults, firstRun: false", () => {
		writeFileSync(settingsPath, "{not json");
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = svc.readStateSync();
		expect(firstRun).toBe(false);
		expect(settings).toEqual(DEFAULT_PERSISTED_SETTINGS);
		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(DEFAULT_PERSISTED_SETTINGS);
	});

	it("newer schema → defaults served, file NOT overwritten", () => {
		const future = JSON.stringify({ version: 99, mystery: true });
		writeFileSync(settingsPath, future);
		const svc = new SettingsService(settingsPath, legacyPath);
		const { settings, firstRun } = svc.readStateSync();
		expect(firstRun).toBe(false);
		expect(settings).toEqual(DEFAULT_PERSISTED_SETTINGS);
		expect(readFileSync(settingsPath, "utf8")).toBe(future);
	});
});
