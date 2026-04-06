import {
	chmodSync as defaultChmodSync,
	existsSync as defaultExistsSync,
} from "node:fs";
import { join } from "node:path";
import { Arch } from "builder-util";

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

export default async function afterPack(context) {
	const changed = ensurePackagedNodePtySpawnHelperExecutable({
		appOutDir: context.appOutDir,
		productFilename: context.packager.appInfo.productFilename,
		arch: resolvePackagedArch(context.arch),
	});
	if (!changed) {
		process.stderr.write(
			"afterPack: node-pty spawn-helper not found — packaged terminal may not work\n",
		);
	}
}
