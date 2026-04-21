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
import { ensureReviewDrawerOpen } from "./helpers/review-drawer";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase8-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(persistedStateDir, "workspace-state.json"),
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

test.describe.serial("Cumulative flow — Phase 8", () => {
	test("loads the repository and switches to Files tab showing the tree root", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		// Wait for the worktree sidebar to show feature-a
		await expect(
			page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: "feature-a", exact: true }),
		).toBeVisible({ timeout: 15_000 });

		// Click on the feature-a worktree so it becomes active
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: "feature-a", exact: true })
			.click();

		// Switch to Files tab
		await ensureReviewDrawerOpen(page);
		await page.getByRole("tab", { name: "Files" }).click();

		// Tree root row (worktree label) should be visible
		await expect(page.getByText("feature-a", { exact: true }).first()).toBeVisible({
			timeout: 15_000,
		});
	});

	test("expands src folder and shows child file", async () => {
		test.setTimeout(30_000);
		// The src directory row should be visible (root is expanded by default)
		const srcRow = page.locator(".shell-list__item--dir", { hasText: "src" });
		await expect(srcRow).toBeVisible({ timeout: 10_000 });

		// Click src to expand it
		await srcRow.click();

		// index.ts should now be visible as a child
		await expect(page.locator(".shell-list__item--tree", { hasText: "index.ts" })).toBeVisible({
			timeout: 5_000,
		});
	});

	test("search input filters files — non-matching file disappears, matching stays", async () => {
		test.setTimeout(30_000);
		const searchInput = page.getByLabel("Search files");
		await expect(searchInput).toBeVisible();

		// Type a search term that matches index.ts but not NOTES.md
		await searchInput.fill("index");

		// Wait for debounce (120ms) + render
		await page.waitForTimeout(300);

		// index.ts should still be visible
		await expect(page.locator(".shell-list__item--tree", { hasText: "index.ts" })).toBeVisible();

		// NOTES.md should not be visible
		await expect(page.locator(".shell-list__item--tree", { hasText: "NOTES.md" })).toHaveCount(0);
	});

	test("clear search restores all files; clicking a file shows it in viewer", async () => {
		test.setTimeout(30_000);
		const searchInput = page.getByLabel("Search files");

		// Clear the search
		await searchInput.fill("");
		await page.waitForTimeout(300);

		// NOTES.md should reappear (use exact text to avoid matching COMMIT_NOTES.md)
		const notesMdRow = page.locator(".shell-list__item--tree").filter({ hasText: /^NOTES\.md/ });
		await expect(notesMdRow).toBeVisible({ timeout: 5_000 });

		// Click NOTES.md to select it
		await notesMdRow.click();

		// FileViewer should show NOTES.md in the title
		await expect(page.locator(".shell-viewer__title", { hasText: "NOTES.md" })).toBeVisible({
			timeout: 10_000,
		});
	});

	test("right-clicking root row and clicking Refresh keeps the tree rendered", async () => {
		test.setTimeout(30_000);
		// Find the root row (worktree label = feature-a, rendered as a dir item)
		const rootRow = page.locator(".shell-list__item--dir").first();
		await expect(rootRow).toBeVisible();

		// Right-click to open context menu
		await rootRow.click({ button: "right" });

		// Click Refresh menu item
		await page.getByRole("menuitem", { name: "Refresh" }).click();

		// Tree should still render — root row still visible
		await expect(rootRow).toBeVisible({ timeout: 10_000 });

		// src folder row should still be visible after refresh
		await expect(page.locator(".shell-list__item--dir", { hasText: "src" })).toBeVisible({
			timeout: 10_000,
		});
	});
});
