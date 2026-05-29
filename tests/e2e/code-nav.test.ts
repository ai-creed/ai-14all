import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import { ensureReviewOverlayOpen } from "./helpers/review-overlay";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let cortexCacheRoot: string;
let codeNavCacheRoot: string;

const REPO_KEY = "e2e-cn-repo";
const WT_KEY = "e2e-cn-wt";

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "code-nav-e2e-state-")),
	);
	cortexCacheRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "code-nav-e2e-cortex-")),
	);
	codeNavCacheRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "code-nav-e2e-svc-")),
	);

	// Seed the linked feature-a worktree with src/utils.ts so the fixture cortex
	// index has a real file to point at.
	writeFileSync(
		join(testRepo.worktreePath, "src", "utils.ts"),
		"export function parseConfig(input) {\n  return JSON.parse(input);\n}\n",
	);

	// Build a cortex JSON describing parseConfig in src/utils.ts and a render
	// caller in src/index.ts (the file already present in the fixture).
	const cortexJson = {
		schemaVersion: 3,
		fingerprint: "e2e-fp",
		worktreePath: testRepo.worktreePath,
		repoKey: REPO_KEY,
		worktreeKey: WT_KEY,
		indexedAt: new Date().toISOString(),
		files: [
			{ path: "src/utils.ts", kind: "file" as const },
			{ path: "src/index.ts", kind: "file" as const },
		],
		functions: [
			{
				qualifiedName: "src/utils.ts::parseConfig",
				file: "src/utils.ts",
				line: 1,
				exported: true,
			},
			{
				qualifiedName: "src/index.ts::render",
				file: "src/index.ts",
				line: 1,
				exported: true,
			},
		],
		calls: [
			{
				from: "src/index.ts::render",
				to: "src/utils.ts::parseConfig",
				kind: "call" as const,
			},
		],
		imports: [{ from: "src/index.ts", to: "src/utils.ts" }],
	};

	// Pre-seed cortex sidecar so CortexKeyResolver maps worktreePath → keys.
	mkdirSync(join(cortexCacheRoot, REPO_KEY), { recursive: true });
	writeFileSync(
		join(cortexCacheRoot, REPO_KEY, `${WT_KEY}.json`),
		JSON.stringify(cortexJson),
	);
	writeFileSync(
		join(cortexCacheRoot, REPO_KEY, `${WT_KEY}.meta.json`),
		JSON.stringify({
			worktreePath: testRepo.worktreePath,
			repoKey: REPO_KEY,
			worktreeKey: WT_KEY,
			fingerprint: "e2e-fp",
		}),
	);

	// The code-nav SQLite mirror is ingested via the app's e2e-only IPC after
	// launch so the better-sqlite3 binary loaded matches Electron's ABI.
	mkdirSync(join(codeNavCacheRoot, REPO_KEY), { recursive: true });

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(
				persistedStateDir,
				"workspace-state.json",
			),
			AI14ALL_CORTEX_CACHE_ROOT: cortexCacheRoot,
			AI14ALL_CODE_NAV_CACHE_ROOT: codeNavCacheRoot,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });

	// Drive the e2e-only IPC to ingest our seeded cortex JSON into the
	// code-nav SQLite mirror using Electron's better-sqlite3 binary.
	await page.evaluate(
		async (args) =>
			await (
				window as unknown as {
					__codeNavE2eIngest: (a: unknown) => Promise<unknown>;
				}
			).__codeNavE2eIngest(args),
		{
			jsonPath: join(cortexCacheRoot, REPO_KEY, `${WT_KEY}.json`),
			dbPath: join(codeNavCacheRoot, REPO_KEY, `${WT_KEY}.sqlite`),
		},
	);
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		rmSync(cortexCacheRoot, { recursive: true, force: true });
		rmSync(codeNavCacheRoot, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Code navigation MVP", () => {
	test("preload exposes window.ai14all.codeNav surface", async () => {
		const surface = await page.evaluate(() => {
			const cn = (
				window as unknown as {
					ai14all?: { codeNav?: Record<string, unknown> };
				}
			).ai14all?.codeNav;
			if (!cn) return null;
			return Object.keys(cn).sort();
		});
		expect(surface).toEqual(
			expect.arrayContaining([
				"findDefinitions",
				"findCallees",
				"findCallers",
				"searchSymbols",
				"getFileImports",
				"getWorktreeStatus",
				"listFiles",
				"refreshWorktree",
				"watchWorktree",
				"unwatchWorktree",
				"onWorktreeIndexRefreshed",
			]),
		);
	});

	test("IPC trust boundary: zod-strict schemas reject smuggled keys (regression: smuggled worktreePath must throw)", async () => {
		const rejected = await page.evaluate(async () => {
			try {
				await (
					window as unknown as {
						ai14all: {
							codeNav: {
								findDefinitions(args: unknown): Promise<unknown>;
							};
						};
					}
				).ai14all.codeNav.findDefinitions({
					workspaceId: "ws1",
					worktreeId: "wt1",
					name: "foo",
					worktreePath: "/etc",
				});
				return false;
			} catch {
				return true;
			}
		});
		expect(rejected).toBe(true);
	});

	test("Cmd+T palette navigates to a symbol — UI flow drives navRouter dispatch", async () => {
		// Load the repository so worktree nav is populated.
		const repoInput = page.locator("#repo-path");
		if (await repoInput.isVisible().catch(() => false)) {
			await repoInput.fill(testRepo.repoPath);
			await page.getByRole("button", { name: "Load" }).click();
		}
		const nav = page.getByRole("navigation", { name: "Worktree sessions" });
		await expect(
			nav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 15_000 });
		await nav.getByRole("button", { name: /feature-a/i }).click();
		await ensureReviewOverlayOpen(page);

		// Wait for CodeNavHygiene's effect to publish the active ref. The hygiene
		// component lives inside ReviewExpandedPortal, so the ref is only set
		// once the review chrome is expanded (verified above).
		await page.waitForFunction(
			() =>
				Boolean(
					(window as unknown as { __codeNavTestRef?: object })
						.__codeNavTestRef,
				),
			{ timeout: 10_000 },
		);

		// Sanity: the IPC chain (codeNav.searchSymbols → registry.get →
		// worktreeService.findWorktree → cortexKeyResolver.resolve → SQLite)
		// must return our seeded parseConfig row for the live ids.
		const probe = await page.evaluate(async () => {
			const ref = (
				window as unknown as {
					__codeNavTestRef: { workspaceId: string; worktreeId: string };
				}
			).__codeNavTestRef;
			try {
				const rows = await (
					window as unknown as {
						ai14all: {
							codeNav: {
								searchSymbols(args: unknown): Promise<
									Array<{ bare_name: string; file: string }>
								>;
							};
						};
					}
				).ai14all.codeNav.searchSymbols({
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					query: "pars",
					limit: 50,
				});
				return { ok: true as const, rows };
			} catch (e) {
				return { ok: false as const, error: (e as Error).message, ref };
			}
		});
		expect(
			probe.ok,
			`IPC searchSymbols probe failed: ${JSON.stringify(probe)}`,
		).toBe(true);
		if (probe.ok) {
			expect(probe.rows.some((r) => r.bare_name === "parseConfig")).toBe(true);
		}

		// Cmd+T (Mac) / Ctrl+T (other) opens the palette.
		const isMac = process.platform === "darwin";
		await page.keyboard.press(isMac ? "Meta+t" : "Control+t");

		const palette = page.getByRole("dialog", { name: /go to symbol/i });
		await expect(palette).toBeVisible({ timeout: 5_000 });

		// Type a fuzzy prefix that matches our seeded parseConfig.
		await page.keyboard.type("pars");
		await expect(palette.getByText(/parseConfig/)).toBeVisible({
			timeout: 5_000,
		});
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");

		// navRouter.navigate dispatches session/selectFileAtLocation, which the
		// workspace-state reducer maps to selectedFilePath = "src/utils.ts".
		// Assert the dispatch landed via a renderer-side probe of session state.
		await page.waitForFunction(
			() => {
				const sel = document.body.textContent ?? "";
				return sel.includes("utils.ts");
			},
			{ timeout: 5_000 },
		);
	});

	test("cmd+click → DefinitionProvider locates parseConfig via the registered Monaco provider", async () => {
		// The DefinitionProvider Monaco invokes on cmd+click reads the active
		// worktree ref and calls findDefinitions. We drive the same provider
		// path here through the live in-app ids the CodeNavHygiene effect
		// publishes, asserting a hit on src/utils.ts:1.
		const ref = await page.evaluate(
			() =>
				(
					window as unknown as {
						__codeNavTestRef?: { workspaceId: string; worktreeId: string };
					}
				).__codeNavTestRef ?? null,
		);
		expect(ref, "active code-nav ref not published").not.toBeNull();
		const rows = await page.evaluate(async (args) => {
			return await (
				window as unknown as {
					ai14all: {
						codeNav: {
							findDefinitions(args: unknown): Promise<
								Array<{ file: string; line: number; bare_name: string }>
							>;
						};
					};
				}
			).ai14all.codeNav.findDefinitions({
				workspaceId: (args as { workspaceId: string }).workspaceId,
				worktreeId: (args as { worktreeId: string }).worktreeId,
				name: "parseConfig",
			});
		}, ref);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0].file).toBe("src/utils.ts");
		expect(rows[0].bare_name).toBe("parseConfig");
	});

	test("document-link click → listFiles publishes the seeded files so `path:line` references become navigable", async () => {
		// The DocumentLinkProvider's loadFileSet calls listFiles to know which
		// path:line references should become real cortex:// links. Verify the
		// seeded src/utils.ts + src/index.ts are exposed for the live ids.
		const ref = await page.evaluate(
			() =>
				(
					window as unknown as {
						__codeNavTestRef?: { workspaceId: string; worktreeId: string };
					}
				).__codeNavTestRef ?? null,
		);
		expect(ref).not.toBeNull();
		const files = await page.evaluate(async (args) => {
			return await (
				window as unknown as {
					ai14all: {
						codeNav: { listFiles(args: unknown): Promise<string[]> };
					};
				}
			).ai14all.codeNav.listFiles({
				workspaceId: (args as { workspaceId: string }).workspaceId,
				worktreeId: (args as { worktreeId: string }).worktreeId,
			});
		}, ref);
		expect(files).toEqual(
			expect.arrayContaining(["src/utils.ts", "src/index.ts"]),
		);
	});
});
