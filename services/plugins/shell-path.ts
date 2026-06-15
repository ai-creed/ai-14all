import { spawn } from "node:child_process";

export type ResolveShellPathOptions = {
	shell?: string;
	timeoutMs?: number;
	/** Environment for the spawned shell; defaults to the current process env. */
	env?: NodeJS.ProcessEnv;
};

// Bracket the PATH so rc-file noise (the user's zsh sets the terminal title via
// OSC sequences on every prompt) can never be mistaken for it.
const MARKER = "__AI14ALL_PATH__";

/**
 * Capture the PATH an *interactive login* shell exposes.
 *
 * Finder/Dock-launched macOS apps inherit only the bare GUI PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), so Homebrew/npm binaries — and the `node`
 * their `#!/usr/bin/env node` shebangs need — are unreachable to `execFile`.
 * Mirrors binary-resolver's login-shell mechanism. The shell is interactive
 * (`-ilc`) so it sources `.zshrc`/`.bashrc` too — a bare login shell (`-lc`)
 * skips them, missing PATH entries like `~/.local/bin` (the Claude native
 * installer exports it there). Returns null on any failure (non-zero exit,
 * timeout, spawn error, empty PATH) so callers keep their existing PATH
 * untouched.
 */
export function resolveLoginShellPath(
	options: ResolveShellPathOptions = {},
): Promise<string | null> {
	const shell = options.shell ?? process.env.SHELL ?? "/bin/zsh";
	const timeoutMs = options.timeoutMs ?? 5000;
	return new Promise((resolve) => {
		const child = spawn(
			shell,
			["-ilc", `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`],
			{
				stdio: ["ignore", "pipe", "ignore"],
				env: options.env ?? process.env,
			},
		);
		let out = "";
		let done = false;
		const finish = (value: string | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(null);
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
		});
		child.on("error", () => finish(null));
		child.on("close", (code) => {
			if (code !== 0) return finish(null);
			const start = out.indexOf(MARKER);
			const end = out.lastIndexOf(MARKER);
			if (start === -1 || end <= start) return finish(null);
			const path = out.slice(start + MARKER.length, end);
			finish(path.length > 0 ? path : null);
		});
	});
}

/**
 * Merge a login-shell PATH into the process's base PATH.
 *
 * Login-shell entries come first so the app resolves binaries the same way the
 * user's terminal does; base entries are appended as a fallback. Empty segments
 * are dropped and duplicates removed. A null/empty shell PATH leaves the base
 * unchanged.
 */
export function mergePath(
	basePath: string | undefined,
	shellPath: string | null,
): string {
	const shell = (shellPath ?? "").split(":").filter(Boolean);
	const base = (basePath ?? "").split(":").filter(Boolean);
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const entry of [...shell, ...base]) {
		if (seen.has(entry)) continue;
		seen.add(entry);
		merged.push(entry);
	}
	return merged.join(":");
}

export type AugmentGuiLaunchPathOptions = {
	platform: NodeJS.Platform;
	isPackaged: boolean;
	/** Defaults to process.env; the object's PATH is mutated in place. */
	env?: NodeJS.ProcessEnv;
	/** Test seam; defaults to resolveLoginShellPath. */
	resolveImpl?: () => Promise<string | null>;
};

/**
 * Repair the PATH of a GUI-launched (Finder/Dock) packaged macOS app so plugin
 * probes can spawn Homebrew/npm CLIs. No-op off macOS or when unpackaged — dev
 * and e2e runs are terminal-launched with a full PATH already, and skipping
 * keeps them from spawning a login shell (deterministic).
 */
export async function augmentGuiLaunchPath(
	options: AugmentGuiLaunchPathOptions,
): Promise<void> {
	if (!(options.isPackaged && options.platform === "darwin")) return;
	const env = options.env ?? process.env;
	const resolve = options.resolveImpl ?? resolveLoginShellPath;
	env.PATH = mergePath(env.PATH, await resolve());
}
