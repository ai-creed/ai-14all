import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillAsset } from "./skill-asset.js";

const exec = promisify(execFile);

export type Deps = {
	home: string;
	cliPath: string;
	isCliAvailable: () => Promise<boolean>;
};

export class CodexProvider {
	constructor(private readonly deps: Deps) {}

	private skillDir(): string {
		return join(this.deps.home, ".codex", "skills", "ai-14all-fix-review");
	}

	async install(input: {
		serverName: string;
		url: string;
		skill: SkillAsset;
	}): Promise<void> {
		if (!(await this.deps.isCliAvailable())) {
			throw new Error(
				"codex CLI is not available on PATH; install Codex or use the manual-setup snippet.",
			);
		}
		const dir = this.skillDir();
		await mkdir(dir, { recursive: true });
		const tmp = join(dir, "SKILL.md.ai-14all.tmp");
		await writeFile(tmp, input.skill.content, "utf-8");
		await rename(tmp, join(dir, "SKILL.md"));
		// Idempotent: remove any prior registration before adding. Handles the
		// case where the user wiped the skill dir manually but ~/.codex/config
		// still has the server entry, which makes `mcp add` fail.
		try {
			await exec(this.deps.cliPath, ["mcp", "remove", input.serverName]);
		} catch {
			/* not registered — fine */
		}
		await exec(this.deps.cliPath, [
			"mcp",
			"add",
			"--url",
			input.url,
			input.serverName,
		]);
	}

	async uninstall(input: { serverName: string }): Promise<void> {
		await rm(this.skillDir(), { recursive: true, force: true });
		if (await this.deps.isCliAvailable()) {
			try {
				await exec(this.deps.cliPath, ["mcp", "remove", input.serverName]);
			} catch {
				/* idempotent */
			}
		}
	}
}
