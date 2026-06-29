import { describe, expect, it } from "vitest";
import {
	assertAppSlices,
	assertUniversalSlices,
	discoverMacApps,
	parseLipoArchs,
} from "../../../../scripts/ci/assert-universal-slices.mjs";

// --- fakes ------------------------------------------------------------------
//
// Fake fs over a flat set of file paths plus the directory tree needed by the
// directory walkers (discoverMacApps reads release/ top-level; findBetterSqlite
// walks app.asar.unpacked). `dirs` maps a dir path to its entries; `files` is
// the set of existing file paths. `lipo` maps a file path to its arch tokens.

function makeEnv({
	dirs = {},
	files = [],
	lipo = {},
}: {
	dirs?: Record<string, Array<{ name: string; dir?: boolean }>>;
	files?: string[];
	lipo?: Record<string, string>;
}) {
	const fileSet = new Set(files);
	const dirSet = new Set(Object.keys(dirs));
	return {
		existsSync: (p: string) => fileSet.has(p) || dirSet.has(p),
		readdirSync: (p: string) =>
			(dirs[p] ?? []).map((e: { name: string; dir?: boolean }) => ({
				name: e.name,
				isDirectory: () => Boolean(e.dir),
			})),
		runLipo: (p: string) => {
			if (!(p in lipo)) throw new Error(`fake lipo: no entry for ${p}`);
			return lipo[p];
		},
	};
}

const PRODUCT = "ai-14all";

// Build the standard packaged-app file/dir layout for one arch's .app, given
// the slice strings for each binary. Returns { dirs, files, lipo } fragments.
function appLayout(releaseDir: string, macDir: string, slices: {
	mainExe: string;
	sqlite: string;
	ptyX64?: string;
	helperX64?: string;
	ptyArm64?: string;
	helperArm64?: string;
}) {
	const app = `${releaseDir}/${macDir}/${PRODUCT}.app`;
	const res = `${app}/Contents/Resources`;
	const unpacked = `${res}/app.asar.unpacked`;
	const sqliteDir = `${unpacked}/node_modules/better-sqlite3/build/Release`;
	const ptyPrebuilds = `${unpacked}/node_modules/node-pty/prebuilds`;
	const mainExe = `${app}/Contents/MacOS/${PRODUCT}`;
	const sqlite = `${sqliteDir}/better_sqlite3.node`;

	const files: string[] = [mainExe, sqlite];
	const lipo: Record<string, string> = {
		[mainExe]: slices.mainExe,
		[sqlite]: slices.sqlite,
	};
	const dirs: Record<string, Array<{ name: string; dir?: boolean }>> = {
		[unpacked]: [{ name: "node_modules", dir: true }],
		[`${unpacked}/node_modules`]: [
			{ name: "better-sqlite3", dir: true },
			{ name: "node-pty", dir: true },
		],
		[`${unpacked}/node_modules/better-sqlite3`]: [{ name: "build", dir: true }],
		[`${unpacked}/node_modules/better-sqlite3/build`]: [
			{ name: "Release", dir: true },
		],
		[sqliteDir]: [{ name: "better_sqlite3.node" }],
	};

	const addPty = (archDir: string, pty?: string, helper?: string) => {
		if (!pty) return;
		const dir = `${ptyPrebuilds}/${archDir}`;
		const ptyFile = `${dir}/pty.node`;
		const helperFile = `${dir}/spawn-helper`;
		files.push(ptyFile, helperFile);
		lipo[ptyFile] = pty;
		if (helper) lipo[helperFile] = helper;
	};
	addPty("darwin-x64", slices.ptyX64, slices.helperX64);
	addPty("darwin-arm64", slices.ptyArm64, slices.helperArm64);

	return { app, files, lipo, dirs };
}

describe("assert-universal-slices", () => {
	it("parses lipo -archs output into a slice set", () => {
		expect(parseLipoArchs("x86_64 arm64\n")).toEqual(
			new Set(["x86_64", "arm64"]),
		);
		expect(parseLipoArchs("arm64\n")).toEqual(new Set(["arm64"]));
	});

	it("discovers universal and arm64 apps from release/mac-* dirs", () => {
		const env = makeEnv({
			dirs: {
				release: [
					{ name: "mac-universal", dir: true },
					{ name: "mac-arm64", dir: true },
					{ name: "latest-mac.yml" },
				],
			},
			files: [
				`release/mac-universal/${PRODUCT}.app`,
				`release/mac-arm64/${PRODUCT}.app`,
			],
		});
		const apps = discoverMacApps({
			releaseDir: "release",
			productFilename: PRODUCT,
			existsSync: env.existsSync,
			readdirSync: env.readdirSync,
		});
		expect(apps).toEqual([
			{ kind: "universal", appPath: `release/mac-universal/${PRODUCT}.app` },
			{ kind: "arm64", appPath: `release/mac-arm64/${PRODUCT}.app` },
		]);
	});

	it("passes a well-formed universal app: fat single-path bins, thin-per-arch node-pty", () => {
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "x86_64 arm64",
			ptyX64: "x86_64",
			helperX64: "x86_64",
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).not.toThrow();
	});

	it("does NOT require node-pty to be fat (regression guard for this finding)", () => {
		// node-pty prebuilds are thin-per-arch; a thin x86_64 pty.node in the x64
		// dir must PASS, never be rejected for "not fat".
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "x86_64 arm64",
			ptyX64: "x86_64", // thin — correct, must pass
			helperX64: "x86_64",
			ptyArm64: "arm64", // thin — correct, must pass
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).not.toThrow();
	});

	it("fails when the universal better_sqlite3.node is missing the x86_64 slice", () => {
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "arm64", // thin arm64 — x64 cross-compile silently failed
			ptyX64: "x86_64",
			helperX64: "x86_64",
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).toThrow(/better_sqlite3\.node is missing the x86_64 slice/);
	});

	it("fails when the universal node-pty darwin-x64 prebuild file is missing on disk", () => {
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "x86_64 arm64",
			// no ptyX64 / helperX64 → darwin-x64 files absent
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).toThrow(/node-pty darwin-x64\/pty\.node missing on disk/);
	});

	it("fails when a node-pty darwin-x64 file carries the wrong slice", () => {
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "x86_64 arm64",
			ptyX64: "arm64", // wrong: x64 dir holding an arm64 binary
			helperX64: "x86_64",
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).toThrow(/node-pty darwin-x64\/pty\.node is missing the x86_64 slice/);
	});

	it("REJECTS a fat node-pty prebuild file (must be thin per arch, not fat)", () => {
		// node-pty selects prebuilds/darwin-${process.arch}/ at runtime, so its
		// binaries must be thin per arch. A fat darwin-x64/pty.node (x86_64 + arm64)
		// is a layout violation and must fail the gate — this is the forbidden case
		// the spec's "each carrying only its own arch slice" rule exists to catch.
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "x86_64 arm64",
			ptyX64: "x86_64 arm64", // WRONG: fat — must be rejected
			helperX64: "x86_64",
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).toThrow(/node-pty darwin-x64\/pty\.node must be thin .* but is fat/);
	});

	it("REJECTS a fat node-pty spawn-helper (exact-thin applies to spawn-helper too)", () => {
		// The exact-thin rule covers BOTH node-pty files. Keep pty.node thin so the
		// gate gets past it and reaches spawn-helper, then make spawn-helper fat: an
		// implementation that enforced exact only on pty.node would wrongly pass.
		const l = appLayout("release", "mac-universal", {
			mainExe: "x86_64 arm64",
			sqlite: "x86_64 arm64",
			ptyX64: "x86_64", // thin — valid, lets the gate reach spawn-helper
			helperX64: "x86_64 arm64", // WRONG: fat spawn-helper — must be rejected
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "universal", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).toThrow(/node-pty darwin-x64\/spawn-helper must be thin .* but is fat/);
	});

	it("passes a well-formed arm64 app (single-path bins arm64; arm64 prebuild present)", () => {
		const l = appLayout("release", "mac-arm64", {
			mainExe: "arm64",
			sqlite: "arm64",
			ptyArm64: "arm64",
			helperArm64: "arm64",
		});
		const env = makeEnv({ dirs: l.dirs, files: l.files, lipo: l.lipo });
		expect(() =>
			assertAppSlices({
				app: { kind: "arm64", appPath: l.app },
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).not.toThrow();
	});

	it("assertUniversalSlices throws when the universal app is absent", () => {
		const env = makeEnv({
			dirs: { release: [{ name: "mac-arm64", dir: true }] },
			files: [`release/mac-arm64/${PRODUCT}.app`],
		});
		expect(() =>
			assertUniversalSlices({
				releaseDir: "release",
				productFilename: PRODUCT,
				runLipo: env.runLipo,
				existsSync: env.existsSync,
				readdirSync: env.readdirSync,
			}),
		).toThrow(/expected a universal \.app/);
	});
});
