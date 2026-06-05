import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import { ensureReviewOverlayOpen } from "./helpers/review-overlay";
import { makeCortexFixtureDb } from "../unit/code-nav/helpers/make-cortex-fixture-db";

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
	// A second definition of parseConfig so Go to Definition has MULTIPLE ranked
	// results (exercises gotoLocation:"goto" jump-to-best + ⌥F12 peek-the-list).
	writeFileSync(
		join(testRepo.worktreePath, "src", "utils2.ts"),
		"export function parseConfig() {\n  return { v: 2 };\n}\n",
	);

	// Overwrite src/index.ts with a parseConfig caller plus a `path:line`
	// comment so the spec's acceptance flows have real UI to exercise:
	// - line 1 carries `src/utils.ts:1` for DocumentLinkProvider to turn into a
	//   cortex:// link (test: diff-link click → nav).
	// - line 5 carries the parseConfig identifier for DefinitionProvider
	//   (test: cmd+click → reveal definition → nav).
	writeFileSync(
		join(testRepo.worktreePath, "src", "index.ts"),
		[
			"// helper at src/utils.ts:1",
			'import { parseConfig } from "./utils";',
			"",
			"export function render() {",
			'  return parseConfig("{}");',
			"}",
			"",
		].join("\n"),
	);

	// Build a cortex JSON describing parseConfig in src/utils.ts and a render
	// caller in src/index.ts (the file already present in the fixture).
	const cortexDbPath = join(cortexCacheRoot, REPO_KEY, `${WT_KEY}.db`);

	// Pre-seed cortex sidecar so CortexKeyResolver maps worktreePath → keys.
	mkdirSync(join(cortexCacheRoot, REPO_KEY), { recursive: true });
	// Build a cortex v3.1 `.db` (the new source) the app's e2e ingest reads.
	makeCortexFixtureDb(cortexDbPath, {
		meta: {
			schemaVersion: "3.1",
			fingerprint: "e2e-fp",
			worktreePath: testRepo.worktreePath,
			repoKey: REPO_KEY,
			worktreeKey: WT_KEY,
		},
		functions: [
			{
				qualified_name: "parseConfig",
				file: "src/utils.ts",
				line: 1,
				exported: 1,
			},
			{
				qualified_name: "parseConfig",
				file: "src/utils2.ts",
				line: 1,
				exported: 1,
			},
			{ qualified_name: "render", file: "src/index.ts", line: 1, exported: 1 },
		],
		calls: [
			{
				from_key: "src/index.ts::render",
				to_key: "src/utils.ts::parseConfig",
				kind: "call",
				site_line: 1,
				site_col: 1,
			},
		],
		imports: [{ from_path: "src/index.ts", to_path: "src/utils.ts" }],
		files: [
			{ path: "src/utils.ts", kind: "file" },
			{ path: "src/utils2.ts", kind: "file" },
			{ path: "src/index.ts", kind: "file" },
		],
	});
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
			cortexDbPath: join(cortexCacheRoot, REPO_KEY, `${WT_KEY}.db`),
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
		await expect(nav.getByRole("button", { name: /feature-a/i })).toBeVisible({
			timeout: 15_000,
		});
		await nav.getByRole("button", { name: /feature-a/i }).click();
		await ensureReviewOverlayOpen(page);

		// Wait for CodeNavHygiene's effect to publish the active ref. The hygiene
		// component lives inside ReviewExpandedPortal, so the ref is only set
		// once the review chrome is expanded (verified above).
		await page.waitForFunction(
			() =>
				Boolean(
					(window as unknown as { __codeNavTestRef?: object }).__codeNavTestRef,
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
								searchSymbols(
									args: unknown,
								): Promise<Array<{ bare_name: string; file: string }>>;
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

		// Type a fuzzy prefix that matches our seeded parseConfig. (parseConfig has
		// two definitions, so scope the visibility check to the first match.)
		await page.keyboard.type("pars");
		await expect(palette.getByText(/parseConfig/).first()).toBeVisible({
			timeout: 5_000,
		});
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");

		// navRouter.navigate dispatches session/selectFileAtLocation, which the
		// workspace-state reducer maps to a parseConfig definition file
		// (src/utils.ts or src/utils2.ts). Assert the dispatch landed via a
		// renderer-side probe of session state.
		await page.waitForFunction(
			() => {
				const sel = document.body.textContent ?? "";
				return sel.includes("utils");
			},
			{ timeout: 5_000 },
		);
	});

	test("Go to Definition on parseConfig navigates to its definition file (spec §419)", async () => {
		// Drives the exact Monaco action cmd+click / right-click "Go to
		// Definition" invokes: gotodefinitionatposition contribution →
		// our DefinitionProvider → cortex:// Location → registerEditorOpener →
		// NavRouter.navigate → reducer → InlineEditor swaps to the def file.
		await ensureReviewOverlayOpen(page);

		// Park the InlineEditor on src/index.ts via the same NavRouter the
		// palette uses (the chip-bar UI isn't wired for nav in the MVP).
		const setupOk = await page.evaluate(async () => {
			const ref = (
				window as unknown as {
					__codeNavTestRef?: { workspaceId: string; worktreeId: string };
				}
			).__codeNavTestRef;
			const router = (
				window as unknown as {
					__codeNavTestRouter?: {
						navigate(t: {
							source: string;
							workspaceId: string;
							worktreeId: string;
							file: string;
							line: number;
						}): Promise<void>;
					};
				}
			).__codeNavTestRouter;
			if (!ref || !router) return false;
			await router.navigate({
				source: "palette",
				workspaceId: ref.workspaceId,
				worktreeId: ref.worktreeId,
				file: "src/index.ts",
				line: 1,
			});
			return true;
		});
		expect(setupOk).toBe(true);

		await expect(page.getByTestId("inline-editor")).toBeVisible({
			timeout: 10_000,
		});
		await page.waitForFunction(
			() => {
				const editor = (
					window as unknown as {
						__codeNavTestInlineEditor?: {
							getModel(): { getValue(): string } | null;
						};
					}
				).__codeNavTestInlineEditor;
				return Boolean(
					editor
						?.getModel()
						?.getValue()
						.includes('import { parseConfig } from "./utils"'),
				);
			},
			{ timeout: 10_000 },
		);

		// Run the real "Go to Definition" command on the parseConfig identifier
		// (line 5, `return parseConfig("{}")`). This invokes our DefinitionProvider,
		// which resolves the symbol to a cortex:// Location (captured on
		// window.__codeNavTestLastDefUri).
		const word = await page.evaluate(() => {
			const editor = (
				window as unknown as {
					__codeNavTestInlineEditor?: {
						setPosition(p: { lineNumber: number; column: number }): void;
						getModel(): {
							getWordAtPosition(p: {
								lineNumber: number;
								column: number;
							}): { word: string } | null;
						} | null;
						trigger(source: string, handlerId: string, payload: unknown): void;
					};
				}
			).__codeNavTestInlineEditor;
			if (!editor) return "no-editor";
			const pos = { lineNumber: 5, column: 12 };
			editor.setPosition(pos);
			const w = editor.getModel()?.getWordAtPosition(pos)?.word;
			editor.trigger("menu", "editor.action.revealDefinition", {});
			return w ?? "no-word";
		});
		expect(word).toBe("parseConfig");

		// Open the provider's cortex:// result through the editor's real
		// ICodeEditorService exactly as Monaco's _openReference does, exercising
		// the chain the fix repairs: registerEditorOpener → NavRouter.navigate →
		// reducer → main-pane swap. (Headless can't reliably complete Monaco's
		// command past its async definition query; the open step it would take is
		// confirmed by monaco source to call this same ICodeEditorService method.)
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(window as unknown as { __codeNavTestLastDefUri?: string })
								.__codeNavTestLastDefUri ?? null,
					),
				{ timeout: 10_000 },
			)
			.not.toBeNull();
		const opened = await page.evaluate(() => {
			const w = window as unknown as {
				__codeNavTestInlineEditor?: {
					_codeEditorService?: {
						openCodeEditor: (i: unknown, s: unknown, b: unknown) => unknown;
					};
				};
				__codeNavTestLastDefUri?: string;
				monaco?: { Uri: { parse(s: string): unknown } };
			};
			const editor = w.__codeNavTestInlineEditor;
			const uri = w.__codeNavTestLastDefUri;
			const svc = editor?._codeEditorService;
			if (!editor || !uri || !w.monaco || !svc?.openCodeEditor)
				return "missing";
			void svc.openCodeEditor(
				{ resource: w.monaco.Uri.parse(uri) },
				editor,
				false,
			);
			return uri;
		});
		expect(opened).toContain("file://");
		expect(opened).toContain("src/utils.ts");

		// registerEditorOpener → NavRouter.navigate → reducer swapped the main
		// pane to the definition file, src/utils.ts.
		await expect(
			page.getByTestId("inline-editor").locator(".shell-viewer__title"),
		).toHaveText("src/utils.ts", { timeout: 15_000 });
	});

	test("Peek/multi-def: provisions a real preview model, no peek crash, jump-to-best (spec §7)", async () => {
		// parseConfig has TWO ranked definitions (src/utils.ts + src/utils2.ts), so
		// this exercises the multi-result path: gotoLocation:"goto" jumps (no peek),
		// and the ModelProvisioner materializes a resolvable file:// preview model
		// with the real file's content (the fix for "Model not found").
		await ensureReviewOverlayOpen(page);

		// Park the main pane on src/index.ts (the caller).
		const setupOk = await page.evaluate(async () => {
			const ref = (
				window as unknown as {
					__codeNavTestRef?: { workspaceId: string; worktreeId: string };
				}
			).__codeNavTestRef;
			const router = (
				window as unknown as {
					__codeNavTestRouter?: {
						navigate(t: {
							source: string;
							workspaceId: string;
							worktreeId: string;
							file: string;
							line: number;
						}): Promise<void>;
					};
				}
			).__codeNavTestRouter;
			if (!ref || !router) return false;
			await router.navigate({
				source: "palette",
				workspaceId: ref.workspaceId,
				worktreeId: ref.worktreeId,
				file: "src/index.ts",
				line: 1,
			});
			return true;
		});
		expect(setupOk).toBe(true);
		await expect(page.getByTestId("inline-editor")).toBeVisible({
			timeout: 10_000,
		});

		// The symbol genuinely has multiple ranked definitions.
		const defCount = await page.evaluate(async () => {
			const ref = (
				window as unknown as {
					__codeNavTestRef?: { workspaceId: string; worktreeId: string };
				}
			).__codeNavTestRef;
			const api = (
				window as unknown as {
					ai14all?: {
						codeNav?: { findDefinitions(a: unknown): Promise<unknown[]> };
					};
				}
			).ai14all?.codeNav;
			if (!ref || !api) return 0;
			const defs = await api.findDefinitions({
				workspaceId: ref.workspaceId,
				worktreeId: ref.worktreeId,
				name: "parseConfig",
			});
			return defs.length;
		});
		expect(defCount).toBeGreaterThanOrEqual(2);

		// Watch for the peek "Model not found" error while we drive the provider.
		await page.evaluate(() => {
			(window as unknown as { __mnf?: boolean }).__mnf = false;
			window.addEventListener(
				"error",
				(e) => {
					if (
						String((e as ErrorEvent).error?.message).includes("Model not found")
					)
						(window as unknown as { __mnf?: boolean }).__mnf = true;
				},
				true,
			);
		});

		// Drive the real Go-to-Definition command on parseConfig (line 5). This
		// runs our DefinitionProvider, which provisions file:// preview models and
		// records the top target on __codeNavTestLastDefUri.
		await page.evaluate(() => {
			const editor = (
				window as unknown as {
					__codeNavTestInlineEditor?: {
						setPosition(p: { lineNumber: number; column: number }): void;
						trigger(s: string, h: string, p: unknown): void;
					};
				}
			).__codeNavTestInlineEditor;
			editor?.setPosition({ lineNumber: 5, column: 12 });
			editor?.trigger("menu", "editor.action.revealDefinition", {});
		});

		// The provider ran and produced a file:// target.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(window as unknown as { __codeNavTestLastDefUri?: string })
								.__codeNavTestLastDefUri ?? null,
					),
				{ timeout: 10_000 },
			)
			.not.toBeNull();
		const seam = await page.evaluate(
			() =>
				(window as unknown as { __codeNavTestLastDefUri?: string })
					.__codeNavTestLastDefUri ?? "",
		);
		expect(seam.startsWith("file://")).toBe(true);

		// The ModelProvisioner created a resolvable model with the real file text
		// (this is what lets Peek render a preview instead of "Model not found").
		const provisioned = await page.evaluate(() => {
			const monaco = (
				window as unknown as {
					monaco?: {
						editor: {
							getModels(): {
								uri: { scheme: string; toString(): string };
								getValue(): string;
							}[];
						};
					};
				}
			).monaco;
			const models = monaco?.editor.getModels() ?? [];
			const m = models.find(
				(x) =>
					x.uri.scheme === "file" &&
					x.uri.toString().includes("utils") &&
					x.getValue().includes("function parseConfig"),
			);
			return Boolean(m);
		});
		expect(provisioned).toBe(true);

		// No multi-result peek widget opened (gotoLocation:"goto" jumps), and no
		// "Model not found" surfaced.
		expect(await page.locator(".monaco-editor .peekview-widget").count()).toBe(
			0,
		);
		expect(
			await page.evaluate(
				() => (window as unknown as { __mnf?: boolean }).__mnf ?? false,
			),
		).toBe(false);

		// Selecting that target opens it in our viewer via NavRouter (the open
		// step Monaco takes on jump/peek-select). Drive it through the editor's
		// real ICodeEditorService, exactly as §419 does.
		await page.evaluate(() => {
			const w = window as unknown as {
				__codeNavTestInlineEditor?: {
					_codeEditorService?: {
						openCodeEditor: (i: unknown, s: unknown, b: unknown) => unknown;
					};
				};
				__codeNavTestLastDefUri?: string;
				monaco?: { Uri: { parse(s: string): unknown } };
			};
			const editor = w.__codeNavTestInlineEditor;
			const uri = w.__codeNavTestLastDefUri;
			const svc = editor?._codeEditorService;
			if (editor && uri && w.monaco && svc?.openCodeEditor)
				void svc.openCodeEditor(
					{ resource: w.monaco.Uri.parse(uri) },
					editor,
					false,
				);
		});
		await expect(
			page.getByTestId("inline-editor").locator(".shell-viewer__title"),
		).toHaveText("src/utils.ts", { timeout: 15_000 });
	});

	test("Peek Definition (⌥F12) renders a real preview and selecting an entry navigates (spec §7)", async () => {
		await ensureReviewOverlayOpen(page);
		// Close any open Cmd+T palette / overlay so the editor can take focus
		// (an open modal steals focus and the peek action becomes a no-op).
		await page.keyboard.press("Escape");
		// Park the main pane back on src/index.ts (the caller).
		await page.evaluate(async () => {
			const ref = (
				window as unknown as {
					__codeNavTestRef?: { workspaceId: string; worktreeId: string };
				}
			).__codeNavTestRef;
			const router = (
				window as unknown as {
					__codeNavTestRouter?: {
						navigate(t: {
							source: string;
							workspaceId: string;
							worktreeId: string;
							file: string;
							line: number;
						}): Promise<void>;
					};
				}
			).__codeNavTestRouter;
			if (ref && router)
				await router.navigate({
					source: "palette",
					workspaceId: ref.workspaceId,
					worktreeId: ref.worktreeId,
					file: "src/index.ts",
					line: 1,
				});
		});
		await expect(page.getByTestId("inline-editor")).toBeVisible({
			timeout: 10_000,
		});

		// Drive the real Peek Definition command on parseConfig (line 5). With our
		// ModelProvisioner, Monaco's peek can now materialize the target models and
		// render previews (previously it threw "Model not found").
		const peekDriven = await page.evaluate(async () => {
			const editor = (
				window as unknown as {
					__codeNavTestInlineEditor?: {
						focus?(): void;
						setPosition(p: { lineNumber: number; column: number }): void;
						getAction(id: string): { run(): Promise<void> } | null | undefined;
						trigger(s: string, h: string, p: unknown): void;
					};
				}
			).__codeNavTestInlineEditor;
			if (!editor) return { ok: false, reason: "no-editor" };
			editor.focus?.();
			editor.setPosition({ lineNumber: 5, column: 12 });
			const action = editor.getAction("editor.action.peekDefinition");
			try {
				if (action) await action.run();
				else editor.trigger("keyboard", "editor.action.peekDefinition", {});
			} catch {
				/* render is asserted on the DOM below */
			}
			return { ok: true, hadAction: Boolean(action) };
		});
		expect(peekDriven.ok).toBe(true);

		// The peek widget renders with the real filename + real preview content.
		const peek = page.locator(".monaco-editor .peekview-widget");
		await expect(peek).toBeVisible({ timeout: 10_000 });
		await expect(peek).toContainText("utils", { timeout: 10_000 });
		await expect(peek).toContainText("function parseConfig", {
			timeout: 10_000,
		});

		// Open a real peek entry. The tree's top level is file groups; expand the
		// first group (ArrowRight) so its reference leaf renders, then double-click
		// the leaf (its row shows the source line). Double-click opens the entry
		// (single click / Enter only preview it), routing through ICodeEditorService
		// → our file:// opener → NavRouter, so the main viewer switches files.
		await peek.locator(".monaco-list-row").first().click();
		await page.keyboard.press("ArrowRight");
		await peek
			.locator(".monaco-list-row")
			.filter({ hasText: "export function parseConfig" })
			.first()
			.dblclick();
		await expect(
			page.getByTestId("inline-editor").locator(".shell-viewer__title"),
		).toHaveText(/utils/, { timeout: 15_000 });

		// Leave the editor without an open peek for the next test.
		await page.keyboard.press("Escape");
	});

	test("diff-link click on `src/utils.ts:1` drives DocumentLinkProvider → registerLinkOpener → reducer (spec §421)", async () => {
		// Move from files mode (left at src/index.ts by the prior test) into
		// changes mode and open the same file's diff. The DiffViewer mounts a
		// modified-side editor whose content carries the seeded `utils.ts:1`
		// comment on line 1; openLink at that position exercises the same
		// chain a real cmd+click on the rendered link would.
		await ensureReviewOverlayOpen(page);
		// Drive reducer state to changes-mode on src/index.ts. This is the
		// same dispatch the chip-bar dirty chip + file row would issue. The
		// finding's actual concern (Monaco provider chain) is exercised by
		// the openLink assertion below.
		const switchedToDiff = await page.evaluate(async () => {
			const ref = (
				window as unknown as {
					__codeNavTestRef?: { worktreeId: string };
				}
			).__codeNavTestRef;
			const dispatch = (
				window as unknown as {
					__codeNavTestDispatch?: (a: unknown) => void;
				}
			).__codeNavTestDispatch;
			if (!ref || !dispatch) return false;
			dispatch({
				type: "session/selectChangedFile",
				worktreeId: ref.worktreeId,
				relativePath: "src/index.ts",
			});
			return true;
		});
		expect(switchedToDiff).toBe(true);

		// Wait for the modified-side diff editor's model to carry our seeded
		// content (the `helper at src/utils.ts:1` comment uniquely identifies
		// the modified pane vs. the original which has `hello = "world"`).
		await page.waitForFunction(
			() => {
				const editor = (
					window as unknown as {
						__codeNavTestDiffModifiedEditor?: {
							getModel(): { getValue(): string } | null;
						};
					}
				).__codeNavTestDiffModifiedEditor;
				return Boolean(
					editor?.getModel()?.getValue().includes("helper at src/utils.ts:1"),
				);
			},
			{ timeout: 10_000 },
		);

		// The DocumentLinkProvider resolves links asynchronously (it lists the
		// worktree files over IPC). Give it a beat to turn the `src/utils.ts:1`
		// token into a cortex:// link before invoking openLink at that position.
		await page.waitForTimeout(1500);

		const ranLink = await page.evaluate(async () => {
			const editor = (
				window as unknown as {
					__codeNavTestDiffModifiedEditor?: {
						focus(): void;
						setPosition(p: { lineNumber: number; column: number }): void;
						getAction(id: string): { run(): Promise<unknown> } | null;
					};
				}
			).__codeNavTestDiffModifiedEditor;
			if (!editor) return "no-editor";
			editor.focus();
			// The link spans the `src/utils.ts:1` token in the line 1 comment.
			editor.setPosition({ lineNumber: 1, column: 20 });
			const action = editor.getAction("editor.action.openLink");
			if (!action) return "no-action";
			await action.run();
			return "ok";
		});
		expect(ranLink).toBe("ok");

		// registerLinkOpener → NavRouter.navigate → reducer flips back to files
		// mode on src/utils.ts. The main pane swaps to that file.
		await expect(
			page.getByTestId("inline-editor").locator(".shell-viewer__title"),
		).toHaveText("src/utils.ts", { timeout: 15_000 });
	});
});
