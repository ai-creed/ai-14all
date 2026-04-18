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
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase9-")));
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

test.describe.serial("Cumulative flow — Phase 9", () => {
	test("loads the repository and shows the worktree sidebar", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		await expect(
			page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: "feature-a", exact: true }),
		).toBeVisible({ timeout: 15_000 });

		// Select main worktree first so there is a "next" to navigate to
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: / main$/i })
			.click();
	});

	test("Cmd+] switches to the next worktree", async () => {
		test.setTimeout(30_000);
		// Press the shortcut — document listener handles it regardless of focus
		await page.keyboard.press("Meta+]");
		// feature-a should now be the active worktree (the only other one).
		// SessionSidebar sets data-selected="true" on the active worktree button.
		await expect(
			page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: "feature-a", exact: true }),
		).toHaveAttribute("data-selected", "true", { timeout: 10_000 });
	});

	test("Cmd+/ opens the shortcuts help modal", async () => {
		test.setTimeout(20_000);
		await page.keyboard.press("Meta+/");
		await expect(
			page.getByRole("dialog", { name: "Keyboard shortcuts" }),
		).toBeVisible({ timeout: 8_000 });
	});

	test("Escape closes the shortcuts help modal", async () => {
		test.setTimeout(10_000);
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", { name: "Keyboard shortcuts" }),
		).not.toBeVisible({ timeout: 5_000 });
	});
});
