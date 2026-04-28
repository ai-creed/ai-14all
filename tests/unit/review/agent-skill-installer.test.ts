// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execMock = vi.fn();
vi.mock("node:child_process", () => ({
	execFile: (
		cmd: string,
		args: string[],
		opts: unknown,
		cb?: (...rest: unknown[]) => void,
	) => {
		const callback = (typeof opts === "function" ? opts : cb) as (
			...rest: unknown[]
		) => void;
		execMock(cmd, args, callback);
	},
}));

import { AgentSkillInstaller } from "../../../services/review/agent-skill-installer/index.js";

describe("AgentSkillInstaller (detection + override)", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "installer-"));
		execMock.mockReset();
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	// Restrict fs.access to paths inside `dir` only, so absolute fixed-candidate
	// paths (e.g. /opt/homebrew/bin/claude) don't match on dev machines.
	function accessInsideDir(d: string) {
		return async (p: string) => {
			if (!p.startsWith(d)) throw new Error("ENOENT");
			const { access: realAccess } = await import("node:fs/promises");
			return realAccess(p);
		};
	}

	function newInstaller() {
		return new AgentSkillInstaller({
			home: dir,
			resourcesPath: join(dir, "resources"),
			userDataPath: dir,
			getMcpUrl: () => "http://127.0.0.1:9999",
			_access: accessInsideDir(dir),
		});
	}

	it("listProviders surfaces cliPath and cliSource for an override", async () => {
		const cliBin = join(dir, "claude-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const installer = newInstaller();
		await installer.setOverride("claude-code", cliBin);
		const result = await installer.listProviders();
		const claude = result.providers.find((p) => p.id === "claude-code")!;
		expect(claude.cliAvailable).toBe(true);
		expect(claude.cliPath).toBe(cliBin);
		expect(claude.cliSource).toBe("override");
	});

	it("install passes the override cliPath to execFile", async () => {
		const cliBin = join(dir, "claude-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		// stub bundled skill
		await mkdir(join(dir, "resources", "agent-skills", "ai-14all-fix-review"), {
			recursive: true,
		});
		await writeFile(
			join(dir, "resources", "agent-skills", "ai-14all-fix-review", "SKILL.md"),
			"skill body",
			"utf-8",
		);
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const installer = newInstaller();
		await installer.setOverride("claude-code", cliBin);
		const res = await installer.install(["claude-code"]);
		expect(res[0].ok).toBe(true);
		const cmds = execMock.mock.calls.map((c) => c[0]);
		expect(cmds).toContain(cliBin);
	});

	it("install fails for a provider when detection returns null", async () => {
		// no override, no PATH (`which` rejects), no fixed candidates, no shell
		execMock.mockImplementation((_cmd, _args, cb) => cb(new Error("not found")));
		const installer = newInstaller();
		const res = await installer.install(["claude-code"]);
		expect(res[0].ok).toBe(false);
		expect(res[0].message).toMatch(/claude CLI is not available/i);
	});

	it("setOverride rejects directories", async () => {
		const installer = newInstaller();
		await expect(
			installer.setOverride("claude-code", dir),
		).rejects.toThrow(/not a regular file/i);
	});

	it("setOverride rejects missing paths", async () => {
		const installer = newInstaller();
		await expect(
			installer.setOverride("claude-code", join(dir, "no-such-file")),
		).rejects.toThrow(/does not exist/i);
	});
});
