import { extname } from "node:path";

/**
 * Adapt a resolved-binary invocation so Node can actually launch it on Windows.
 *
 * The binary resolver frequently lands on a script shim rather than a real
 * `.exe` — an npm global install of `ai-cortex` / `whisper` drops
 * `ai-cortex.cmd` / `whisper.cmd` in `%APPDATA%\npm`, and some agents ship a
 * `.ps1`. Node's `execFile`/`spawn` REFUSE to launch a `.cmd`/`.bat` directly
 * (the CVE-2024-27980 hardening) and cannot run a `.ps1` at all, so a direct
 * `execFile(shim, …)` fails with EINVAL/ENOENT — which callers mis-read as the
 * tool being broken ("degraded") when it is installed and works fine from a
 * terminal. We re-target the call at the interpreter (`cmd.exe` / PowerShell)
 * and pass the shim as an argument, so Node's normal argv quoting applies and
 * arguments with spaces survive. POSIX (and Windows `.exe`) calls pass through
 * untouched.
 *
 * Note: routing through `cmd.exe` reopens the small surface Node closed — an
 * argument containing cmd metacharacters (`&`, `|`, `^`, `"`) is not fully
 * escaped. All current callers pass fixed sub-commands or locally-originated
 * values, so this is acceptable; do not feed it remote/untrusted argv.
 */
export function adaptResolvedExec(
	command: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
	if (platform !== "win32") return { command, args };

	const ext = extname(command).toLowerCase();
	if (ext === ".cmd" || ext === ".bat") {
		// `/d` skips AutoRun, `/s /c` keeps cmd's quote handling predictable so the
		// quoted shim path + quoted args reach the shim intact.
		return {
			command: env.ComSpec || "cmd.exe",
			args: ["/d", "/s", "/c", command, ...args],
		};
	}
	if (ext === ".ps1") {
		return {
			command: "powershell.exe",
			args: [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				command,
				...args,
			],
		};
	}
	return { command, args };
}
