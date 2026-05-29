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

try {
	execFileSync("npx", ["--yes", "node-gyp", "rebuild"], {
		cwd: pkgDir,
		stdio: "inherit",
	});
	console.log("[rebuild-better-sqlite3-host] ok");
} catch (err) {
	console.warn(
		`[rebuild-better-sqlite3-host] rebuild failed: ${err.message ?? err}`,
	);
}
