import { describe, expect, it, vi } from "vitest";
import {
	decideUpdateAction,
	startUpdateService,
} from "../../../electron/main/services/update-service.js";
import type { UpdaterLike } from "../../../electron/main/services/update-service.js";

const PUBLISHED = `version: 0.1.1
releaseDate: '2026-05-01T12:00:00.000Z'
path: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg
sha512: ZG1nLXNoYQ==
files:
  - url: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg
    sha512: ZG1nLXNoYQ==
    size: 1000
`;

describe("decideUpdateAction", () => {
	it("notifies when the manifest version is newer", () => {
		const result = decideUpdateAction({
			currentVersion: "0.1.0",
			manifestYaml: PUBLISHED,
		});
		expect(result.kind).toBe("notify");
		if (result.kind !== "notify") return;
		expect(result.info.version).toBe("0.1.1");
		expect(result.info.url).toBe(
			"https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg",
		);
	});

	it("stays silent when the manifest version equals current", () => {
		const result = decideUpdateAction({
			currentVersion: "0.1.1",
			manifestYaml: PUBLISHED,
		});
		expect(result.kind).toBe("silent");
	});

	it("stays silent when the manifest is invalid", () => {
		const broken = PUBLISHED.replace("version: 0.1.1", "version: 0.1.1-beta.1");
		const result = decideUpdateAction({
			currentVersion: "0.1.0",
			manifestYaml: broken,
		});
		expect(result.kind).toBe("silent");
	});

	it("stays silent when the current version is non-stable", () => {
		const result = decideUpdateAction({
			currentVersion: "0.1.0-beta.14",
			manifestYaml: PUBLISHED,
		});
		expect(result.kind).toBe("silent");
	});
});

function makeFakeUpdater() {
	const listeners: Record<string, (arg: unknown) => void> = {};
	const updater: UpdaterLike = {
		autoDownload: false,
		autoInstallOnAppQuit: false,
		on(event, listener) {
			listeners[event] = listener as (arg: unknown) => void;
			return updater;
		},
		checkForUpdates: vi.fn().mockResolvedValue(undefined),
		quitAndInstall: vi.fn(),
	};
	return { updater, emit: (e: string, arg?: unknown) => listeners[e]?.(arg) };
}

const silentLogger = { warn: () => {}, info: () => {} };

describe("startUpdateService", () => {
	it("maps update-downloaded to the update:downloaded IPC", () => {
		const { updater, emit } = makeFakeUpdater();
		const send = vi.fn();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send,
			logger: silentLogger,
		});
		emit("update-downloaded", { version: "1.3.0", releaseDate: "2026-05-27" });
		expect(send).toHaveBeenCalledWith("update:downloaded", {
			version: "1.3.0",
			url: "",
			releaseDate: "2026-05-27",
		});
	});

	it("maps update-available to the update:available IPC", () => {
		const { updater, emit } = makeFakeUpdater();
		const send = vi.fn();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send,
			logger: silentLogger,
		});
		emit("update-available", { version: "1.3.0", releaseDate: "2026-05-27" });
		expect(send).toHaveBeenCalledWith(
			"update:available",
			expect.objectContaining({ version: "1.3.0" }),
		);
	});

	it("fires update:error and logs, without any user-facing banner, on error", () => {
		const { updater, emit } = makeFakeUpdater();
		const send = vi.fn();
		const warn = vi.fn();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send,
			logger: { warn, info: () => {} },
		});
		emit("error", new Error("boom"));
		expect(warn).toHaveBeenCalled();
		// Spec §2: error → update:error IPC (renderer logs/diagnoses but stays silent).
		expect(send).toHaveBeenCalledWith("update:error", "boom");
		// No user-facing banner channel is emitted for an error.
		const channels = send.mock.calls.map((c) => c[0]);
		expect(channels).not.toContain("update:available");
		expect(channels).not.toContain("update:downloaded");
	});

	it("does not initialize the updater for a non-stable (beta) version", () => {
		const { updater } = makeFakeUpdater();
		const send = vi.fn();
		startUpdateService({
			updater,
			currentVersion: "1.2.3-beta.1",
			isPackaged: true,
			send,
			logger: silentLogger,
		});
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
	});

	it("does not initialize the updater in dev (isPackaged false)", () => {
		const { updater } = makeFakeUpdater();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: false,
			send: vi.fn(),
			logger: silentLogger,
		});
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
	});

	it("installUpdate calls quitAndInstall when stable+packaged", () => {
		const { updater } = makeFakeUpdater();
		const handle = startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send: vi.fn(),
			logger: silentLogger,
		});
		handle.installUpdate();
		expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
	});

	it("does not initialize the updater on Windows arm64 (manual-only)", () => {
		const { updater } = makeFakeUpdater();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send: vi.fn(),
			logger: silentLogger,
			platform: "win32",
			arch: "arm64",
		});
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
	});

	it("initializes the updater on Windows x64 (auto-update channel)", () => {
		const { updater } = makeFakeUpdater();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send: vi.fn(),
			logger: silentLogger,
			platform: "win32",
			arch: "x64",
		});
		expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
	});

	it("initializes the updater on macOS arm64 (Apple Silicon unaffected)", () => {
		const { updater } = makeFakeUpdater();
		startUpdateService({
			updater,
			currentVersion: "1.2.3",
			isPackaged: true,
			send: vi.fn(),
			logger: silentLogger,
			platform: "darwin",
			arch: "arm64",
		});
		expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
	});
});
