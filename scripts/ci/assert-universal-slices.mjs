#!/usr/bin/env node
// Static slice gate for the macOS universal + arm64 build. Runs in release.yml
// AFTER packaging and BEFORE publish. Asserts, via `lipo -archs`, that each
// packaged .app carries the CPU slices its distribution promises — catching a
// silently-failed x64 cross-compile that the arch-blind afterPack ABI guard
// (which reads NODE_MODULE_VERSION, identical across CPU arches) cannot see.
//
// Two native-module layouts are checked DIFFERENTLY (see the design spec
// docs/superpowers/specs/2026-06-29-mac-intel-universal-build-design.md §5.3):
//
//   (a) Single-path, lipo-merged binaries — the main executable and
//       better_sqlite3.node (one fixed path, no prebuilds/ dir). @electron/
//       universal lipo-merges these into one fat Mach-O. Universal → must be
//       fat (x86_64 + arm64); arm64 → must contain arm64.
//
//   (b) node-pty per-arch prebuilds — node-pty's loader selects
//       prebuilds/${process.platform}-${process.arch}/ at runtime
//       (node-pty/lib/utils.js) and derives spawn-helper from that selected dir
//       (node-pty/lib/unixTerminal.js). The shipped prebuilds are thin-per-arch
//       and BOTH dirs ship side by side. Universal → both
//       prebuilds/darwin-x64/{pty.node,spawn-helper} (thin x86_64) and
//       prebuilds/darwin-arm64/{pty.node,spawn-helper} (thin arm64) present.
//       Never require these to be fat — that would break the runtime lookup.

import { execFileSync } from "node:child_process";
import {
	existsSync as defaultExistsSync,
	readdirSync as defaultReaddirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { findBetterSqliteBinary } from "../electron-builder-after-pack.mjs";

export function defaultRunLipo(file) {
	return execFileSync("lipo", ["-archs", file], { encoding: "utf8" });
}

export function parseLipoArchs(stdout) {
	return new Set(stdout.trim().split(/\s+/).filter(Boolean));
}

// electron-builder writes each mac arch to release/mac-<arch>/<product>.app:
//   universal -> release/mac-universal/<product>.app
//   arm64     -> release/mac-arm64/<product>.app
export function discoverMacApps({
	releaseDir,
	productFilename,
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
}) {
	if (!existsSync(releaseDir)) return [];
	const apps = [];
	for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith("mac")) continue;
		const kind = entry.name.includes("universal")
			? "universal"
			: entry.name.includes("arm64")
				? "arm64"
				: null;
		if (!kind) continue;
		const appPath = join(releaseDir, entry.name, `${productFilename}.app`);
		if (existsSync(appPath)) apps.push({ kind, appPath });
	}
	return apps;
}

function resourcesDir(appPath) {
	return join(appPath, "Contents", "Resources");
}

function mainExecutablePath(appPath, productFilename) {
	return join(appPath, "Contents", "MacOS", productFilename);
}

function nodePtyPrebuildFile(appPath, arch, file) {
	return join(
		resourcesDir(appPath),
		"app.asar.unpacked",
		"node_modules",
		"node-pty",
		"prebuilds",
		`darwin-${arch}`,
		file,
	);
}

// Assert `file` exists and its lipo slices include every token in `required`.
// When `exact` is true, the file must carry ONLY those slices (no extras) — this
// is how the node-pty per-arch prebuilds are enforced as thin-per-arch: a fat
// darwin-x64/pty.node (x86_64 + arm64) is REJECTED, because node-pty selects its
// prebuild dir by process.arch at runtime and the layout must stay thin per arch.
function assertSlices({
	file,
	required,
	exact = false,
	runLipo,
	existsSync,
	label,
}) {
	if (!existsSync(file)) {
		throw new Error(`slice gate: ${label} missing on disk: ${file}`);
	}
	const archs = parseLipoArchs(runLipo(file));
	for (const want of required) {
		if (!archs.has(want)) {
			throw new Error(
				`slice gate: ${label} is missing the ${want} slice ` +
					`(has: ${[...archs].join(", ") || "none"}): ${file}`,
			);
		}
	}
	if (exact && archs.size !== required.length) {
		throw new Error(
			`slice gate: ${label} must be thin (exactly ${required.join("+")}) ` +
				`but is fat (has: ${[...archs].join(", ")}): ${file}`,
		);
	}
	return archs;
}

export function assertAppSlices({
	app,
	productFilename,
	runLipo = defaultRunLipo,
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
}) {
	const { kind, appPath } = app;
	const unpackedDir = join(resourcesDir(appPath), "app.asar.unpacked");

	// (a) single-path, lipo-merged binaries: fat for universal, arm64 for arm64.
	const required = kind === "universal" ? ["x86_64", "arm64"] : ["arm64"];

	assertSlices({
		file: mainExecutablePath(appPath, productFilename),
		required,
		runLipo,
		existsSync,
		label: `${kind} main executable`,
	});

	const sqlite = findBetterSqliteBinary(unpackedDir, {
		existsSync,
		readdirSync,
	});
	if (!sqlite) {
		throw new Error(
			`slice gate: better_sqlite3.node not found under ${unpackedDir} (${kind} app)`,
		);
	}
	assertSlices({
		file: sqlite,
		required,
		runLipo,
		existsSync,
		label: `${kind} better_sqlite3.node`,
	});

	// (b) node-pty per-arch prebuilds: thin-per-arch, never fat. Universal ships
	// both darwin-x64 and darwin-arm64; arm64 ships at least darwin-arm64.
	// `exact: true` enforces a SINGLE slice — a fat node-pty binary is rejected.
	const ptyArches = kind === "universal" ? ["x64", "arm64"] : ["arm64"];
	for (const a of ptyArches) {
		const want = a === "x64" ? "x86_64" : "arm64";
		for (const bin of ["pty.node", "spawn-helper"]) {
			assertSlices({
				file: nodePtyPrebuildFile(appPath, a, bin),
				required: [want], // single thin slice — must be exactly this arch
				exact: true, // reject fat: node-pty must stay thin per arch
				runLipo,
				existsSync,
				label: `${kind} node-pty darwin-${a}/${bin}`,
			});
		}
	}

	// (c) node-pty MUST load the committed per-arch prebuilds asserted in (b), so
	// its from-source build output must be ABSENT from the package. node-pty's
	// loader (lib/utils.js) checks build/Release and build/Debug BEFORE
	// prebuilds/${platform}-${arch}, so a packaged build/ binary would shadow the
	// prebuild this gate just validated — and on the universal app that build/
	// binary is a single fat (or worse, single-arch) file, defeating the whole
	// point. electron-builder.yml excludes node_modules/node-pty/{build,bin}; this
	// asserts that exclusion actually held in the packaged app.
	for (const variant of ["build/Release", "build/Debug"]) {
		const shadow = join(
			unpackedDir,
			"node_modules",
			"node-pty",
			...variant.split("/"),
			"pty.node",
		);
		if (existsSync(shadow)) {
			throw new Error(
				`slice gate: ${kind} app ships node-pty ${variant}/pty.node, which shadows the ` +
					`validated prebuilds/darwin-<arch>/ binary at runtime (node-pty loads ${variant} ` +
					"before prebuilds/). Exclude node_modules/node-pty/{build,bin} in electron-builder.yml. " +
					`Found: ${shadow}`,
			);
		}
	}
}

export function assertUniversalSlices({
	releaseDir,
	productFilename,
	runLipo = defaultRunLipo,
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
}) {
	const apps = discoverMacApps({
		releaseDir,
		productFilename,
		existsSync,
		readdirSync,
	});
	const kinds = new Set(apps.map((a) => a.kind));
	for (const expectedKind of ["universal", "arm64"]) {
		if (!kinds.has(expectedKind)) {
			throw new Error(
				`slice gate: expected a ${expectedKind} .app under ${releaseDir}/mac-* ` +
					`but found: ${[...kinds].join(", ") || "none"}`,
			);
		}
	}
	for (const app of apps) {
		assertAppSlices({ app, productFilename, runLipo, existsSync, readdirSync });
	}
	return { checked: apps.map((a) => a.kind) };
}

function main() {
	const releaseDir = process.argv[2] || "release";
	const productFilename = process.argv[3] || "ai-14all";
	const { checked } = assertUniversalSlices({ releaseDir, productFilename });
	process.stdout.write(`slice gate passed for: ${checked.join(", ")}\n`);
}

// Run only when invoked directly, not when imported by the unit tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (err) {
		process.stderr.write(`${err.message}\n`);
		process.exit(1);
	}
}
