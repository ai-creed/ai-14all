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
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase2-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_WORKSPACE_STATE_PATH: join(persistedStateDir, "workspace-state.json"),
		},
	});
	page = await app.firstWindow();
});

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 2", () => {
	const worktreeNav = () =>
		page.getByRole("navigation", { name: "Worktree sessions" });

	test("loads the repository and shows the session shell", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await expect(
			worktreeNav().getByRole("button", { name: /^main(?:\s+main)?$/i }),
		).toBeVisible({
			timeout: 10_000,
		});
		// Phase 6: "Active branch" label moved; SessionHeader now shows "Branch:"
		await expect(page.getByText("Branch:")).toBeVisible();
	});

	test("opens multiple terminal tabs for the selected worktree", async () => {
		await worktreeNav()
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		// Phase 6: a default "shell 1" is auto-created on worktree activation.
		// Wait for it, then add one more shell to reach two tabs.
		await expect(
			page.getByRole("tab", {
				name: /^shell 1(?: \((?:error|exited)\))?$/i,
			}),
		).toBeVisible({ timeout: 10_000 });
		await page.getByRole("button", { name: "Add shell" }).click();

		await expect(
			page.getByRole("tab", {
				name: /^shell 2(?: \((?:error|exited)\))?$/i,
			}),
		).toBeVisible({ timeout: 10_000 });
		await page.getByRole("tab", { name: /^shell 2/i }).click();
		await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 10_000 });
	});

	test("switches worktrees and restores the per-session note", async () => {
		await page.getByRole("textbox", { name: "Session note" }).fill("Main session note");
		await worktreeNav()
			.getByRole("button", { name: /feature-a/i })
			.click();
		await page.getByRole("textbox", { name: "Session note" }).fill("Feature note");
		await worktreeNav()
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		await expect(page.getByRole("textbox", { name: "Session note" })).toHaveValue(
			"Main session note",
		);
	});

	test("shows changed files and opens a unified diff", async () => {
		await worktreeNav()
			.getByRole("button", { name: /feature-a/i })
			.click();
		// Phase 6: force clicks inside the review panel because the xterm pane
		// in the same column keeps the accessibility tree in flux, causing
		// Playwright's stability check to time out on the file list buttons.
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });

		const changedFileButton = page.getByRole("button", {
			name: /src\/index\.ts/,
		});
		await changedFileButton.click({ force: true });

		// DiffEditor replaced the old raw-diff text editor — check the viewer header instead
		await expect(page.getByText("Diff vs HEAD")).toBeVisible({ timeout: 15_000 });
	});
});
