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

test.describe.serial("Cumulative flow — Phase 4", () => {
	test("shows git context, opens a changed-file diff, and opens a nearby file", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await expect(
			page.getByText("Recent commits", { exact: true }).first(),
		).toBeVisible();

		await page.getByRole("tab", { name: "Changes" }).click();
		await page.getByRole("button", { name: /src\/index\.ts/ }).click();
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();

		await page.getByRole("tab", { name: "Files" }).click();
		await page.getByRole("button", { name: "new-file.ts" }).click();
		await expect(
			page.getByText("src/new-file.ts", { exact: true }),
		).toBeVisible();
	});
});
