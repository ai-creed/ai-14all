const BETA_BASE = "0.1.0";
const BETA_TAG_PATTERN = /^v0\.1\.0-beta\.(\d+)$/;

export function parseBetaTag(tag) {
	const match = BETA_TAG_PATTERN.exec(tag);
	if (!match) return null;
	return {
		tag,
		version: tag.slice(1),
		sequence: Number(match[1]),
	};
}

export function computeNextBetaVersion(tags) {
	const sequences = tags
		.map(parseBetaTag)
		.filter(Boolean)
		.map((entry) => entry.sequence);
	const nextSequence = sequences.length === 0 ? 1 : Math.max(...sequences) + 1;
	return `${BETA_BASE}-beta.${nextSequence}`;
}

/**
 * Returns the first beta tag pointing at HEAD that matches the pattern.
 * If multiple matching beta tags point at the same HEAD commit, returns the first one
 * found in the input array (deterministic based on git tag output order).
 */
export function findHeadBetaTag(tagsPointingAtHead) {
	return tagsPointingAtHead.find((tag) => parseBetaTag(tag) !== null) ?? null;
}

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export function createReleasePlan({ headTags, allTags }) {
	const headTag = findHeadBetaTag(headTags);
	if (headTag) {
		return {
			mode: "rebuild",
			version: headTag.slice(1),
			tag: headTag,
		};
	}
	const version = computeNextBetaVersion(allTags);
	return {
		mode: "new-release",
		version,
		tag: `v${version}`,
	};
}

export function updatePackageJsonVersion(packageJsonText, version) {
	const parsed = JSON.parse(packageJsonText);
	parsed.version = version;
	const next = JSON.stringify(parsed, null, "\t");
	return packageJsonText.endsWith("\n") ? `${next}\n` : next;
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		stdio: "pipe",
		encoding: "utf8",
		...options,
	}).trim();
}

export function main() {
	const status = run("git", ["status", "--porcelain"]);
	if (status !== "") {
		throw new Error("Release requires a clean working tree.");
	}

	const headTags = run("git", ["tag", "--points-at", "HEAD"])
		.split("\n")
		.filter(Boolean);
	const allTags = run("git", ["tag", "--list", "v0.1.0-beta.*"])
		.split("\n")
		.filter(Boolean);
	const plan = createReleasePlan({ headTags, allTags });

	if (plan.mode === "new-release") {
		const nextPackageJson = updatePackageJsonVersion(
			readFileSync("package.json", "utf8"),
			plan.version,
		);
		writeFileSync("package.json", nextPackageJson);
		run("git", ["add", "package.json"]);
		run("git", ["commit", "-m", `chore: release ${plan.tag}`]);
	}

	run("pnpm", ["test"], { stdio: "inherit" });
	run("pnpm", ["typecheck"], { stdio: "inherit" });
	run("pnpm", ["test:e2e"], { stdio: "inherit" });
	run("pnpm", ["package:mac"], { stdio: "inherit" });

	if (plan.mode === "new-release") {
		run("git", ["tag", plan.tag]);
	}

	process.stdout.write(
		`${JSON.stringify({ version: plan.version, tag: plan.tag, mode: plan.mode, outputDir: "release" }, null, 2)}\n`,
	);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	main();
}
