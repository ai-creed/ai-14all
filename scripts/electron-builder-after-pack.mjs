import {
	chmodSync as defaultChmodSync,
	existsSync as defaultExistsSync,
	readdirSync as defaultReaddirSync,
	readFileSync as defaultReadFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, sep } from "node:path";
import { Arch } from "builder-util";

const localRequire = createRequire(import.meta.url);

export function resolvePackagedArch(arch) {
	return arch === Arch.arm64 ? "arm64" : "x64";
}

export function getPackagedResourcesDir({
	appOutDir,
	productFilename,
	platform = process.platform,
}) {
	if (platform === "darwin") {
		return join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
	}
	// Windows + Linux: electron-builder emits a flat `resources/` dir.
	return join(appOutDir, "resources");
}

export function getPackagedNodePtySpawnHelperPath({
	appOutDir,
	productFilename,
	arch,
	platform = process.platform,
}) {
	return join(
		getPackagedResourcesDir({ appOutDir, productFilename, platform }),
		"app.asar.unpacked",
		"node_modules",
		"node-pty",
		"prebuilds",
		`darwin-${arch}`,
		"spawn-helper",
	);
}

export function ensurePackagedNodePtySpawnHelperExecutable({
	appOutDir,
	productFilename,
	arch,
	platform = process.platform,
	existsSync = defaultExistsSync,
	chmodSync = defaultChmodSync,
}) {
	const helperPath = getPackagedNodePtySpawnHelperPath({
		appOutDir,
		productFilename,
		arch,
		platform,
	});
	if (!existsSync(helperPath)) return false;
	chmodSync(helperPath, 0o755);
	return true;
}

// --- better-sqlite3 native-ABI guard ---------------------------------------
//
// The shipped better_sqlite3.node must be compiled against the bundled
// Electron's NODE_MODULE_VERSION, not the host Node's. electron-builder's
// auto-rebuild normally handles this, but there is no safety net: a stale
// host-ABI binary (e.g. left over from a `vitest` host rebuild) would package
// cleanly and then crash for EVERY user on the first DB use (cmd+click, symbol
// search). node-pty already has an afterPack assertion; this gives
// better-sqlite3 the same protection — abort packaging on any mismatch.

export function getPackagedAsarUnpackedDir({
	appOutDir,
	productFilename,
	platform = process.platform,
}) {
	return join(
		getPackagedResourcesDir({ appOutDir, productFilename, platform }),
		"app.asar.unpacked",
	);
}

export function findBetterSqliteBinary(
	unpackedDir,
	{ existsSync = defaultExistsSync, readdirSync = defaultReaddirSync } = {},
) {
	if (!existsSync(unpackedDir)) return null;
	const stack = [unpackedDir];
	while (stack.length > 0) {
		const dir = stack.pop();
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.name === "better_sqlite3.node") return full;
		}
	}
	return null;
}

// Non-N-API native modules export a `node_register_module_v<NODE_MODULE_VERSION>`
// symbol; reading it tells us the ABI the binary was built for without having
// to dlopen it under a mismatched runtime (which would just throw).
export function readNativeModuleAbi(
	binaryPath,
	{ readFileSync = defaultReadFileSync } = {},
) {
	const buf = readFileSync(binaryPath);
	const match = buf.toString("latin1").match(/node_register_module_v(\d+)/);
	return match ? Number(match[1]) : null;
}

function defaultGetAbi(version, runtime) {
	// node-abi is a transitive dep of @electron/rebuild (a direct devDep);
	// resolve it through there rather than relying on hoisting. Lazy so the
	// module imports cleanly even where node-abi is absent (unit tests inject).
	const rebuildRequire = createRequire(
		localRequire.resolve("@electron/rebuild"),
	);
	return rebuildRequire("node-abi").getAbi(version, runtime);
}

export function resolveElectronAbi(
	electronVersion,
	{ getAbi = defaultGetAbi } = {},
) {
	return Number(getAbi(electronVersion, "electron"));
}

export function resolveElectronVersion(
	context,
	{ readElectronPkg = () => localRequire("electron/package.json") } = {},
) {
	const fromContext =
		context?.packager?.info?.framework?.version ??
		context?.packager?.config?.electronVersion;
	if (fromContext) return fromContext;
	return readElectronPkg().version;
}

export function assertPackagedBetterSqliteAbi({
	appOutDir,
	productFilename,
	electronVersion,
	platform = process.platform,
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
	readFileSync = defaultReadFileSync,
	getAbi = defaultGetAbi,
}) {
	const unpackedDir = getPackagedAsarUnpackedDir({
		appOutDir,
		productFilename,
		platform,
	});
	const binary = findBetterSqliteBinary(unpackedDir, {
		existsSync,
		readdirSync,
	});
	if (!binary) {
		throw new Error(
			"afterPack: better-sqlite3 native binary not found under app.asar.unpacked — native rebuild/unpack failed; the app would crash on first DB use. Aborting packaging.",
		);
	}
	const actual = readNativeModuleAbi(binary, { readFileSync });
	if (actual === null) {
		throw new Error(
			`afterPack: could not read NODE_MODULE_VERSION from ${binary}. Aborting packaging.`,
		);
	}
	const expected = resolveElectronAbi(electronVersion, { getAbi });
	if (actual !== expected) {
		throw new Error(
			`afterPack: better-sqlite3 ABI mismatch — packaged binary is NODE_MODULE_VERSION ${actual} ` +
				`but Electron ${electronVersion} needs ${expected}. The native module was not rebuilt for ` +
				"Electron (likely a stale host-Node build); every user would crash on first DB use. " +
				"Aborting packaging.",
		);
	}
	return { binary, actual, expected };
}

// --- dependency-closure guard ----------------------------------------------
//
// electron-builder builds app.asar's node_modules from a production dependency
// graph it derives by parsing `pnpm ls --json --depth Infinity`. pnpm 10.29.3+
// emits truncated "deduped" nodes for packages that appear more than once in the
// tree; collector versions before electron-builder 26.8.2 assumed full expansion
// and silently dropped any transitive leaf reachable only through a deduped node
// (e.g. is-extglob via chokidar → glob-parent → is-glob). The resulting app
// packages cleanly and then crashes for EVERY user at startup with "Cannot find
// module ...". This guard re-derives the present module set from the packaged
// app itself and asserts every declared dependency resolves — aborting packaging
// if any are missing, so this class of bug can never reach users again.

export function getPackagedAsarPath({
	appOutDir,
	productFilename,
	platform = process.platform,
}) {
	return join(
		getPackagedResourcesDir({ appOutDir, productFilename, platform }),
		"app.asar",
	);
}

// A package.json is a *package root* only when its parent directory is the
// package itself sitting directly under a node_modules (optionally inside a
// @scope dir). This excludes package.json files nested in a package's own
// subfolders (e.g. node_modules/foo/lib/package.json), which are not packages.
export function isPackageRootPackageJson(relPath) {
	if (!relPath.endsWith("/package.json")) return false;
	const parts = relPath.split("/");
	parts.pop(); // drop "package.json"
	if (parts.length < 2) return false; // need at least node_modules/<name>
	const before = parts[parts.length - 2];
	if (before === "node_modules") return true; // node_modules/<name>
	// node_modules/@scope/<name>
	return before.startsWith("@") && parts[parts.length - 3] === "node_modules";
}

// Resolve each package's declared deps the way Node does: from the requiring
// package's dir, look for <dir>/node_modules/<dep>, then ascend. Paths are
// POSIX-relative to Contents/Resources so asar and asar.unpacked share one tree.
export function findUnresolvedDependencies(packages) {
	const present = new Set(packages.map((p) => p.dir));
	const resolves = (dep, fromDir) => {
		let dir = fromDir;
		while (true) {
			if (present.has(posix.join(dir, "node_modules", dep))) return true;
			const parent = posix.dirname(dir);
			if (parent === dir) return false;
			dir = parent;
		}
	};
	const missing = [];
	for (const pkg of packages) {
		for (const dep of pkg.dependencies) {
			if (!resolves(dep, pkg.dir)) {
				missing.push({ from: pkg.name, dependency: dep });
			}
		}
	}
	return missing;
}

function normalizeAsarPath(p) {
	return p
		.replace(/^[/\\]+/, "")
		.split("\\")
		.join("/");
}

function toPackage(dir, jsonText) {
	let pj;
	try {
		pj = JSON.parse(jsonText);
	} catch {
		return null;
	}
	return {
		dir,
		name: pj.name ?? dir,
		dependencies: Object.keys(pj.dependencies ?? {}),
	};
}

function loadAsar() {
	// @electron/asar is a transitive dep of app-builder-lib (a direct devDep via
	// electron-builder). Resolve it through that chain rather than relying on
	// hoisting, mirroring how node-abi is resolved through @electron/rebuild.
	const ebRequire = createRequire(localRequire.resolve("electron-builder"));
	const ablRequire = createRequire(ebRequire.resolve("app-builder-lib"));
	return ablRequire("@electron/asar");
}

export function collectPackagedPackages({
	asarPath,
	unpackedDir,
	listPackage = (p) => loadAsar().listPackage(p),
	extractFile = (p, f) => loadAsar().extractFile(p, f),
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
	readFileSync = defaultReadFileSync,
}) {
	const packages = [];
	const seen = new Set();
	const add = (dir, jsonText) => {
		if (seen.has(dir)) return; // unpacked wins over the asar stub if both exist
		const pkg = toPackage(dir, jsonText);
		if (!pkg) return;
		seen.add(dir);
		packages.push(pkg);
	};

	// 1. asar.unpacked first (real files on disk for asarUnpack'd modules)
	if (existsSync(unpackedDir)) {
		const stack = [unpackedDir];
		while (stack.length > 0) {
			const dir = stack.pop();
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) stack.push(full);
				else if (entry.name === "package.json") {
					const rel = relative(unpackedDir, full).split(sep).join("/");
					if (!isPackageRootPackageJson(rel)) continue;
					add(
						rel.slice(0, -"/package.json".length),
						readFileSync(full, "utf8"),
					);
				}
			}
		}
	}

	// 2. everything inside the asar
	for (const entry of listPackage(asarPath)) {
		const rel = normalizeAsarPath(entry);
		if (!isPackageRootPackageJson(rel)) continue;
		add(
			rel.slice(0, -"/package.json".length),
			extractFile(asarPath, rel).toString("utf8"),
		);
	}

	return packages;
}

export function assertPackagedDependencyClosure({
	appOutDir,
	productFilename,
	platform = process.platform,
	listPackage,
	extractFile,
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
	readFileSync = defaultReadFileSync,
}) {
	const packages = collectPackagedPackages({
		asarPath: getPackagedAsarPath({ appOutDir, productFilename, platform }),
		unpackedDir: getPackagedAsarUnpackedDir({
			appOutDir,
			productFilename,
			platform,
		}),
		listPackage,
		extractFile,
		existsSync,
		readdirSync,
		readFileSync,
	});
	if (packages.length === 0) {
		throw new Error(
			"afterPack: no packages found in app.asar — dependency collection produced an empty tree. Aborting packaging.",
		);
	}
	const missing = findUnresolvedDependencies(packages);
	if (missing.length > 0) {
		const detail = missing
			.slice(0, 40)
			.map((m) => `  - ${m.dependency} (required by ${m.from})`)
			.join("\n");
		const more =
			missing.length > 40 ? `\n  …and ${missing.length - 40} more` : "";
		throw new Error(
			`afterPack: ${missing.length} declared dependency(ies) missing from the packaged app.asar — ` +
				'the app would crash at runtime with "Cannot find module". This is the pnpm/electron-builder ' +
				"deduped-subtree collector bug; ensure electron-builder >= 26.8.2. Missing:\n" +
				detail +
				more,
		);
	}
	return { checked: packages.length };
}

export default async function afterPack(
	context,
	{ platform = process.platform } = {},
) {
	const appOutDir = context.appOutDir;
	const productFilename = context.packager.appInfo.productFilename;
	const arch = resolvePackagedArch(context.arch);

	// node-pty ships a `spawn-helper` only on darwin/linux; on Windows it uses
	// conpty.node and there is no helper to chmod, so skip this assertion there.
	if (platform !== "win32") {
		const changed = ensurePackagedNodePtySpawnHelperExecutable({
			appOutDir,
			productFilename,
			arch,
			platform,
		});
		if (!changed) {
			throw new Error(
				"afterPack: node-pty spawn-helper not found — aborting packaging to prevent broken terminal",
			);
		}
	}

	assertPackagedBetterSqliteAbi({
		appOutDir,
		productFilename,
		electronVersion: resolveElectronVersion(context),
		platform,
	});

	assertPackagedDependencyClosure({
		appOutDir,
		productFilename,
		platform,
	});
}
