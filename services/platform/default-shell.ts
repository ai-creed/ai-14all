import { existsSync as defaultExistsSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

export type DefaultShell = { shell: string; args: string[] };

export type ResolveDefaultShellOptions = {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	existsSync?: (p: string) => boolean;
};

// Common pwsh 7 install locations (winget / MSI put it under Program Files).
const PWSH_CANDIDATES = [
	"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
	"C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe",
];

// Scan the Windows PATH for an executable. PATH may arrive as `Path` (Windows
// env-var casing) and is `;`-delimited; each entry is joined with win32
// semantics so the lookup is deterministic regardless of the host OS running
// the build. Returns the first existing match, else null.
function findOnWindowsPath(
	exe: string,
	env: NodeJS.ProcessEnv,
	existsSync: (p: string) => boolean,
): string | null {
	const raw = env.PATH ?? env.Path ?? "";
	for (const entry of raw.split(";")) {
		const dir = entry.trim();
		if (!dir) continue;
		const candidate = pathWin32.join(dir, exe);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * Resolve the default interactive shell to launch in a terminal PTY.
 *
 * - darwin/linux: the user's `$SHELL` (or `/bin/zsh`) as a login shell (`-l`),
 *   identical to the app's long-standing behavior.
 * - win32: PowerShell 7 (`pwsh.exe`) if discoverable on PATH or at a known
 *   install location, else Windows PowerShell 5.1 (`powershell.exe`, always
 *   present), with `-NoLogo` to suppress the banner. No login flag — Windows
 *   shells have no `-l` concept.
 */
export function resolveDefaultShell(
	options: ResolveDefaultShellOptions = {},
): DefaultShell {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const existsSync = options.existsSync ?? defaultExistsSync;

	if (platform === "win32") {
		// 1) PATH discovery — winget/MSI installs put pwsh.exe on PATH.
		const onPath = findOnWindowsPath("pwsh.exe", env, existsSync);
		if (onPath) return { shell: onPath, args: ["-NoLogo"] };
		// 2) Known install locations.
		for (const candidate of PWSH_CANDIDATES) {
			if (existsSync(candidate)) return { shell: candidate, args: ["-NoLogo"] };
		}
		// 3) Windows PowerShell 5.1 — always present.
		const systemRoot = env.SystemRoot ?? env.windir ?? "C:\\Windows";
		const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
		return {
			shell: existsSync(powershell) ? powershell : "powershell.exe",
			args: ["-NoLogo"],
		};
	}

	return { shell: env.SHELL ?? "/bin/zsh", args: ["-l"] };
}
