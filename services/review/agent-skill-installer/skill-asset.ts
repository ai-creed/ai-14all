import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type SkillAsset = { content: string };

export async function loadBundledSkill(appResourcesPath: string): Promise<SkillAsset> {
	const path = join(
		appResourcesPath,
		"agent-skills",
		"ai-14all-fix-review",
		"SKILL.md",
	);
	const content = await readFile(path, "utf-8");
	return { content };
}
