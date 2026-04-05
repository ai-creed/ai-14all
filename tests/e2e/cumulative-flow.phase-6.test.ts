import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let workspaceStatePath: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase6-")));
	workspaceStatePath = join(persistedStateDir, "workspace-state.json");
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			ONEFORALL_E2E: "1",
			ONEFORALL_WORKSPACE_STATE_PATH: workspaceStatePath,
		},
	});
	page = await app.firstWindow();
});

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 6", () => {
	test("shows a default shell, opens a terminal tab context menu, and reviews a recent commit", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();

		await page.getByRole("tab", { name: "shell 1" }).click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Pin" })).toBeVisible();
		await page.keyboard.press("Escape");

		await page.getByRole("tab", { name: "Commits" }).click();
		await expect(page.getByText("origin/main")).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: /feature commit/i }),
		).toBeVisible();
		await expect(page.getByText("Diff vs HEAD")).toHaveCount(0);

		const scrollCheck = await page.evaluate(() => ({
			body: document.body.scrollHeight > document.body.clientHeight,
			root:
				document.documentElement.scrollHeight >
				document.documentElement.clientHeight,
		}));
		expect(scrollCheck.body).toBe(false);
		expect(scrollCheck.root).toBe(false);
	});
});
