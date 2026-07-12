import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BundledSkill } from "./skill-asset.js";

/**
 * Guard decision / write outcome (spec §5.2 literals). "install" means the
 * bundled copy is (or was) written; the user-facing "installed" label is
 * applied only in composeInstallMessage.
 */
export type SkillAction = "install" | "up-to-date" | "skipped-newer";

export type SkillInstallOutcome = { id: string; action: SkillAction };

const SKILL_FILENAME = "SKILL.md";
const TMP_FILENAME = "SKILL.md.ai-14all.tmp";
const VERSION_LINE = /^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/;

/**
 * Minimal frontmatter scan for the `version:` line — deliberately not a YAML
 * parser. Returns null for anything that isn't a plain X.Y.Z inside an
 * opening frontmatter block; the guard treats null as "unversioned".
 */
export function parseSkillVersion(content: string): string | null {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") return null;
		const m = VERSION_LINE.exec(lines[i]);
		if (m) return m[1];
	}
	return null;
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if (pa[i] > pb[i]) return 1;
		if (pa[i] < pb[i]) return -1;
	}
	return 0;
}

/**
 * The guard table (spec §5.2). "install" means "write it"; the two skip
 * variants leave the destination untouched. An unversioned installed copy is
 * treated as older by design; an unversioned BUNDLED copy never overwrites a
 * versioned install (defensive — CI asserts bundled versions exist).
 */
export function decideSkillAction(
	bundledContent: string,
	installedContent: string | null,
): SkillAction {
	if (installedContent === null) return "install";
	const installed = parseSkillVersion(installedContent);
	if (installed === null) return "install";
	const bundled = parseSkillVersion(bundledContent);
	if (bundled === null) return "skipped-newer";
	const cmp = compareSemver(bundled, installed);
	if (cmp > 0) return "install";
	if (cmp === 0) return "up-to-date";
	return "skipped-newer";
}

const ACTION_LABEL: Record<SkillAction, string> = {
	install: "installed",
	"up-to-date": "up to date",
	"skipped-newer": "skipped — newer version installed",
};

/**
 * Per-provider status message from per-skill outcomes. Null (= the UI's
 * plain "Installed" rendering) only when every skill was actually written;
 * a skip is always surfaced ("failure honesty" rule).
 */
export function composeInstallMessage(
	outcomes: SkillInstallOutcome[],
): string | null {
	if (outcomes.every((o) => o.action === "install")) return null;
	if (outcomes.every((o) => o.action === "up-to-date")) {
		return "Already up to date";
	}
	return outcomes.map((o) => `${o.id}: ${ACTION_LABEL[o.action]}`).join("; ");
}

/**
 * Version-guarded SKILL.md write shared by all providers. Reads the
 * currently installed copy (missing or unreadable both count as absent),
 * applies the guard table, and only on "install" performs the atomic
 * tmp-write + rename. A skip performs zero writes.
 */
export async function guardedWriteSkill(
	dir: string,
	skill: BundledSkill,
): Promise<SkillAction> {
	let installed: string | null = null;
	try {
		installed = await readFile(join(dir, SKILL_FILENAME), "utf-8");
	} catch {
		installed = null;
	}
	const action = decideSkillAction(skill.content, installed);
	if (action !== "install") return action;
	await mkdir(dir, { recursive: true });
	const tmp = join(dir, TMP_FILENAME);
	await writeFile(tmp, skill.content, "utf-8");
	await rename(tmp, join(dir, SKILL_FILENAME));
	return "install";
}

/**
 * Uninstall counterpart of guardedWriteSkill: remove only what install
 * writes (SKILL.md plus a stray tmp from an interrupted install), then
 * remove the directory only when that left it empty. Files the app never
 * wrote — e.g. locally installed evals/ — survive.
 */
export async function removeInstalledSkill(dir: string): Promise<void> {
	await rm(join(dir, SKILL_FILENAME), { force: true });
	await rm(join(dir, TMP_FILENAME), { force: true });
	try {
		await rmdir(dir);
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code !== "ENOENT" && code !== "ENOTEMPTY") throw err;
	}
}
