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
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase2-")));
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
		await expect(page.getByText("Active branch")).toBeVisible();
	});

	test("opens multiple terminal tabs for the selected worktree", async () => {
		await worktreeNav()
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();
		await page.getByRole("button", { name: "+ Shell" }).click();
		await page.getByRole("button", { name: "+ Shell" }).click();

		await expect(
			page.getByRole("tab", {
				name: /^shell 1(?: \((?:error|exited)\))?$/i,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("tab", {
				name: /^shell 2(?: \((?:error|exited)\))?$/i,
			}),
		).toBeVisible();
		await page.getByRole("tab", { name: /^shell 2/i }).click();
		await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 10_000 });
	});

	test("switches worktrees and restores the per-session note", async () => {
		await page.getByLabel("Session note").fill("Main session note");
		await worktreeNav()
			.getByRole("button", { name: /feature-a/i })
			.click();
		await page.getByLabel("Session note").fill("Feature note");
		await worktreeNav()
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		await expect(page.getByLabel("Session note")).toHaveValue(
			"Main session note",
		);
	});

	test("shows changed files and opens a unified diff", async () => {
		await worktreeNav()
			.getByRole("button", { name: /feature-a/i })
			.click();
		await page.getByRole("tab", { name: "Changes" }).click();

		const changedFileButton = page.getByRole("button", {
			name: /src\/index\.ts/,
		});
		await changedFileButton.click();

		await expect(page.locator(".monaco-editor")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText("diff --git")).toBeVisible();
	});
});
