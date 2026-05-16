import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BundledSkill } from "./skill-asset.js";
import { BUNDLED_SKILL_IDS } from "./skill-asset.js";

const exec = promisify(execFile);

export type Deps = {
	home: string;
	cliPath: string;
	isCliAvailable: () => Promise<boolean>;
};

export type InstallSkillsInput = {
	serverName: string;
	url: string;
	skills: BundledSkill[];
};

export class CodexProvider {
	constructor(private readonly deps: Deps) {}

	private skillDir(skillId: string): string {
		return join(this.deps.home, ".codex", "skills", skillId);
	}

	/**
	 * Install every bundled skill, then register the MCP server once. The
	 * per-skill copy is identical to the original single-skill path — only
	 * iterated. MCP registration is server-level, not per-skill, so it runs
	 * exactly once.
	 */
	async installSkills(input: InstallSkillsInput): Promise<void> {
		if (!(await this.deps.isCliAvailable())) {
			throw new Error(
				"codex CLI is not available on PATH; install Codex or use the manual-setup snippet.",
			);
		}
		for (const skill of input.skills) {
			const dir = this.skillDir(skill.id);
			await mkdir(dir, { recursive: true });
			const tmp = join(dir, "SKILL.md.ai-14all.tmp");
			await writeFile(tmp, skill.content, "utf-8");
			await rename(tmp, join(dir, "SKILL.md"));
		}
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
		for (const id of BUNDLED_SKILL_IDS) {
			await rm(this.skillDir(id), { recursive: true, force: true });
		}
		if (await this.deps.isCliAvailable()) {
			try {
				await exec(this.deps.cliPath, ["mcp", "remove", input.serverName]);
			} catch {
				/* idempotent */
			}
		}
	}
}
