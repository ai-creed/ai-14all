import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

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
 * @param name trusted, compile-time-constant binary name ("whisper",
 * "claude", "codex") — it is interpolated into a shell line below, so it
 * must never be a user- or config-derived value.
 */
export function resolveBinary(
	name: string,
	options: ResolveBinaryOptions = {},
): Promise<ResolvedBinary | null> {
	// An explicit override never falls back to PATH: the user pointed at a
	// specific install, and silently using another one would be confusing.
	if (options.installPath != null) {
		return Promise.resolve(resolveOverride(options.installPath));
	}
	const shell = options.shell ?? process.env.SHELL ?? "/bin/zsh";
	const timeoutMs = options.timeoutMs ?? 5000;
	return new Promise((resolve) => {
		// Login shell ONLY to locate the binary; never to run commands with args.
		const child = spawn(shell, ["-lc", `command -v ${name}`], {
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
			finish(null);
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
		});
		child.on("error", () => finish(null));
		child.on("close", (code) => {
			if (code !== 0) return finish(null);
			// rc-file noise can precede the real line; take the last absolute path.
			const lines = out
				.trim()
				.split("\n")
				.map((l) => l.trim());
			const hit = lines.reverse().find((l) => l.startsWith("/"));
			finish(hit ? { command: hit, prefixArgs: [] } : null);
		});
	});
}
