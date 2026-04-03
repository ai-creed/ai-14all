import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	app = await electron.launch({ args: ["out/main/index.js"] });
	page = await app.firstWindow();
});

test.afterAll(async () => {
	try {
		if (app) await app.close();
	} finally {
		testRepo?.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 1", () => {
	test("shows the stable session shell after repository load", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page.getByRole("button", { name: /main/i }).click();

		await expect(page.getByText("Active branch")).toBeVisible();
		await expect(page.getByText("Worktree path")).toBeVisible();
		await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Changes" })).toBeVisible();
	});
});
