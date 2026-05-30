import { describe, expect, it, vi } from "vitest";
import { Arch } from "builder-util";
import afterPack, {
	assertPackagedBetterSqliteAbi,
	ensurePackagedNodePtySpawnHelperExecutable,
	findBetterSqliteBinary,
	getPackagedAsarUnpackedDir,
	getPackagedNodePtySpawnHelperPath,
	readNativeModuleAbi,
	resolveElectronAbi,
	resolveElectronVersion,
	resolvePackagedArch,
} from "../../../scripts/electron-builder-after-pack.mjs";

// Minimal fake fs over a {dirPath: [{name, dir}]} tree for the binary walker.
function makeFakeFs(tree: Record<string, Array<{ name: string; dir?: boolean }>>) {
	return {
		existsSync: (p: string) => p in tree,
		readdirSync: (p: string) =>
			(tree[p] ?? []).map((e) => ({
				name: e.name,
				isDirectory: () => Boolean(e.dir),
			})),
	};
}

describe("electron-builder-after-pack", () => {
	it("maps electron-builder arch enums to packaged helper arch names", () => {
		expect(resolvePackagedArch(Arch.arm64)).toBe("arm64");
		expect(resolvePackagedArch(Arch.x64)).toBe("x64");
	});

	it("builds the unpacked spawn-helper path inside a packaged app", () => {
		expect(
			getPackagedNodePtySpawnHelperPath({
				appOutDir: "/tmp/release/mac-arm64",
				productFilename: "ai-14all",
				arch: "arm64",
			}),
		).toBe(
			"/tmp/release/mac-arm64/ai-14all.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
		);
	});

	it("chmods the packaged helper to 755 when it exists", () => {
		const chmodSync = vi.fn();
		const changed = ensurePackagedNodePtySpawnHelperExecutable({
			appOutDir: "/tmp/release/mac-arm64",
			productFilename: "ai-14all",
			arch: "arm64",
			existsSync: () => true,
			chmodSync,
		});

		expect(changed).toBe(true);
		expect(chmodSync).toHaveBeenCalledWith(
			"/tmp/release/mac-arm64/ai-14all.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
			0o755,
		);
	});

	it("returns false and skips chmod when the helper does not exist", () => {
		const chmodSync = vi.fn();
		const changed = ensurePackagedNodePtySpawnHelperExecutable({
			appOutDir: "/tmp/release/mac-arm64",
			productFilename: "ai-14all",
			arch: "arm64",
			existsSync: () => false,
			chmodSync,
		});
		expect(changed).toBe(false);
		expect(chmodSync).not.toHaveBeenCalled();
	});
});

describe("afterPack", () => {
	it("throws when the node-pty spawn-helper is not found", async () => {
		const context = {
			appOutDir: "/nonexistent/path",
			packager: { appInfo: { productFilename: "ai-14all" } },
			arch: Arch.arm64,
		};
		await expect(afterPack(context)).rejects.toThrow(
			"node-pty spawn-helper not found",
		);
	});
});

describe("better-sqlite3 ABI guard", () => {
	const UNPACKED =
		"/tmp/release/mac-arm64/ai-14all.app/Contents/Resources/app.asar.unpacked";

	it("builds the asar.unpacked dir inside a packaged app", () => {
		expect(
			getPackagedAsarUnpackedDir({
				appOutDir: "/tmp/release/mac-arm64",
				productFilename: "ai-14all",
			}),
		).toBe(UNPACKED);
	});

	it("finds a nested better_sqlite3.node by walking the unpacked tree", () => {
		const fs = makeFakeFs({
			[UNPACKED]: [{ name: "node_modules", dir: true }],
			[`${UNPACKED}/node_modules`]: [{ name: ".pnpm", dir: true }],
			[`${UNPACKED}/node_modules/.pnpm`]: [{ name: "better-sqlite3", dir: true }],
			[`${UNPACKED}/node_modules/.pnpm/better-sqlite3`]: [
				{ name: "better_sqlite3.node" },
			],
		});
		expect(findBetterSqliteBinary(UNPACKED, fs)).toBe(
			`${UNPACKED}/node_modules/.pnpm/better-sqlite3/better_sqlite3.node`,
		);
	});

	it("returns null when the unpacked dir is absent or the binary is missing", () => {
		expect(findBetterSqliteBinary(UNPACKED, makeFakeFs({}))).toBeNull();
		expect(
			findBetterSqliteBinary(UNPACKED, makeFakeFs({ [UNPACKED]: [] })),
		).toBeNull();
	});

	it("reads NODE_MODULE_VERSION from the register symbol", () => {
		const readFileSync = () =>
			Buffer.from("\x00\x00node_register_module_v145\x00padding");
		expect(readNativeModuleAbi("x", { readFileSync })).toBe(145);
	});

	it("returns null when no register symbol is present", () => {
		const readFileSync = () => Buffer.from("not a native module");
		expect(readNativeModuleAbi("x", { readFileSync })).toBeNull();
	});

	it("resolves the expected Electron ABI via injected node-abi", () => {
		const getAbi = vi.fn(() => "145");
		expect(resolveElectronAbi("41.1.1", { getAbi })).toBe(145);
		expect(getAbi).toHaveBeenCalledWith("41.1.1", "electron");
	});

	it("resolves the Electron version from context, then falls back to the package", () => {
		expect(
			resolveElectronVersion({
				packager: { info: { framework: { version: "41.1.1" } } },
			}),
		).toBe("41.1.1");
		expect(
			resolveElectronVersion(
				{ packager: { config: { electronVersion: "41.2.0" } } },
				{ readElectronPkg: () => ({ version: "99.0.0" }) },
			),
		).toBe("41.2.0");
		expect(
			resolveElectronVersion(
				{},
				{ readElectronPkg: () => ({ version: "41.9.9" }) },
			),
		).toBe("41.9.9");
	});

	const fsWithBinary = {
		...makeFakeFs({
			[UNPACKED]: [{ name: "better_sqlite3.node" }],
		}),
		readFileSync: () => Buffer.from("node_register_module_v145"),
	};

	it("passes when the packaged ABI matches the target Electron", () => {
		const result = assertPackagedBetterSqliteAbi({
			appOutDir: "/tmp/release/mac-arm64",
			productFilename: "ai-14all",
			electronVersion: "41.1.1",
			...fsWithBinary,
			getAbi: () => 145,
		});
		expect(result).toEqual({
			binary: `${UNPACKED}/better_sqlite3.node`,
			actual: 145,
			expected: 145,
		});
	});

	it("throws on an ABI mismatch (stale host-Node build)", () => {
		expect(() =>
			assertPackagedBetterSqliteAbi({
				appOutDir: "/tmp/release/mac-arm64",
				productFilename: "ai-14all",
				electronVersion: "41.1.1",
				...makeFakeFs({ [UNPACKED]: [{ name: "better_sqlite3.node" }] }),
				readFileSync: () => Buffer.from("node_register_module_v141"),
				getAbi: () => 145,
			}),
		).toThrow(/ABI mismatch.*141.*needs 145/s);
	});

	it("throws when the binary is missing from the package", () => {
		expect(() =>
			assertPackagedBetterSqliteAbi({
				appOutDir: "/tmp/release/mac-arm64",
				productFilename: "ai-14all",
				electronVersion: "41.1.1",
				...makeFakeFs({}),
				readFileSync: () => Buffer.from(""),
				getAbi: () => 145,
			}),
		).toThrow(/native binary not found/);
	});
});
