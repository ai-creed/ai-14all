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
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase4-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
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

test.describe.serial("Cumulative flow — Phase 4", () => {
	test("shows git context, opens a changed-file diff, and opens a nearby file", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		// Chip bar replaces the top band — verify session context is visible
		await expect(page.getByRole("region", { name: "Session" })).toBeVisible();
		// Wait for the git summary to finish loading — dirty chip appears once the
		// async readSummary call resolves.  This also stabilises the layout so
		// the xterm resize cycle has completed before we click list items.
		await expect(page.getByRole("button", { name: /\d+ changed/i })).toBeVisible({ timeout: 10_000 });

		// Phase 6: wait for the default shell tab to appear before interacting
		// with the review panel. We match any tab in the terminal tablist rather
		// than the exact title "shell 1" because the xterm title changes to the
		// shell's CWD almost immediately after the shell starts.
		await expect(
			page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab").first(),
		).toBeVisible({ timeout: 10_000 });

		// Phase 6: clicks inside the review panel use force:true because the xterm
		// pane in the same column keeps the accessibility tree in flux, causing
		// Playwright's stability check to time out even when the element is at its
		// correct position.
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });
		await page.getByRole("button", { name: /src\/index\.ts/ }).click({ force: true });
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();

		await page.getByRole("tab", { name: "Files" }).click({ force: true });
		await page.getByRole("button", { name: "src", exact: true }).click({ force: true });
		await page.getByRole("button", { name: "new-file.ts" }).click({ force: true });
		await expect(
			page.locator(".shell-viewer__title").getByText("src/new-file.ts", {
				exact: true,
			}),
		).toBeVisible();
	});
});
