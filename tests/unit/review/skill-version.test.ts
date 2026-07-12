// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseSkillVersion,
	compareSemver,
	decideSkillAction,
	composeInstallMessage,
	guardedWriteSkill,
	removeInstalledSkill,
} from "../../../services/review/agent-skill-installer/skill-version.js";

function skillMd(version: string | null, body: string): string {
	const versionLine = version === null ? "" : `version: ${version}\n`;
	return `---\nname: stub\n${versionLine}---\n\n${body}\n`;
}

describe("parseSkillVersion", () => {
	it("extracts a plain semver from frontmatter", () => {
		expect(parseSkillVersion(skillMd("0.1.0", "x"))).toBe("0.1.0");
	});
	it("extracts a quoted semver", () => {
		expect(parseSkillVersion(`---\nversion: "1.2.3"\n---\nx`)).toBe("1.2.3");
	});
	it("returns null when there is no frontmatter", () => {
		expect(parseSkillVersion("# just markdown\nversion: 1.0.0\n")).toBeNull();
	});
	it("returns null when frontmatter has no version line", () => {
		expect(parseSkillVersion(skillMd(null, "x"))).toBeNull();
	});
	it("returns null for a non-semver version value", () => {
		expect(parseSkillVersion(`---\nversion: latest\n---\nx`)).toBeNull();
	});
	it("ignores a version line after the frontmatter closes", () => {
		expect(parseSkillVersion(`---\nname: stub\n---\nversion: 1.0.0\n`)).toBeNull();
	});
});

describe("compareSemver", () => {
	it("orders majors, minors, and patches numerically", () => {
		expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
		expect(compareSemver("0.2.0", "0.10.0")).toBe(-1);
		expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
		expect(compareSemver("0.1.2", "0.1.10")).toBe(-1);
	});
});

describe("decideSkillAction", () => {
	const bundled = skillMd("0.1.0", "bundled");
	it("installs when the destination is missing", () => {
		expect(decideSkillAction(bundled, null)).toBe("install");
	});
	it("installs over an unversioned installed copy", () => {
		expect(decideSkillAction(bundled, skillMd(null, "old"))).toBe("install");
	});
	it("protects a versioned install from an unversioned bundle", () => {
		expect(decideSkillAction(skillMd(null, "b"), skillMd("0.1.0", "i"))).toBe(
			"skipped-newer",
		);
	});
	it("upgrades when bundled is newer", () => {
		expect(decideSkillAction(bundled, skillMd("0.0.9", "i"))).toBe("install");
	});
	it("reports up-to-date on equal versions", () => {
		expect(decideSkillAction(bundled, skillMd("0.1.0", "i"))).toBe("up-to-date");
	});
	it("skips when bundled is older", () => {
		expect(decideSkillAction(bundled, skillMd("0.2.0", "i"))).toBe(
			"skipped-newer",
		);
	});
});

describe("composeInstallMessage", () => {
	it("returns null when every skill was installed", () => {
		expect(
			composeInstallMessage([
				{ id: "a", action: "install" },
				{ id: "b", action: "install" },
			]),
		).toBeNull();
	});
	it("collapses all-up-to-date to a single message", () => {
		expect(
			composeInstallMessage([
				{ id: "a", action: "up-to-date" },
				{ id: "b", action: "up-to-date" },
			]),
		).toBe("Already up to date");
	});
	it("lists per-skill statuses for mixed outcomes", () => {
		expect(
			composeInstallMessage([
				{ id: "a", action: "up-to-date" },
				{ id: "b", action: "install" },
			]),
		).toBe("a: up to date; b: installed");
	});
	it("labels skipped-newer with the exact status text", () => {
		expect(
			composeInstallMessage([
				{ id: "a", action: "skipped-newer" },
				{ id: "b", action: "install" },
			]),
		).toBe("a: skipped — newer version installed; b: installed");
	});
});

describe("guardedWriteSkill / removeInstalledSkill", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "skill-version-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("writes SKILL.md when the destination is missing", async () => {
		const skillDir = join(dir, "my-skill");
		const action = await guardedWriteSkill(skillDir, {
			id: "my-skill",
			content: skillMd("0.1.0", "bundled"),
		});
		expect(action).toBe("install");
		expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(
			skillMd("0.1.0", "bundled"),
		);
	});

	it("leaves the destination byte-untouched on a skip", async () => {
		const skillDir = join(dir, "my-skill");
		await mkdir(skillDir, { recursive: true });
		const installed = skillMd("0.2.0", "local");
		await writeFile(join(skillDir, "SKILL.md"), installed, "utf-8");
		const action = await guardedWriteSkill(skillDir, {
			id: "my-skill",
			content: skillMd("0.1.0", "bundled"),
		});
		expect(action).toBe("skipped-newer");
		expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(installed);
	});

	it("removeInstalledSkill deletes SKILL.md but preserves evals and the dir", async () => {
		const skillDir = join(dir, "my-skill");
		await mkdir(join(skillDir, "evals"), { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "x", "utf-8");
		await writeFile(join(skillDir, "evals", "evals.json"), "{}", "utf-8");
		await removeInstalledSkill(skillDir);
		await expect(access(join(skillDir, "SKILL.md"))).rejects.toBeTruthy();
		expect(await readFile(join(skillDir, "evals", "evals.json"), "utf-8")).toBe(
			"{}",
		);
	});

	it("removeInstalledSkill removes the dir when only SKILL.md was inside", async () => {
		const skillDir = join(dir, "my-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "x", "utf-8");
		await removeInstalledSkill(skillDir);
		await expect(access(skillDir)).rejects.toBeTruthy();
	});

	it("removeInstalledSkill also removes a stray install tmp file", async () => {
		const skillDir = join(dir, "my-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "x", "utf-8");
		await writeFile(join(skillDir, "SKILL.md.ai-14all.tmp"), "t", "utf-8");
		await removeInstalledSkill(skillDir);
		await expect(access(skillDir)).rejects.toBeTruthy();
	});

	it("removeInstalledSkill succeeds when the dir is missing", async () => {
		await expect(
			removeInstalledSkill(join(dir, "never-existed")),
		).resolves.toBeUndefined();
	});
});
