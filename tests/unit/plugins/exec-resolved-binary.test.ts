import { describe, expect, it } from "vitest";
import { adaptResolvedExec } from "../../../services/plugins/exec-resolved-binary";

describe("adaptResolvedExec", () => {
	it("passes through unchanged on POSIX", () => {
		expect(
			adaptResolvedExec("/usr/local/bin/ai-cortex", ["--version"], "linux"),
		).toEqual({ command: "/usr/local/bin/ai-cortex", args: ["--version"] });
	});

	it("passes through a real .exe on win32", () => {
		const exe = "C:\\Program Files\\nodejs\\node.exe";
		expect(adaptResolvedExec(exe, ["index.js", "--version"], "win32")).toEqual({
			command: exe,
			args: ["index.js", "--version"],
		});
	});

	it("routes a .cmd shim through cmd.exe so Node will launch it", () => {
		const shim = "C:\\Users\\u\\AppData\\Roaming\\npm\\ai-cortex.cmd";
		expect(
			adaptResolvedExec(shim, ["--version"], "win32", {
				ComSpec: "C:\\Windows\\System32\\cmd.exe",
			}),
		).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", shim, "--version"],
		});
	});

	it("routes a .bat shim through cmd.exe and falls back to cmd.exe", () => {
		const shim = "C:\\tools\\whisper.bat";
		expect(adaptResolvedExec(shim, ["env", "--json"], "win32", {})).toEqual({
			command: "cmd.exe",
			args: ["/d", "/s", "/c", shim, "env", "--json"],
		});
	});

	it("routes a .ps1 through PowerShell -File (cmd.exe cannot run it)", () => {
		const ps1 = "C:\\tools\\whisper.ps1";
		expect(adaptResolvedExec(ps1, ["env", "--json"], "win32")).toEqual({
			command: "powershell.exe",
			args: [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				ps1,
				"env",
				"--json",
			],
		});
	});

	it("preserves args with spaces as discrete tokens (Node quotes them)", () => {
		const shim = "C:\\npm\\whisper.cmd";
		const { args } = adaptResolvedExec(
			shim,
			["collab", "tell", "--target", "claude", "hello world"],
			"win32",
			{},
		);
		// The space-containing instruction stays a single argv entry — quoting is
		// Node's job, not ours — so the shim receives it intact.
		expect(args).toContain("hello world");
	});
});
