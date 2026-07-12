import { join } from "node:path";

export type CliSource = "override" | "path" | "fixed" | "shell";
export type Detection = { cliPath: string; source: CliSource } | null;

export type DetectDeps = {
	home: string;
	platform: NodeJS.Platform;
	shell: string | undefined;
	override: string | null;
	exec: (
		file: string,
		args: string[],
		opts?: { timeout?: number },
	) => Promise<{ stdout: string }>;
	access: (path: string) => Promise<void>;
	/**
	 * E2E isolation seam. When true, detection stops after Tier 2 (which/where,
	 * which honors the caller-controlled PATH) and skips Tier 3 (fixed absolute
	 * candidates) and Tier 4 (login-shell probe) — both of which escape PATH.
	 * Without this, a stripped-PATH e2e run on a machine with real CLIs at
	 * fixed paths (e.g. /opt/homebrew/bin/claude) would detect the REAL CLI and
	 * exec a real `claude mcp add/remove` against the developer's ~/.claude.json.
	 */
	pathOnly?: boolean;
};

export type CliCmd = "claude" | "codex" | "ai-ezio";

const FIXED_CANDIDATES: Record<CliCmd, (home: string) => string[]> = {
	claude: (home) => [
		join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
		join(home, ".local", "bin", "claude"),
		join(home, ".bun", "bin", "claude"),
		join(home, ".npm-global", "bin", "claude"),
		join(home, ".volta", "bin", "claude"),
		join(home, ".cargo", "bin", "claude"),
	],
	codex: (home) => [
		"/opt/homebrew/bin/codex",
		"/usr/local/bin/codex",
		join(home, ".local", "bin", "codex"),
		join(home, ".bun", "bin", "codex"),
		join(home, ".npm-global", "bin", "codex"),
		join(home, ".volta", "bin", "codex"),
		join(home, ".cargo", "bin", "codex"),
	],
	"ai-ezio": (home) => [
		"/opt/homebrew/bin/ai-ezio",
		"/usr/local/bin/ai-ezio",
		join(home, ".local", "bin", "ai-ezio"),
		join(home, ".bun", "bin", "ai-ezio"),
		join(home, ".npm-global", "bin", "ai-ezio"),
		join(home, ".volta", "bin", "ai-ezio"),
		join(home, ".cargo", "bin", "ai-ezio"),
	],
};

async function fileExists(
	access: DetectDeps["access"],
	path: string,
): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function detectCliPath(
	cmd: CliCmd,
	deps: DetectDeps,
): Promise<Detection> {
	// Tier 1: override
	if (deps.override && (await fileExists(deps.access, deps.override))) {
		return { cliPath: deps.override, source: "override" };
	}

	// Tier 2: which/where
	const lookup = deps.platform === "win32" ? "where" : "which";
	try {
		const { stdout } = await deps.exec(lookup, [cmd], { timeout: 1000 });
		const first = stdout
			.split(/\r?\n/)
			.map((s) => s.trim())
			.find(Boolean);
		if (first) return { cliPath: first, source: "path" };
	} catch {
		/* fall through */
	}

	// Tiers 3–4 escape the caller-controlled PATH; skip them in pathOnly mode
	// (e2e isolation — see DetectDeps.pathOnly).
	if (deps.pathOnly) return null;

	// Tier 3: fixed candidates (skip on win32)
	if (deps.platform !== "win32") {
		for (const candidate of FIXED_CANDIDATES[cmd](deps.home)) {
			if (await fileExists(deps.access, candidate)) {
				return { cliPath: candidate, source: "fixed" };
			}
		}
	}

	// Tier 4: login-shell probe (skip on win32 / no shell)
	if (deps.platform !== "win32" && deps.shell) {
		try {
			const { stdout } = await deps.exec(
				deps.shell,
				["-ilc", `command -v ${cmd}`],
				{ timeout: 2000 },
			);
			const first = stdout
				.split(/\r?\n/)
				.map((s) => s.trim())
				.find(Boolean);
			if (first && (await fileExists(deps.access, first))) {
				return { cliPath: first, source: "shell" };
			}
		} catch {
			/* swallow */
		}
	}

	return null;
}
