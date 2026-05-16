// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	BUNDLED_SKILL_IDS,
	loadBundledSkills,
} from "../../../services/review/agent-skill-installer/skill-asset.js";

describe("loadBundledSkills (path resolution)", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "skill-asset-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	// Write every bundled skill under the given path segments so loadBundledSkills
	// resolves the whole set from one layout. Body is tagged per id so the
	// returned skill can be matched back to its directory.
	async function writeAllSkillsAt(...segments: string[]): Promise<void> {
		for (const id of BUNDLED_SKILL_IDS) {
			const dirPath = join(dir, ...segments, id);
			await mkdir(dirPath, { recursive: true });
			await writeFile(join(dirPath, "SKILL.md"), `body of ${id}`, "utf-8");
		}
	}

	it("loads every bundled skill from the canonical assets/agent-skills layout", async () => {
		await writeAllSkillsAt("assets", "agent-skills");
		const result = await loadBundledSkills(dir);
		expect(result.map((s) => s.id)).toEqual([...BUNDLED_SKILL_IDS]);
		for (const skill of result) {
			expect(skill.content).toBe(`body of ${skill.id}`);
		}
	});

	it("falls back to the legacy agent-skills layout (no assets prefix)", async () => {
		await writeAllSkillsAt("agent-skills");
		const result = await loadBundledSkills(dir);
		expect(result.map((s) => s.id)).toEqual([...BUNDLED_SKILL_IDS]);
		for (const skill of result) {
			expect(skill.content).toBe(`body of ${skill.id}`);
		}
	});

	it("recovers via bounded recursive search when packaged in an unexpected subtree", async () => {
		await writeAllSkillsAt("misc", "bundled", "agent-skills");
		const result = await loadBundledSkills(dir);
		expect(result.map((s) => s.id)).toEqual([...BUNDLED_SKILL_IDS]);
		for (const skill of result) {
			expect(skill.content).toBe(`body of ${skill.id}`);
		}
	});

	it("throws a descriptive error when a skill is not packaged anywhere", async () => {
		await expect(loadBundledSkills(dir)).rejects.toThrow(
			new RegExp(BUNDLED_SKILL_IDS[0]),
		);
	});
});
