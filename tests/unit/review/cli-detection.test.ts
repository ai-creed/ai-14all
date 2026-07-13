// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectCliPath,
	type DetectDeps,
} from "../../../services/review/agent-skill-installer/cli-detection.js";

async function makeExec(dir: string, name: string): Promise<string> {
	const p = join(dir, name);
	await writeFile(p, "#!/bin/sh\necho ok\n", "utf-8");
	await chmod(p, 0o755);
	return p;
}

function defaultDeps(home: string): DetectDeps {
	return {
		home,
		platform: "darwin" as NodeJS.Platform,
		shell: "/bin/zsh",
		override: null as string | null,
		exec: vi.fn(async () => ({ stdout: "" })),
		access: vi.fn(async (_p: string) => {
			throw new Error("ENOENT");
		}),
	};
}

describe("detectCliPath", () => {
	let home: string;
	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "detect-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	it("returns null when nothing is found", async () => {
		const deps = defaultDeps(home);
		const result = await detectCliPath("claude", deps);
		expect(result).toBeNull();
	});

	it("returns override when override path exists", async () => {
		const path = await makeExec(home, "claude-bin");
		const deps = defaultDeps(home);
		deps.override = path;
		deps.access = async (p: string) => {
			if (p === path) return;
			throw new Error("ENOENT");
		};
		const result = await detectCliPath("claude", deps);
		expect(result).toEqual({ cliPath: path, source: "override" });
	});

	it("falls through when override path does not exist", async () => {
		const deps = defaultDeps(home);
		deps.override = "/nope/claude";
		// `which` returns success
		deps.exec = vi.fn(async (_file: string, _args: string[]) => ({
			stdout: "/usr/local/bin/claude\n",
		}));
		deps.access = async (p: string) => {
			if (p === "/nope/claude") throw new Error("ENOENT");
		};
		const result = await detectCliPath("claude", deps);
		expect(result).toEqual({
			cliPath: "/usr/local/bin/claude",
			source: "path",
		});
	});

	it("returns PATH detection when `which` succeeds", async () => {
		const deps = defaultDeps(home);
		deps.exec = vi.fn(async (file: string) => {
			if (file === "which") return { stdout: "/opt/homebrew/bin/claude\n" };
			throw new Error("not found");
		});
		const result = await detectCliPath("claude", deps);
		expect(result).toEqual({
			cliPath: "/opt/homebrew/bin/claude",
			source: "path",
		});
	});

	it("returns first existing fixed candidate when PATH misses (claude-local)", async () => {
		await mkdir(join(home, ".claude", "local"), { recursive: true });
		const path = await makeExec(join(home, ".claude", "local"), "claude");
		const deps = defaultDeps(home);
		deps.exec = vi.fn(async (file: string) => {
			if (file === "which") throw new Error("not found");
			// shell probe returns nothing
			return { stdout: "" };
		});
		// real fs access for fixed candidates
		const { access: realAccess } = await import("node:fs/promises");
		deps.access = realAccess as DetectDeps["access"];
		const result = await detectCliPath("claude", deps);
		expect(result).toEqual({ cliPath: path, source: "fixed" });
	});

	it("uses login-shell probe when override/PATH/fixed all miss", async () => {
		const probed = await makeExec(home, "claude-from-shell");
		const deps = defaultDeps(home);
		deps.exec = vi.fn(async (file: string, args: string[]) => {
			if (file === "which") throw new Error("not found");
			if (file === "/bin/zsh" && args[0] === "-ilc") {
				return { stdout: `${probed}\n` };
			}
			return { stdout: "" };
		});
		// Mock access to fail on all fixed candidates but succeed on shell result
		deps.access = async (p: string) => {
			if (p === probed) return;
			throw new Error("ENOENT");
		};
		const result = await detectCliPath("claude", deps);
		expect(result).toEqual({ cliPath: probed, source: "shell" });
	});

	it("detects the ai-ezio binary from a fixed candidate when PATH misses", async () => {
		// ezio's CLI is `ai-ezio`; detection must know its fixed install locations
		// so the "Locate ezio CLI…" / auto-detect path works like claude/codex.
		const path = join(home, ".local", "bin", "ai-ezio");
		const deps = defaultDeps(home);
		deps.exec = vi.fn(async (file: string) => {
			if (file === "which") throw new Error("not found");
			return { stdout: "" }; // shell probe yields nothing
		});
		deps.access = async (p: string) => {
			if (p === path) return;
			throw new Error("ENOENT");
		};
		const result = await detectCliPath("ai-ezio", deps);
		expect(result).toEqual({ cliPath: path, source: "fixed" });
	});

	it("pathOnly skips fixed and shell tiers even when a fixed candidate exists", async () => {
		// E2E isolation seam: with PATH detection failing, a fixed candidate that
		// WOULD be accepted must not be reached when pathOnly is set — otherwise a
		// stripped-PATH e2e run on a host with a real CLI at a fixed path would
		// detect (and later exec) the real binary.
		const fixedCandidate = join(home, ".claude", "local", "claude");
		const deps = defaultDeps(home);
		deps.pathOnly = true;
		deps.exec = vi.fn(async (file: string) => {
			if (file === "which") throw new Error("not found");
			throw new Error("should not reach shell tier");
		});
		deps.access = async (p: string) => {
			if (p === fixedCandidate) return; // would match Tier 3 if reached
			throw new Error("ENOENT");
		};
		const result = await detectCliPath("claude", deps);
		expect(result).toBeNull();
	});

	it("skips fixed and shell tiers on win32", async () => {
		const deps = defaultDeps(home);
		deps.platform = "win32";
		deps.exec = vi.fn(async (file: string) => {
			if (file === "where") throw new Error("not found");
			throw new Error("should not reach shell tier");
		});
		const result = await detectCliPath("claude", deps);
		expect(result).toBeNull();
	});

	it("uses `where` instead of `which` on win32", async () => {
		const deps = defaultDeps(home);
		deps.platform = "win32";
		const calls: string[] = [];
		deps.exec = vi.fn(async (file: string) => {
			calls.push(file);
			if (file === "where") return { stdout: "C:\\bin\\claude.exe\r\n" };
			throw new Error("not found");
		});
		const result = await detectCliPath("claude", deps);
		expect(calls[0]).toBe("where");
		expect(result).toEqual({
			cliPath: "C:\\bin\\claude.exe",
			source: "path",
		});
	});
});
