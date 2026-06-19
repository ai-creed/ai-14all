// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("node:fs");

import { existsSync } from "node:fs";

const existsSyncMock = vi.mocked(existsSync);

afterEach(() => {
	vi.resetAllMocks();
	vi.unstubAllEnvs();
});

async function freshGetGitBinaryPath(): Promise<
	(typeof import("../../../../services/git/git-binary.js"))["getGitBinaryPath"]
> {
	vi.resetModules();
	const mod = await import("../../../../services/git/git-binary.js");
	return mod.getGitBinaryPath;
}

describe("getGitBinaryPath", () => {
	it("returns AI14ALL_GIT_PATH env var when set", async () => {
		vi.stubEnv("AI14ALL_GIT_PATH", "/custom/git");
		const getGitBinaryPath = await freshGetGitBinaryPath();
		expect(getGitBinaryPath()).toBe("/custom/git");
	});

	it("returns /usr/bin/git on macOS when it exists", async () => {
		vi.stubEnv("AI14ALL_GIT_PATH", "");
		vi.stubEnv("VITEST_PLATFORM", "darwin");
		existsSyncMock.mockImplementation((p) => p === "/usr/bin/git");
		const getGitBinaryPath = await freshGetGitBinaryPath();
		// Only meaningful on darwin; skip on other platforms
		if (process.platform !== "darwin") return;
		expect(getGitBinaryPath()).toBe("/usr/bin/git");
	});

	it("returns /opt/homebrew/bin/git on macOS when /usr/bin/git is absent", async () => {
		vi.stubEnv("AI14ALL_GIT_PATH", "");
		existsSyncMock.mockImplementation((p) => p === "/opt/homebrew/bin/git");
		const getGitBinaryPath = await freshGetGitBinaryPath();
		if (process.platform !== "darwin") return;
		expect(getGitBinaryPath()).toBe("/opt/homebrew/bin/git");
	});

	it("returns /usr/local/bin/git on macOS when only Intel Homebrew path exists", async () => {
		vi.stubEnv("AI14ALL_GIT_PATH", "");
		existsSyncMock.mockImplementation((p) => p === "/usr/local/bin/git");
		const getGitBinaryPath = await freshGetGitBinaryPath();
		if (process.platform !== "darwin") return;
		expect(getGitBinaryPath()).toBe("/usr/local/bin/git");
	});

	it("falls back to 'git' on macOS when no candidate path exists", async () => {
		vi.stubEnv("AI14ALL_GIT_PATH", "");
		existsSyncMock.mockReturnValue(false);
		const getGitBinaryPath = await freshGetGitBinaryPath();
		if (process.platform !== "darwin") return;
		expect(getGitBinaryPath()).toBe("git");
	});
});

describe("getGitBinaryPath on win32", () => {
	it("returns the Program Files Git path when it exists", async () => {
		const getGitBinaryPath = await freshGetGitBinaryPath();
		const gitExe = "C:\\Program Files\\Git\\cmd\\git.exe";
		expect(
			getGitBinaryPath({
				platform: "win32",
				env: {},
				existsSync: (p) => p === gitExe,
			}),
		).toBe(gitExe);
	});

	it("returns the LOCALAPPDATA Git path when Program Files is absent", async () => {
		const getGitBinaryPath = await freshGetGitBinaryPath();
		const gitExe = "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\cmd\\git.exe";
		expect(
			getGitBinaryPath({
				platform: "win32",
				env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
				existsSync: (p) => p === gitExe,
			}),
		).toBe(gitExe);
	});

	it("falls back to git.exe (PATH lookup) when no candidate exists", async () => {
		const getGitBinaryPath = await freshGetGitBinaryPath();
		expect(
			getGitBinaryPath({
				platform: "win32",
				env: {},
				existsSync: () => false,
			}),
		).toBe("git.exe");
	});

	it("honors AI14ALL_GIT_PATH on win32 too", async () => {
		const getGitBinaryPath = await freshGetGitBinaryPath();
		expect(
			getGitBinaryPath({
				platform: "win32",
				env: { AI14ALL_GIT_PATH: "D:\\git\\git.exe" },
				existsSync: () => false,
			}),
		).toBe("D:\\git\\git.exe");
	});
});
