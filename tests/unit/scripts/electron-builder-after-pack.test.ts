import { describe, expect, it, vi } from "vitest";
import { Arch } from "builder-util";
import afterPack, {
	assertPackagedBetterSqliteAbi,
	assertPackagedDependencyClosure,
	collectPackagedPackages,
	ensurePackagedNodePtySpawnHelperExecutable,
	findBetterSqliteBinary,
	findUnresolvedDependencies,
	getPackagedAsarPath,
	getPackagedAsarUnpackedDir,
	getPackagedNodePtySpawnHelperPath,
	isPackageRootPackageJson,
	readNativeModuleAbi,
	resolveElectronAbi,
	resolveElectronVersion,
	resolvePackagedArch,
} from "../../../scripts/electron-builder-after-pack.mjs";

// Minimal fake fs over a {dirPath: [{name, dir}]} tree for the binary walker.
function makeFakeFs(
	tree: Record<string, Array<{ name: string; dir?: boolean }>>,
) {
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
			[`${UNPACKED}/node_modules/.pnpm`]: [
				{ name: "better-sqlite3", dir: true },
			],
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

describe("dependency-closure guard", () => {
	const ASAR =
		"/tmp/release/mac-arm64/ai-14all.app/Contents/Resources/app.asar";

	it("builds the app.asar path inside a packaged app", () => {
		expect(
			getPackagedAsarPath({
				appOutDir: "/tmp/release/mac-arm64",
				productFilename: "ai-14all",
			}),
		).toBe(ASAR);
	});

	describe("isPackageRootPackageJson", () => {
		it("accepts a top-level package root", () => {
			expect(
				isPackageRootPackageJson("node_modules/is-glob/package.json"),
			).toBe(true);
		});
		it("accepts a scoped package root", () => {
			expect(
				isPackageRootPackageJson(
					"node_modules/@radix-ui/react-separator/package.json",
				),
			).toBe(true);
		});
		it("accepts a nested (conflict-resolution) package root", () => {
			expect(
				isPackageRootPackageJson(
					"node_modules/parse-entities/node_modules/character-entities/package.json",
				),
			).toBe(true);
		});
		it("rejects a package.json nested inside a package's own subfolders", () => {
			expect(
				isPackageRootPackageJson("node_modules/foo/lib/package.json"),
			).toBe(false);
		});
		it("rejects non-node_modules and the app's own package.json", () => {
			expect(isPackageRootPackageJson("package.json")).toBe(false);
			expect(isPackageRootPackageJson("out/main/package.json")).toBe(false);
		});
	});

	describe("findUnresolvedDependencies", () => {
		const chain = [
			{
				dir: "node_modules/chokidar",
				name: "chokidar",
				dependencies: ["glob-parent", "is-glob"],
			},
			{
				dir: "node_modules/glob-parent",
				name: "glob-parent",
				dependencies: ["is-glob"],
			},
			{
				dir: "node_modules/is-glob",
				name: "is-glob",
				dependencies: ["is-extglob"],
			},
			{ dir: "node_modules/is-extglob", name: "is-extglob", dependencies: [] },
		];

		it("reports nothing when the full closure is present", () => {
			expect(findUnresolvedDependencies(chain)).toEqual([]);
		});

		it("flags the leaf dropped by the deduped-subtree bug (is-extglob)", () => {
			const broken = chain.filter((p) => p.name !== "is-extglob");
			expect(findUnresolvedDependencies(broken)).toEqual([
				{ from: "is-glob", dependency: "is-extglob" },
			]);
		});

		it("resolves a dep nested inside the requiring package's own node_modules", () => {
			expect(
				findUnresolvedDependencies([
					{ dir: "node_modules/a", name: "a", dependencies: ["b"] },
					{
						dir: "node_modules/a/node_modules/b",
						name: "b",
						dependencies: [],
					},
				]),
			).toEqual([]);
		});

		it("resolves a dep hoisted to the top level from a nested package", () => {
			expect(
				findUnresolvedDependencies([
					{
						dir: "node_modules/a/node_modules/x",
						name: "x",
						dependencies: ["c"],
					},
					{ dir: "node_modules/c", name: "c", dependencies: [] },
				]),
			).toEqual([]);
		});
	});

	describe("collectPackagedPackages", () => {
		it("reads package roots from the asar and skips inner package.json files", () => {
			const tree: Record<string, unknown> = {
				"node_modules/a/package.json": { name: "a", dependencies: { b: "1" } },
				"node_modules/a/lib/package.json": { name: "a-inner" },
				"node_modules/b/package.json": { name: "b" },
			};
			const packages = collectPackagedPackages({
				asarPath: ASAR,
				unpackedDir: "/tmp/unpacked",
				listPackage: () => Object.keys(tree).map((p) => `/${p}`),
				extractFile: (_asar: string, p: string) =>
					Buffer.from(JSON.stringify(tree[p.replace(/^[/\\]+/, "")])),
				existsSync: () => false,
			});
			expect(packages).toEqual([
				{ dir: "node_modules/a", name: "a", dependencies: ["b"] },
				{ dir: "node_modules/b", name: "b", dependencies: [] },
			]);
		});

		it("merges asar.unpacked packages (e.g. node-pty) into the tree", () => {
			const UNP = "/tmp/unpacked";
			const fakeFs = makeFakeFs({
				[UNP]: [{ name: "node_modules", dir: true }],
				[`${UNP}/node_modules`]: [{ name: "node-pty", dir: true }],
				[`${UNP}/node_modules/node-pty`]: [{ name: "package.json" }],
			});
			const packages = collectPackagedPackages({
				asarPath: ASAR,
				unpackedDir: UNP,
				listPackage: () => [],
				extractFile: () => Buffer.from("{}"),
				existsSync: fakeFs.existsSync,
				readdirSync: fakeFs.readdirSync,
				readFileSync: () =>
					JSON.stringify({ name: "node-pty", dependencies: {} }),
			});
			expect(packages).toEqual([
				{ dir: "node_modules/node-pty", name: "node-pty", dependencies: [] },
			]);
		});
	});

	describe("assertPackagedDependencyClosure", () => {
		const completeTree: Record<string, unknown> = {
			"node_modules/chokidar/package.json": {
				name: "chokidar",
				dependencies: { "is-glob": "1" },
			},
			"node_modules/is-glob/package.json": {
				name: "is-glob",
				dependencies: { "is-extglob": "1" },
			},
			"node_modules/is-extglob/package.json": { name: "is-extglob" },
		};
		const asarFrom = (tree: Record<string, unknown>) => ({
			listPackage: () => Object.keys(tree).map((p) => `/${p}`),
			extractFile: (_asar: string, p: string) =>
				Buffer.from(JSON.stringify(tree[p.replace(/^[/\\]+/, "")])),
			existsSync: () => false,
		});

		it("passes when every declared dependency resolves", () => {
			expect(
				assertPackagedDependencyClosure({
					appOutDir: "/tmp/release/mac-arm64",
					productFilename: "ai-14all",
					...asarFrom(completeTree),
				}),
			).toEqual({ checked: 3 });
		});

		it("throws and names the missing module(s) when a leaf was dropped", () => {
			const broken = { ...completeTree };
			delete broken["node_modules/is-extglob/package.json"];
			expect(() =>
				assertPackagedDependencyClosure({
					appOutDir: "/tmp/release/mac-arm64",
					productFilename: "ai-14all",
					...asarFrom(broken),
				}),
			).toThrow(/is-extglob.*required by chokidar→is-glob|is-extglob/s);
		});

		it("throws when no packages were collected at all", () => {
			expect(() =>
				assertPackagedDependencyClosure({
					appOutDir: "/tmp/release/mac-arm64",
					productFilename: "ai-14all",
					listPackage: () => [],
					extractFile: () => Buffer.from("{}"),
					existsSync: () => false,
				}),
			).toThrow(/no packages found/);
		});
	});
});
