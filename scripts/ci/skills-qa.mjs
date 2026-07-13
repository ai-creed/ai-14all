#!/usr/bin/env node
/**
 * Skills QA gate for the bundled agent skills (assets/agent-skills):
 *  1. `shakespii lint --json` — errors fail, warnings are reported.
 *  2. `shakespii test --json` — deterministic harness checks must pass.
 *     Live LLM sweeps (`--run`) are deliberately excluded from CI; they are
 *     manual calibration campaigns.
 *  3. Every bundled SKILL.md must carry a parseable `version:` frontmatter.
 *  4. Version discipline: any content change in a skill directory since the
 *     last release tag requires a version bump (whole-dir scope).
 *
 * Requires full git history + tags (CI checks out with fetch-depth: 0).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_DIRS = [
	"assets/agent-skills/ai-14all-fix-review",
	"assets/agent-skills/ai-14all-session-status",
];

const VERSION_LINE = /^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/;

/**
 * Same minimal frontmatter scan as the installer's skill-version.ts: a
 * `version:` line only counts inside the opening frontmatter block, so CI
 * and the runtime guard agree on what "versioned" means. A `version:` in
 * the Markdown body does NOT satisfy this check.
 */
function parseSkillVersion(content) {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") return null;
		const m = VERSION_LINE.exec(lines[i]);
		if (m) return m[1];
	}
	return null;
}

let failed = false;
const fail = (msg) => {
	failed = true;
	console.error(`FAIL: ${msg}`);
};

function runShakespiiJson(args) {
	// shakespii may exit non-zero when it reports findings; the JSON on
	// stdout stays authoritative either way.
	let stdout;
	try {
		stdout = execFileSync("pnpm", ["exec", "shakespii", ...args], {
			encoding: "utf8",
		});
	} catch (err) {
		stdout = err.stdout ?? "";
		if (!stdout) {
			console.error(
				`FAIL: shakespii could not run (is the bun runtime installed? see skills-qa.yml setup-bun step): ${err.message}`,
			);
			process.exit(1);
		}
	}
	return JSON.parse(stdout);
}

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const lastTag = git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
console.log(`skills-qa: comparing against last release tag ${lastTag}`);

for (const dir of SKILL_DIRS) {
	const lint = runShakespiiJson(["lint", dir, "--json"]);
	if (lint.summary.errors > 0) {
		fail(`${dir}: shakespii lint reported ${lint.summary.errors} error(s)`);
	}
	if (lint.summary.warnings > 0) {
		console.warn(`WARN: ${dir}: ${lint.summary.warnings} lint warning(s)`);
	}

	const test = runShakespiiJson(["test", dir, "--json"]);
	const deterministic = test.stages.find((s) => s.stage === "deterministic");
	if (!deterministic || deterministic.status !== "pass") {
		fail(`${dir}: shakespii deterministic checks did not pass`);
	}
	if (test.summary.errors > 0) {
		fail(`${dir}: shakespii test reported ${test.summary.errors} error(s)`);
	}

	const skillMd = readFileSync(join(dir, "SKILL.md"), "utf8");
	const version = parseSkillVersion(skillMd);
	if (version === null) {
		fail(`${dir}/SKILL.md has no parseable version frontmatter`);
		continue;
	}

	let dirChanged = true;
	try {
		execFileSync("git", ["diff", "--quiet", lastTag, "--", dir]);
		dirChanged = false;
	} catch {
		dirChanged = true;
	}
	if (dirChanged) {
		let taggedVersion = null;
		try {
			const tagged = git(["show", `${lastTag}:${dir}/SKILL.md`]);
			taggedVersion = parseSkillVersion(tagged);
		} catch {
			taggedVersion = null; // skill (or its SKILL.md) did not exist at the tag
		}
		if (taggedVersion !== null && taggedVersion === version) {
			fail(
				`${dir}: content changed since ${lastTag} but version is still ${version} — bump the version frontmatter`,
			);
		}
	}
}

process.exit(failed ? 1 : 0);
