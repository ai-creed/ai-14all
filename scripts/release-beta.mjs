import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

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
 * Returns the beta tag with the highest sequence number from tags pointing at HEAD.
 * If multiple matching beta tags point at the same HEAD commit, returns the one with
 * the highest sequence number rather than relying on git output order.
 */
export function findHeadBetaTag(tagsPointingAtHead) {
	const parsed = tagsPointingAtHead.map(parseBetaTag).filter(Boolean);
	if (parsed.length === 0) return null;
	return parsed.reduce((best, current) =>
		current.sequence > best.sequence ? current : best,
	).tag;
}

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
	const result = execFileSync(command, args, {
		stdio: "pipe",
		encoding: "utf8",
		...options,
	});
	return result == null ? "" : result.trim();
}

export function isWorkingTreeClean(statusOutput) {
	return statusOutput.trim() === "";
}

export function main() {
	const status = run("git", ["status", "--porcelain"]);
	if (!isWorkingTreeClean(status)) {
		throw new Error("Release requires a clean working tree.");
	}

	const headTags = run("git", ["tag", "--points-at", "HEAD"])
		.split("\n")
		.filter(Boolean);
	const allTags = run("git", ["tag", "--list", "v0.1.0-beta.*"])
		.split("\n")
		.filter(Boolean);
	const plan = createReleasePlan({ headTags, allTags });

	// Version bump is committed before the test pipeline. If the pipeline fails,
	// reset with: git reset HEAD~1 (soft) to recover the clean state.
	// If package.json already has the target version (interrupted run), this block
	// is skipped and the script proceeds directly to verification and tagging.
	if (plan.mode === "new-release") {
		const currentText = readFileSync("package.json", "utf8");
		const nextPackageJson = updatePackageJsonVersion(currentText, plan.version);

		if (nextPackageJson !== currentText) {
			writeFileSync("package.json", nextPackageJson);
			run("git", ["add", "package.json"]);
			run("git", ["commit", "-m", `chore: release ${plan.tag}`]);
		}
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
