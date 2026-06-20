import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	pickWindowsExecutable,
	resolveBinary,
} from "../../../services/plugins/binary-resolver";

let dir: string;

function makeDir(): string {
	dir = mkdtempSync(join(tmpdir(), "ofa-binres-"));
	return dir;
}

function writeFakeShell(body: string): string {
	const shell = join(makeDir(), "fake-shell.sh");
	writeFileSync(shell, `#!/bin/sh\n${body}\n`, "utf8");
	chmodSync(shell, 0o755);
	return shell;
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("resolveBinary", () => {
	it("resolves via the login shell and returns a direct-spawn spec", async () => {
		const shell = writeFakeShell('echo "/fake/bin/whisper"');
		const result = await resolveBinary("whisper", { shell, timeoutMs: 2000 });
		expect(result).toEqual({ command: "/fake/bin/whisper", prefixArgs: [] });
	});

	it("resolves a binary visible only to an interactive login shell (.zshrc PATH)", async () => {
		// Emulates `~/.local/bin` exported in `.zshrc` (interactive-only): the fake
		// shell answers `command -v` only when invoked with -i. A bare `-lc` login
		// shell never sources `.zshrc`, so this is the exact reported bug — claude
		// at /Users/vu/.local/bin is findable in the terminal but not by the probe.
		const shell = writeFakeShell(
			'case "$1" in *i*) echo "/Users/vu/.local/bin/claude";; *) exit 1;; esac',
		);
		const result = await resolveBinary("claude", {
			shell,
			timeoutMs: 2000,
			searchPaths: [],
		});
		expect(result).toEqual({
			command: "/Users/vu/.local/bin/claude",
			prefixArgs: [],
		});
	});

	it("returns null when the shell finds nothing", async () => {
		const shell = writeFakeShell("exit 1");
		expect(
			await resolveBinary("whisper", {
				shell,
				timeoutMs: 2000,
				searchPaths: [],
			}),
		).toBeNull();
	});

	it("returns null on garbage output instead of throwing", async () => {
		const shell = writeFakeShell('echo "zsh: command not found: whisper"');
		expect(
			await resolveBinary("whisper", {
				shell,
				timeoutMs: 2000,
				searchPaths: [],
			}),
		).toBeNull();
	});

	it("returns null on timeout", async () => {
		const shell = writeFakeShell("sleep 30");
		expect(
			await resolveBinary("whisper", {
				shell,
				timeoutMs: 100,
				searchPaths: [],
			}),
		).toBeNull();
	});

	it("falls back to a well-known bin dir when the shell finds nothing", async () => {
		const shell = writeFakeShell("exit 1");
		const binDir = join(dir, "bin");
		mkdirSync(binDir);
		const bin = join(binDir, "claude");
		writeFileSync(bin, "#!/bin/sh\n", "utf8");
		chmodSync(bin, 0o755);
		const result = await resolveBinary("claude", {
			shell,
			timeoutMs: 2000,
			searchPaths: [binDir],
		});
		expect(result).toEqual({ command: bin, prefixArgs: [] });
	});

	it("falls back to a well-known bin dir when the shell times out", async () => {
		const shell = writeFakeShell("sleep 30");
		const binDir = join(dir, "bin");
		mkdirSync(binDir);
		const bin = join(binDir, "claude");
		writeFileSync(bin, "#!/bin/sh\n", "utf8");
		chmodSync(bin, 0o755);
		const result = await resolveBinary("claude", {
			shell,
			timeoutMs: 100,
			searchPaths: [binDir],
		});
		expect(result).toEqual({ command: bin, prefixArgs: [] });
	});

	it("prefers the shell result over the fallback search", async () => {
		const shell = writeFakeShell('echo "/shell/hit/claude"');
		const binDir = join(dir, "bin");
		mkdirSync(binDir);
		const bin = join(binDir, "claude");
		writeFileSync(bin, "#!/bin/sh\n", "utf8");
		chmodSync(bin, 0o755);
		const result = await resolveBinary("claude", {
			shell,
			timeoutMs: 2000,
			searchPaths: [binDir],
		});
		expect(result).toEqual({ command: "/shell/hit/claude", prefixArgs: [] });
	});

	it("override: executable file is used directly", async () => {
		const file = join(makeDir(), "whisper");
		writeFileSync(file, "#!/bin/sh\n", "utf8");
		chmodSync(file, 0o755);
		const result = await resolveBinary("whisper", {
			shell: "/bin/sh",
			timeoutMs: 2000,
			installPath: file,
		});
		expect(result).toEqual({ command: file, prefixArgs: [] });
	});

	it("override: directory resolves to node + dev-checkout entry", async () => {
		const root = makeDir();
		const entry = join(root, "packages/cli/dist/bin/whisper.js");
		mkdirSync(join(root, "packages/cli/dist/bin"), { recursive: true });
		writeFileSync(entry, "", "utf8");
		const result = await resolveBinary("whisper", {
			shell: "/bin/sh",
			timeoutMs: 2000,
			installPath: root,
		});
		expect(result).toEqual({
			command: process.execPath,
			prefixArgs: [entry],
		});
	});

	it("override: missing path yields null (not PATH fallback)", async () => {
		const result = await resolveBinary("whisper", {
			shell: "/bin/sh",
			timeoutMs: 2000,
			installPath: join(makeDir(), "nope"),
		});
		expect(result).toBeNull();
	});
});

describe("resolveBinary on win32", () => {
	it("returns the `where` hit when found on PATH", async () => {
		const result = await resolveBinary("claude", {
			platform: "win32",
			whichOnPath: async () => "C:\\tools\\claude.exe",
			searchPaths: [],
		});
		expect(result).toEqual({
			command: "C:\\tools\\claude.exe",
			prefixArgs: [],
		});
	});

	it("falls back to a search path and finds a .exe by extension", async () => {
		const binDir = join(makeDir(), "bin");
		mkdirSync(binDir);
		const bin = join(binDir, "claude.exe");
		writeFileSync(bin, "", "utf8");
		const result = await resolveBinary("claude", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [binDir],
		});
		expect(result).toEqual({ command: bin, prefixArgs: [] });
	});

	it("finds a .cmd shim by extension in a search path", async () => {
		const binDir = join(makeDir(), "bin");
		mkdirSync(binDir);
		const bin = join(binDir, "claude.cmd");
		writeFileSync(bin, "", "utf8");
		const result = await resolveBinary("claude", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [binDir],
		});
		expect(result).toEqual({ command: bin, prefixArgs: [] });
	});

	it("prefers a runnable .cmd over the extensionless POSIX shim in a search path", async () => {
		// npm drops `ai-cortex` (a #!/bin/sh shim) AND `ai-cortex.cmd` side by side.
		// The bare shim must NOT win — Windows can't exec it, which is what made the
		// plugin show "degraded".
		const binDir = join(makeDir(), "bin");
		mkdirSync(binDir);
		writeFileSync(join(binDir, "ai-cortex"), "#!/bin/sh\n", "utf8");
		const cmd = join(binDir, "ai-cortex.cmd");
		writeFileSync(cmd, "", "utf8");
		const result = await resolveBinary("ai-cortex", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [binDir],
		});
		expect(result).toEqual({ command: cmd, prefixArgs: [] });
	});

	it("returns null when neither PATH nor the search paths have it", async () => {
		const result = await resolveBinary("claude", {
			platform: "win32",
			whichOnPath: async () => null,
			searchPaths: [join(makeDir(), "empty")],
		});
		expect(result).toBeNull();
	});

	it("an explicit installPath override still wins on win32", async () => {
		const file = join(makeDir(), "claude.exe");
		writeFileSync(file, "", "utf8");
		const result = await resolveBinary("claude", {
			platform: "win32",
			installPath: file,
		});
		expect(result).toEqual({ command: file, prefixArgs: [] });
	});
});

describe("pickWindowsExecutable", () => {
	it("picks the .cmd over the extensionless shim `where` lists first", () => {
		// Exactly what `where ai-cortex` prints for an npm global install.
		expect(
			pickWindowsExecutable([
				"C:\\Users\\u\\AppData\\Roaming\\npm\\ai-cortex",
				"C:\\Users\\u\\AppData\\Roaming\\npm\\ai-cortex.cmd",
			]),
		).toBe("C:\\Users\\u\\AppData\\Roaming\\npm\\ai-cortex.cmd");
	});

	it("prefers a native .exe over a .cmd", () => {
		expect(pickWindowsExecutable(["C:\\t\\foo.cmd", "C:\\t\\foo.exe"])).toBe(
			"C:\\t\\foo.exe",
		);
	});

	it("falls back to .ps1 when that's the only runnable match", () => {
		expect(pickWindowsExecutable(["C:\\t\\foo", "C:\\t\\foo.ps1"])).toBe(
			"C:\\t\\foo.ps1",
		);
	});

	it("ignores blank lines and trims CRLF whitespace", () => {
		expect(pickWindowsExecutable(["", "  C:\\t\\foo.cmd  ", "\r"])).toBe(
			"C:\\t\\foo.cmd",
		);
	});

	it("returns the first line when nothing has a runnable extension", () => {
		expect(pickWindowsExecutable(["C:\\t\\foo", "C:\\t\\bar"])).toBe(
			"C:\\t\\foo",
		);
	});

	it("returns null for empty output", () => {
		expect(pickWindowsExecutable([])).toBeNull();
		expect(pickWindowsExecutable(["", "   "])).toBeNull();
	});
});
