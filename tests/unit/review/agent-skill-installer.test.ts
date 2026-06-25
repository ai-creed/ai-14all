// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	mkdtemp,
	rm,
	writeFile,
	chmod,
	mkdir,
	readFile,
} from "node:fs/promises";
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
import { BUNDLED_SKILL_IDS } from "../../../services/review/agent-skill-installer/skill-asset.js";

describe("AgentSkillInstaller (detection + override)", () => {
	let dir: string;
	let prevXdg: string | undefined;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "installer-"));
		// Pin ezio's config root inside the temp dir so the XDG-based resolution is
		// deterministic regardless of the dev machine's environment.
		prevXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(dir, "xdg");
		execMock.mockReset();
	});
	afterEach(async () => {
		if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = prevXdg;
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

	// Stub every bundled skill asset under the resources dir so loadBundledSkills
	// resolves both skills from the canonical assets/agent-skills layout.
	async function stubBundledSkills() {
		for (const id of BUNDLED_SKILL_IDS) {
			await mkdir(join(dir, "resources", "agent-skills", id), {
				recursive: true,
			});
			await writeFile(
				join(dir, "resources", "agent-skills", id, "SKILL.md"),
				`body of ${id}`,
				"utf-8",
			);
		}
	}

	it("install passes the override cliPath to execFile", async () => {
		const cliBin = join(dir, "claude-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		await stubBundledSkills();
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

	it("install writes BOTH bundled skills for claude-code", async () => {
		const cliBin = join(dir, "claude-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		await stubBundledSkills();
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const installer = newInstaller();
		await installer.setOverride("claude-code", cliBin);
		const res = await installer.install(["claude-code"]);
		expect(res[0].ok).toBe(true);
		const fixReview = await readFile(
			join(dir, ".claude", "skills", "ai-14all-fix-review", "SKILL.md"),
			"utf-8",
		);
		const sessionStatus = await readFile(
			join(dir, ".claude", "skills", "ai-14all-session-status", "SKILL.md"),
			"utf-8",
		);
		expect(fixReview).toBe("body of ai-14all-fix-review");
		expect(sessionStatus).toBe("body of ai-14all-session-status");
	});

	it("install writes BOTH bundled skills for codex", async () => {
		const cliBin = join(dir, "codex-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		await stubBundledSkills();
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const installer = newInstaller();
		await installer.setOverride("codex", cliBin);
		const res = await installer.install(["codex"]);
		expect(res[0].ok).toBe(true);
		const fixReview = await readFile(
			join(dir, ".codex", "skills", "ai-14all-fix-review", "SKILL.md"),
			"utf-8",
		);
		const sessionStatus = await readFile(
			join(dir, ".codex", "skills", "ai-14all-session-status", "SKILL.md"),
			"utf-8",
		);
		expect(fixReview).toBe("body of ai-14all-fix-review");
		expect(sessionStatus).toBe("body of ai-14all-session-status");
	});

	it("listProviders includes an ezio row reflecting CLI availability", async () => {
		const cliBin = join(dir, "ai-ezio-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const installer = newInstaller();
		await installer.setOverride("ezio", cliBin);
		const result = await installer.listProviders();
		const ezio = result.providers.find((p) => p.id === "ezio");
		expect(ezio).toBeDefined();
		expect(ezio!.displayName).toBe("ezio");
		expect(ezio!.cliAvailable).toBe(true);
		expect(ezio!.cliPath).toBe(cliBin);
	});

	it("install registers the mcp-remote bridge + writes skills for ezio", async () => {
		const cliBin = join(dir, "ai-ezio-bin");
		await writeFile(cliBin, "#!/bin/sh\n", "utf-8");
		await chmod(cliBin, 0o755);
		await stubBundledSkills();
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(null, { stdout: "", stderr: "" }),
		);
		const installer = newInstaller();
		await installer.setOverride("ezio", cliBin);
		const res = await installer.install(["ezio"]);
		expect(res[0].ok).toBe(true);
		// ezio registration is a direct file write (no CLI), so getMcpUrl()'s URL
		// is wrapped in the mcp-remote stdio bridge inside ezio's mcp.json.
		const ezioCfg = join(process.env.XDG_CONFIG_HOME!, "ai-ezio");
		const mcp = JSON.parse(await readFile(join(ezioCfg, "mcp.json"), "utf-8"));
		expect(mcp.mcpServers["ai-14all"]).toEqual({
			command: "npx",
			args: ["-y", "mcp-remote", "http://127.0.0.1:9999"],
		});
		const skill = await readFile(
			join(ezioCfg, "skills", "ai-14all-fix-review", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toBe("body of ai-14all-fix-review");
	});

	it("install fails for a provider when detection returns null", async () => {
		// no override, no PATH (`which` rejects), no fixed candidates, no shell
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(new Error("not found")),
		);
		const installer = newInstaller();
		const res = await installer.install(["claude-code"]);
		expect(res[0].ok).toBe(false);
		expect(res[0].message).toMatch(/claude CLI is not available/i);
	});

	it("uninstall succeeds even when detection returns null", async () => {
		// CLI unavailable but skill directory removal should still proceed.
		// execMock will reject for `which`, `$SHELL -ilc`, and `claude mcp remove`;
		// the provider skips `mcp remove` when isCliAvailable() returns false, so
		// the only execMock calls are the detection probes — all rejected → null detection.
		execMock.mockImplementation((_cmd, _args, cb) =>
			cb(new Error("not found")),
		);
		const installer = newInstaller();
		const res = await installer.uninstall(["claude-code"]);
		expect(res[0].ok).toBe(true);
		expect(res[0].message).toBeNull();
	});

	it("setOverride rejects directories", async () => {
		const installer = newInstaller();
		await expect(installer.setOverride("claude-code", dir)).rejects.toThrow(
			/not a regular file/i,
		);
	});

	it("setOverride rejects missing paths", async () => {
		const installer = newInstaller();
		await expect(
			installer.setOverride("claude-code", join(dir, "no-such-file")),
		).rejects.toThrow(/does not exist/i);
	});
});
