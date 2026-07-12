import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { BundledSkill } from "./skill-asset.js";
import { BUNDLED_SKILL_IDS } from "./skill-asset.js";
import {
	guardedWriteSkill,
	type SkillInstallOutcome,
} from "./skill-version.js";

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

export class ClaudeProvider {
	constructor(private readonly deps: Deps) {}

	private skillDir(skillId: string): string {
		return join(this.deps.home, ".claude", "skills", skillId);
	}

	/**
	 * Install every bundled skill through the version guard, then register the
	 * MCP server once. A skill is only written when the bundled copy is new or
	 * strictly newer than the installed one; skips are reported per skill. MCP
	 * registration is server-level, not per-skill, so it runs exactly once.
	 */
	async installSkills(
		input: InstallSkillsInput,
	): Promise<SkillInstallOutcome[]> {
		if (!(await this.deps.isCliAvailable())) {
			throw new Error(
				"claude CLI is not available on PATH; install Claude Code or use the manual-setup snippet.",
			);
		}
		const outcomes: SkillInstallOutcome[] = [];
		for (const skill of input.skills) {
			const action = await guardedWriteSkill(this.skillDir(skill.id), skill);
			outcomes.push({ id: skill.id, action });
		}
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
		return outcomes;
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
