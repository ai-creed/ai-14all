// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDefaultShell } from "../../../../services/platform/default-shell.js";

describe("resolveDefaultShell", () => {
	it("uses $SHELL with a login flag on darwin", () => {
		expect(
			resolveDefaultShell({
				platform: "darwin",
				env: { SHELL: "/bin/fish" },
				existsSync: () => false,
			}),
		).toEqual({ shell: "/bin/fish", args: ["-l"] });
	});

	it("falls back to /bin/zsh with a login flag when $SHELL is unset (darwin)", () => {
		expect(
			resolveDefaultShell({
				platform: "darwin",
				env: {},
				existsSync: () => false,
			}),
		).toEqual({ shell: "/bin/zsh", args: ["-l"] });
	});

	it("uses the same posix behavior on linux", () => {
		expect(
			resolveDefaultShell({
				platform: "linux",
				env: { SHELL: "/usr/bin/bash" },
				existsSync: () => false,
			}),
		).toEqual({ shell: "/usr/bin/bash", args: ["-l"] });
	});

	it("prefers pwsh.exe when installed on win32", () => {
		const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
		expect(
			resolveDefaultShell({
				platform: "win32",
				env: { SystemRoot: "C:\\Windows" },
				existsSync: (p) => p === pwsh,
			}),
		).toEqual({ shell: pwsh, args: ["-NoLogo"] });
	});

	it("discovers pwsh.exe on PATH when not at a fixed location (win32)", () => {
		const pathPwsh = "C:\\tools\\pwsh\\pwsh.exe";
		expect(
			resolveDefaultShell({
				platform: "win32",
				env: {
					Path: "C:\\tools\\pwsh;C:\\Windows\\System32",
					SystemRoot: "C:\\Windows",
				},
				existsSync: (p) => p === pathPwsh,
			}),
		).toEqual({ shell: pathPwsh, args: ["-NoLogo"] });
	});

	it("falls back to Windows PowerShell when pwsh is absent (win32)", () => {
		expect(
			resolveDefaultShell({
				platform: "win32",
				env: { SystemRoot: "C:\\Windows" },
				existsSync: (p) =>
					p ===
					"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			}),
		).toEqual({
			shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			args: ["-NoLogo"],
		});
	});

	it("falls back to the bare powershell.exe name when nothing is found (win32)", () => {
		expect(
			resolveDefaultShell({
				platform: "win32",
				env: { SystemRoot: "C:\\Windows" },
				existsSync: () => false,
			}),
		).toEqual({ shell: "powershell.exe", args: ["-NoLogo"] });
	});
});
