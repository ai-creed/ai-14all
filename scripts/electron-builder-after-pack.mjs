import {
	chmodSync as defaultChmodSync,
	existsSync as defaultExistsSync,
	readdirSync as defaultReaddirSync,
	readFileSync as defaultReadFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Arch } from "builder-util";

const localRequire = createRequire(import.meta.url);

export function resolvePackagedArch(arch) {
	return arch === Arch.arm64 ? "arm64" : "x64";
}

export function getPackagedNodePtySpawnHelperPath({
	appOutDir,
	productFilename,
	arch,
}) {
	return join(
		appOutDir,
		`${productFilename}.app`,
		"Contents",
		"Resources",
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
	existsSync = defaultExistsSync,
	chmodSync = defaultChmodSync,
}) {
	const helperPath = getPackagedNodePtySpawnHelperPath({
		appOutDir,
		productFilename,
		arch,
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

export function getPackagedAsarUnpackedDir({ appOutDir, productFilename }) {
	return join(
		appOutDir,
		`${productFilename}.app`,
		"Contents",
		"Resources",
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
	existsSync = defaultExistsSync,
	readdirSync = defaultReaddirSync,
	readFileSync = defaultReadFileSync,
	getAbi = defaultGetAbi,
}) {
	const unpackedDir = getPackagedAsarUnpackedDir({ appOutDir, productFilename });
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

export default async function afterPack(context) {
	const changed = ensurePackagedNodePtySpawnHelperExecutable({
		appOutDir: context.appOutDir,
		productFilename: context.packager.appInfo.productFilename,
		arch: resolvePackagedArch(context.arch),
	});
	if (!changed) {
		throw new Error(
			"afterPack: node-pty spawn-helper not found — aborting packaging to prevent broken terminal",
		);
	}

	assertPackagedBetterSqliteAbi({
		appOutDir: context.appOutDir,
		productFilename: context.packager.appInfo.productFilename,
		electronVersion: resolveElectronVersion(context),
	});
}
