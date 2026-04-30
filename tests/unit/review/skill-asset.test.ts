// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadBundledSkill } from "../../../services/review/agent-skill-installer/skill-asset.js";

describe("loadBundledSkill (path resolution)", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "skill-asset-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function writeSkillAt(...segments: string[]): Promise<void> {
		const dirPath = join(dir, ...segments);
		await mkdir(dirPath, { recursive: true });
		await writeFile(join(dirPath, "SKILL.md"), "skill body", "utf-8");
	}

	it("loads from the canonical assets/agent-skills layout", async () => {
		await writeSkillAt("assets", "agent-skills", "ai-14all-fix-review");
		const result = await loadBundledSkill(dir);
		expect(result.content).toBe("skill body");
	});

	it("falls back to the legacy agent-skills layout (no assets prefix)", async () => {
		await writeSkillAt("agent-skills", "ai-14all-fix-review");
		const result = await loadBundledSkill(dir);
		expect(result.content).toBe("skill body");
	});

	it("recovers via bounded recursive search when packaged in an unexpected subtree", async () => {
		await writeSkillAt(
			"misc",
			"bundled",
			"agent-skills",
			"ai-14all-fix-review",
		);
		const result = await loadBundledSkill(dir);
		expect(result.content).toBe("skill body");
	});

	it("throws a descriptive error when the skill is not packaged anywhere", async () => {
		await expect(loadBundledSkill(dir)).rejects.toThrow(/ai-14all-fix-review/);
	});
});
