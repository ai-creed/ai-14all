import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDefaultShell } from "../platform/default-shell.js";

export type ResolvedBinary = {
	command: string;
	/** Prepended to every argv (non-empty only for dev-checkout node entry). */
	prefixArgs: string[];
};

export type ResolveBinaryOptions = {
	shell?: string;
	timeoutMs?: number;
	/** Config override: executable file, or a whisper dev-checkout root dir. */
	installPath?: string | null;
	/**
	 * Directories searched in order when the login-shell probe finds nothing — a
	 * safety net for GUI launches whose interactive shell config the probe can't
	 * fully reproduce. Defaults to the common per-user / Homebrew bin dirs.
	 * Override in tests; pass `[]` to disable the fallback.
	 */
	searchPaths?: string[];
	/** Defaults to process.platform; inject to exercise the win32 branch. */
	platform?: NodeJS.Platform;
	/** win32 PATH probe (`where`); injectable for tests. */
	whichOnPath?: (name: string) => Promise<string | null>;
};

const DEV_CHECKOUT_ENTRY = "packages/cli/dist/bin/whisper.js";

function resolveOverride(installPath: string): ResolvedBinary | null {
	let stat;
	try {
		stat = statSync(installPath);
	} catch {
		return null;
	}
	if (stat.isFile()) return { command: installPath, prefixArgs: [] };
	if (stat.isDirectory()) {
		const entry = join(installPath, DEV_CHECKOUT_ENTRY);
		try {
			if (statSync(entry).isFile())
				return { command: process.execPath, prefixArgs: [entry] };
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Bin dirs probed directly when the login-shell lookup finds nothing. These
 * commonly hold the agent CLIs but are added to PATH only by an *interactive* rc
 * file — e.g. the Claude native installer drops `claude` in `~/.local/bin` and
 * exports that dir in `.zshrc`. A last-resort safety net for the rare GUI launch
 * whose shell config even an interactive login shell can't reproduce.
 */
function defaultSearchPaths(): string[] {
	return [
		join(homedir(), ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
	];
}

const WINDOWS_EXES = ["", ".exe", ".cmd", ".bat", ".ps1"];

function defaultWindowsSearchPaths(env: NodeJS.ProcessEnv): string[] {
	const out: string[] = [];
	if (env.LOCALAPPDATA) {
		out.push(join(env.LOCALAPPDATA, "Programs"));
		out.push(join(env.LOCALAPPDATA, "Microsoft", "WindowsApps"));
	}
	if (env.APPDATA) out.push(join(env.APPDATA, "npm")); // npm global prefix
	if (env.USERPROFILE) out.push(join(env.USERPROFILE, ".local", "bin"));
	return out;
}

function findInWindowsSearchPaths(
	name: string,
	dirs: string[],
): ResolvedBinary | null {
	for (const dir of dirs) {
		for (const ext of WINDOWS_EXES) {
			const candidate = join(dir, `${name}${ext}`);
			try {
				if (statSync(candidate).isFile())
					return { command: candidate, prefixArgs: [] };
			} catch {
				// keep looking
			}
		}
	}
	return null;
}

function whichOnPathWindows(name: string): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn("where", [name], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		let out = "";
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
		});
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			if (code !== 0) return resolve(null);
			const first = out
				.split(/\r?\n/)
				.map((l) => l.trim())
				.find((l) => l.length > 0);
			resolve(first ?? null);
		});
	});
}

function findInSearchPaths(
	name: string,
	dirs: string[],
): ResolvedBinary | null {
	for (const dir of dirs) {
		const candidate = join(dir, name);
		try {
			if (statSync(candidate).isFile())
				return { command: candidate, prefixArgs: [] };
		} catch {
			// Not in this dir — keep looking.
		}
	}
	return null;
}

/**
 * @param name trusted, compile-time-constant binary name ("whisper",
 * "claude", "codex") — it is interpolated into a shell line below, so it
 * must never be a user- or config-derived value.
 */
export async function resolveBinary(
	name: string,
	options: ResolveBinaryOptions = {},
): Promise<ResolvedBinary | null> {
	// An explicit override never falls back to PATH: the user pointed at a
	// specific install, and silently using another one would be confusing.
	if (options.installPath != null) {
		return resolveOverride(options.installPath);
	}

	const platform = options.platform ?? process.platform;
	if (platform === "win32") {
		const which = options.whichOnPath ?? whichOnPathWindows;
		const searchPaths =
			options.searchPaths ?? defaultWindowsSearchPaths(process.env);
		const hit = await which(name);
		if (hit) return { command: hit, prefixArgs: [] };
		return findInWindowsSearchPaths(name, searchPaths);
	}

	const shell = options.shell ?? resolveDefaultShell({ platform }).shell;
	const timeoutMs = options.timeoutMs ?? 5000;
	const searchPaths = options.searchPaths ?? defaultSearchPaths();
	const fallback = () => findInSearchPaths(name, searchPaths);
	return new Promise((resolve) => {
		// Interactive login shell ("-ilc"), ONLY to locate the binary — never to
		// run commands with args. The probe must source the same rc files the
		// user's terminal does: a bare login shell ("-lc") skips `.zshrc`/`.bashrc`,
		// so a binary whose PATH entry lives there (e.g. `~/.local/bin` from the
		// Claude native installer) is invisible even though the user's terminal
		// `command -v` finds it.
		const child = spawn(shell, ["-ilc", `command -v ${name}`], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		let out = "";
		let done = false;
		const finish = (value: ResolvedBinary | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(fallback());
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
		});
		child.on("error", () => finish(fallback()));
		child.on("close", (code) => {
			if (code !== 0) return finish(fallback());
			// rc-file noise can precede the real line; take the last absolute path.
			const lines = out
				.trim()
				.split("\n")
				.map((l) => l.trim());
			const hit = lines.reverse().find((l) => l.startsWith("/"));
			finish(hit ? { command: hit, prefixArgs: [] } : fallback());
		});
	});
}
