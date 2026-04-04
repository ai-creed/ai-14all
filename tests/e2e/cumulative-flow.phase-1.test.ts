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

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase1-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			ONEFORALL_WORKSPACE_STATE_PATH: join(persistedStateDir, "workspace-state.json"),
		},
	});
	page = await app.firstWindow();
});

test.afterAll(async () => {
	try {
		if (app) await app.close();
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 1", () => {
	test("shows the stable session shell after repository load", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		await expect(page.getByText("Active branch")).toBeVisible();
		await expect(page.getByText("Worktree path")).toBeVisible();
		await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
		await expect(page.getByRole("tab", { name: "Changes" })).toBeVisible();
	});
});
