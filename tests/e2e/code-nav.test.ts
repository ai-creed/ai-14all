import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "code-nav-e2e-")),
	);
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
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
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
		expect(surface).not.toBeNull();
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

	test("IPC trust boundary: zod-strict schemas reject smuggled raw paths", async () => {
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
				return { rejected: false, message: null };
			} catch (e) {
				return {
					rejected: true,
					message: (e as Error).message ?? String(e),
				};
			}
		});
		expect(rejected.rejected).toBe(true);
	});

	// The following three acceptance scenarios from the spec require a
	// pre-built cortex JSON fixture and full Monaco interaction harness
	// (cmd+click on a function identifier, palette navigation, and clicking
	// a path:line link inside a diff). They are scoped here for the next
	// e2e iteration once the fixture cortex pipeline is wired up.
	test.skip("cmd+click jumps to definition and nav-back returns", async () => {
		// pending: requires fixture cortex JSON + UI cmd+click flow
	});

	test.skip("cmd+T palette navigates to a symbol", async () => {
		// pending: requires fixture cortex JSON + palette modal open + arrow+enter
	});

	test.skip("clicking a path link in a diff opens that file", async () => {
		// pending: requires fixture cortex JSON + diff hunk with embedded path:line
	});
});
