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

export type InstallInput = {
	serverName: string;
	url: string;
	skill: SkillAsset;
};

export class ClaudeProvider {
	constructor(private readonly deps: Deps) {}

	private skillDir(): string {
		return join(this.deps.home, ".claude", "skills", "ai-14all-fix-review");
	}

	async install(input: InstallInput): Promise<void> {
		if (!(await this.deps.isCliAvailable())) {
			throw new Error(
				"claude CLI is not available on PATH; install Claude Code or use the manual-setup snippet.",
			);
		}
		await this.writeSkill(input.skill);
		// Idempotent: remove any prior registration before adding. Handles the
		// case where the user wiped the skill dir manually but ~/.claude.json
		// still has the server entry, which makes `mcp add` fail with
		// "already exists".
		try {
			await exec(this.deps.cliPath, ["mcp", "remove", input.serverName]);
		} catch {
			/* not registered — fine */
		}
		await exec(this.deps.cliPath, [
			"mcp",
			"add",
			"--transport",
			"http",
			"--scope",
			"user",
			input.serverName,
			input.url,
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

	private async writeSkill(skill: SkillAsset): Promise<void> {
		const dir = this.skillDir();
		await mkdir(dir, { recursive: true });
		const tmp = join(dir, "SKILL.md.ai-14all.tmp");
		await writeFile(tmp, skill.content, "utf-8");
		await rename(tmp, join(dir, "SKILL.md"));
	}
}
