#!/usr/bin/env node
// Rebuilds better-sqlite3 against the host Node ABI after `pnpm test:e2e`
// switched it to Electron's ABI. Required so the unit suite (which runs in
// host Node via vitest) can load the native binary.
//
// Idempotent: if better-sqlite3 isn't installed, exits silently.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url)).replace(
	/\/scripts$/,
	"",
);

function findPkgDir() {
	// pnpm hoists into node_modules/.pnpm/better-sqlite3@<ver>/node_modules/better-sqlite3
	try {
		const out = execFileSync(
			"find",
			[
				join(repoRoot, "node_modules"),
				"-type",
				"d",
				"-name",
				"better-sqlite3",
				"-maxdepth",
				"6",
			],
			{ encoding: "utf8" },
		).trim();
		const candidates = out
			.split("\n")
			.filter((p) => p && existsSync(join(p, "binding.gyp")));
		return candidates[0] ?? null;
	} catch {
		return null;
	}
}

const pkgDir = findPkgDir();
if (!pkgDir) {
	console.log("[rebuild-better-sqlite3-host] package not installed, skipping");
	process.exit(0);
}

// Target the running host Node ABI explicitly. node-gyp may otherwise re-use
// the Electron target cached by a prior `electron-rebuild` (it persists
// headers under ~/.electron-gyp/).
const target = process.versions.node;
const dist = "https://nodejs.org/dist";

// Strip env vars that pnpm injects when running scripts after `pnpm install`
// — npm_config_target and friends pin node-gyp to Electron's headers.
const cleanEnv = { ...process.env };
for (const k of Object.keys(cleanEnv)) {
	if (
		/^npm_config_(target|dist_url|runtime|build_from_source|arch|disturl)/.test(
			k,
		)
	)
		delete cleanEnv[k];
}
cleanEnv.npm_config_runtime = "node";
cleanEnv.npm_config_target = target;
cleanEnv.npm_config_dist_url = dist;

try {
	// Use pnpm rebuild which routes through npm's lifecycle scripts; the
	// package's own install script honours npm_config_runtime/target so
	// pre-built binaries can be downloaded matching the host Node ABI.
	execFileSync("pnpm", ["rebuild", "better-sqlite3"], {
		cwd: repoRoot,
		stdio: "inherit",
		env: cleanEnv,
	});
	console.log(`[rebuild-better-sqlite3-host] ok (node ${target})`);
} catch (err) {
	console.warn(
		`[rebuild-better-sqlite3-host] rebuild failed: ${err.message ?? err}`,
	);
}
