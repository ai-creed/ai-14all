import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	augmentGuiLaunchPath,
	mergePath,
	resolveLoginShellPath,
} from "../../../services/plugins/shell-path";

describe("mergePath", () => {
	it("adds the Homebrew/node dir that a Finder-launched app's bare PATH omits", () => {
		// The exact root cause: a Finder/Dock-launched app inherits only the bare
		// GUI PATH, which lacks /opt/homebrew/bin — so the `#!/usr/bin/env node`
		// whisper shebang can't find node and the probe reports "not installed".
		const guiPath = "/usr/bin:/bin:/usr/sbin:/sbin";
		const loginPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
		expect(mergePath(guiPath, loginPath).split(":")).toContain(
			"/opt/homebrew/bin",
		);
	});

	it("gives the login-shell PATH precedence so the app matches the terminal", () => {
		const guiPath = "/usr/bin:/bin";
		const loginPath = "/opt/homebrew/bin:/usr/bin:/bin";
		expect(mergePath(guiPath, loginPath)).toBe(
			"/opt/homebrew/bin:/usr/bin:/bin",
		);
	});

	it("leaves the base PATH unchanged when the shell PATH is null", () => {
		expect(mergePath("/usr/bin:/bin", null)).toBe("/usr/bin:/bin");
	});

	it("drops empty segments and never throws on undefined base", () => {
		expect(mergePath(undefined, "/opt/homebrew/bin::/usr/bin")).toBe(
			"/opt/homebrew/bin:/usr/bin",
		);
	});
});

let dir: string;

// A faithful login-shell stand-in: it honours `-ilc <command>` by eval-ing the
// command in `$2` (so the production marker-printf actually runs), optionally
// emitting rc-file noise first.
function writeFakeShell(body: string): string {
	dir = mkdtempSync(join(tmpdir(), "ofa-shellpath-"));
	const shell = join(dir, "fake-shell.sh");
	writeFileSync(shell, `#!/bin/sh\n${body}\n`, "utf8");
	chmodSync(shell, 0o755);
	return shell;
}

afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("resolveLoginShellPath", () => {
	it("captures the PATH a login shell exposes", async () => {
		const shell = writeFakeShell('eval "$2"');
		const result = await resolveLoginShellPath({
			shell,
			timeoutMs: 2000,
			env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
		});
		expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin");
	});

	it("uses an interactive login shell so PATH set in .zshrc is captured", async () => {
		// `.zshrc` (and `.bashrc`) is sourced only by INTERACTIVE shells; a bare
		// `-lc` login shell skips it, so `~/.local/bin` exported there is missing
		// from the repaired PATH. The fake shell exposes its PATH only when -i is
		// passed, reproducing that gap.
		const shell = writeFakeShell(
			'case "$1" in *i*) eval "$2";; *) exit 1;; esac',
		);
		const result = await resolveLoginShellPath({
			shell,
			timeoutMs: 2000,
			env: { PATH: "/Users/vu/.local/bin:/usr/bin:/bin" },
		});
		expect(result).toBe("/Users/vu/.local/bin:/usr/bin:/bin");
	});

	it("ignores rc-file noise printed around the PATH", async () => {
		const shell = writeFakeShell('echo "welcome to your shell"; eval "$2"');
		const result = await resolveLoginShellPath({
			shell,
			timeoutMs: 2000,
			env: { PATH: "/opt/homebrew/bin:/usr/bin" },
		});
		expect(result).toBe("/opt/homebrew/bin:/usr/bin");
	});

	it("returns null when the shell reports an empty PATH", async () => {
		const shell = writeFakeShell('eval "$2"');
		const result = await resolveLoginShellPath({
			shell,
			timeoutMs: 2000,
			env: { PATH: "" },
		});
		expect(result).toBeNull();
	});

	it("returns null on a non-zero exit instead of throwing", async () => {
		const shell = writeFakeShell("exit 1");
		expect(await resolveLoginShellPath({ shell, timeoutMs: 2000 })).toBeNull();
	});

	it("returns null on timeout", async () => {
		const shell = writeFakeShell("sleep 30");
		expect(await resolveLoginShellPath({ shell, timeoutMs: 100 })).toBeNull();
	});
});

describe("augmentGuiLaunchPath", () => {
	it("augments PATH on a packaged macOS app launched from Finder", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
		await augmentGuiLaunchPath({
			platform: "darwin",
			isPackaged: true,
			env,
			resolveImpl: async () => "/opt/homebrew/bin:/usr/bin:/bin",
		});
		expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
	});

	it("does nothing on non-macOS platforms", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
		await augmentGuiLaunchPath({
			platform: "linux",
			isPackaged: true,
			env,
			resolveImpl: async () => "/opt/homebrew/bin",
		});
		expect(env.PATH).toBe("/usr/bin:/bin");
	});

	it("does nothing when unpackaged so dev/e2e runs stay deterministic", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
		let resolved = false;
		await augmentGuiLaunchPath({
			platform: "darwin",
			isPackaged: false,
			env,
			resolveImpl: async () => {
				resolved = true;
				return "/opt/homebrew/bin";
			},
		});
		expect(env.PATH).toBe("/usr/bin:/bin");
		// Must not even spawn the login shell when the gate is closed.
		expect(resolved).toBe(false);
	});

	it("leaves PATH unchanged when the login shell yields nothing", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
		await augmentGuiLaunchPath({
			platform: "darwin",
			isPackaged: true,
			env,
			resolveImpl: async () => null,
		});
		expect(env.PATH).toBe("/usr/bin:/bin");
	});
});
