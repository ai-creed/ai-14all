import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const STABLE_PATTERN = /^\d+\.\d+\.\d+$/;

export function isStableSemver(value) {
	return STABLE_PATTERN.test(value);
}

export function parseCli(argv) {
	if (argv.length === 1 && ["patch", "minor", "major"].includes(argv[0])) {
		return { mode: "bump", bump: argv[0] };
	}
	if (argv.length === 2 && argv[0] === "--version") {
		return { mode: "explicit", version: argv[1] };
	}
	throw new Error(
		"usage: release-stable.mjs patch|minor|major | --version X.Y.Z",
	);
}

export function computeTargetVersion({ current, cli }) {
	if (cli.mode === "explicit") {
		if (!isStableSemver(cli.version)) {
			throw new Error(`target version must be strict semver: ${cli.version}`);
		}
		return cli.version;
	}
	if (!isStableSemver(current)) {
		throw new Error(
			`cannot bump from non-stable current version ${current}; use explicit --version X.Y.Z for the first stable cut`,
		);
	}
	const [major, minor, patch] = current.split(".").map(Number);
	if (cli.bump === "patch") return `${major}.${minor}.${patch + 1}`;
	if (cli.bump === "minor") return `${major}.${minor + 1}.0`;
	return `${major + 1}.0.0`;
}

export function rewriteVersionInPackageJson(text, version) {
	const parsed = JSON.parse(text);
	parsed.version = version;
	const next = JSON.stringify(parsed, null, "\t");
	return text.endsWith("\n") ? `${next}\n` : next;
}

function run(cmd, args, options = {}) {
	return execFileSync(cmd, args, {
		stdio: "pipe",
		encoding: "utf8",
		...options,
	}).trim();
}

export function main(argv = process.argv.slice(2)) {
	const cli = parseCli(argv);
	const status = run("git", ["status", "--porcelain"]);
	if (status !== "") throw new Error("working tree is not clean");
	const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch !== "master") throw new Error(`must be on master, got ${branch}`);
	const pkgText = readFileSync("package.json", "utf8");
	const current = JSON.parse(pkgText).version;
	const target = computeTargetVersion({ current, cli });

	// Local pre-flight
	run("pnpm", ["install", "--frozen-lockfile"], { stdio: "inherit" });
	run("pnpm", ["typecheck"], { stdio: "inherit" });
	run("pnpm", ["test"], { stdio: "inherit" });
	run("pnpm", ["package:mac"], { stdio: "inherit" });

	writeFileSync("package.json", rewriteVersionInPackageJson(pkgText, target));
	run("git", ["add", "package.json"]);
	run("git", ["commit", "-m", `chore: release v${target}`]);
	run("git", ["tag", "-a", `v${target}`, "-m", `Release v${target}`]);
	run("git", ["push", "--follow-tags"]);
	process.stdout.write(
		`cut v${target}. CI: https://github.com/ai-creed/ai-14all/actions\n`,
	);
	process.stdout.write(
		"If CI fails, roll back with: git push origin :refs/tags/v" +
			target +
			" && git revert HEAD && git push\n",
	);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	main();
}
