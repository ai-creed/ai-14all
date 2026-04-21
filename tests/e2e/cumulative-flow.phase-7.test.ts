import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { execSync } from "node:child_process";
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
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase7-")));
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

const worktreeNav = () => page.getByRole("navigation", { name: "Worktree sessions" });

test.describe.serial("Cumulative flow — Phase 7", () => {
	test("loads the repository and shows worktrees in the sidebar", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		await expect(worktreeNav().getByRole("button", { name: "feature-a", exact: true })).toBeVisible({
			timeout: 15_000,
		});
	});

	test("creates a new worktree via the New Worktree dialog", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "New session" }).click();
		await page.getByRole("dialog", { name: "New session" }).getByLabel("Name").fill("Feature B");
		await expect(page.getByText("/.worktrees/feature-b")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("dialog", { name: "New session" }).getByText("origin/master")).toBeVisible();
		await page.getByRole("button", { name: "Create worktree" }).click();
		await expect(worktreeNav().getByRole("button", { name: "feature-b", exact: true })).toBeVisible({
			timeout: 15_000,
		});
	});

	test("reflects branch rename in the sidebar after Refresh review", async () => {
		test.setTimeout(60_000);
		execSync(
			`git -C "${join(testRepo.repoPath, ".worktrees", "feature-b")}" switch -c feature-b-renamed`,
			{ stdio: "ignore" },
		);
		await page.getByRole("button", { name: "Refresh review" }).click();
		await expect(worktreeNav().getByText("feature-b-renamed")).toBeVisible({ timeout: 15_000 });
	});

	test("picks up an externally added worktree after Refresh review", async () => {
		test.setTimeout(60_000);
		const externalPath = join(testRepo.repoPath, ".worktrees", "outside-added");
		execSync(`git -C "${testRepo.repoPath}" branch outside-added origin/master`, {
			stdio: "ignore",
		});
		execSync(
			`git -C "${testRepo.repoPath}" worktree add "${externalPath}" outside-added`,
			{ stdio: "ignore" },
		);
		await page.getByRole("button", { name: "Refresh review" }).click();
		await expect(worktreeNav().getByRole("button", { name: "outside-added", exact: true })).toBeVisible({
			timeout: 15_000,
		});
	});

	test("removes feature-a via the Remove Worktree dialog and deletes its branch", async () => {
		test.setTimeout(60_000);
		await worktreeNav().getByRole("button", { name: "feature-a", exact: true }).click();
		await worktreeNav().getByRole("button", { name: "feature-a", exact: true }).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Remove worktree" }).click();
		// The fixture intentionally leaves feature-a dirty with uncommitted file changes.
		await expect(page.getByText("Dirty worktree: yes")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText(/Running app sessions:/)).toBeVisible({ timeout: 10_000 });
		await page.getByRole("checkbox", { name: /I understand this worktree has uncommitted changes/ }).check();
		await page.getByRole("button", { name: "Remove worktree" }).click();
		// Wait for the dialog to close before checking the sidebar and branch.
		// While the Radix UI dialog is open it sets aria-hidden on the rest of the
		// page, so sidebar buttons are not findable via getByRole until it closes.
		await expect(page.getByRole("dialog", { name: "Remove worktree" })).toHaveCount(0, {
			timeout: 15_000,
		});
		await expect(worktreeNav().getByRole("button", { name: "feature-a", exact: true })).toHaveCount(0, {
			timeout: 5_000,
		});
		expect(
			execSync(`git -C "${testRepo.repoPath}" branch --list feature-a`).toString().trim(),
		).toBe("");
	});

	test("drops an externally removed worktree from the sidebar after Refresh review", async () => {
		test.setTimeout(60_000);
		const externalPath = join(testRepo.repoPath, ".worktrees", "outside-added");
		execSync(`git -C "${testRepo.repoPath}" worktree remove "${externalPath}" --force`, {
			stdio: "ignore",
		});
		execSync(`git -C "${testRepo.repoPath}" branch -D outside-added`, { stdio: "ignore" });
		await page.getByRole("button", { name: "Refresh review" }).click();
		await expect(worktreeNav().getByRole("button", { name: "outside-added", exact: true })).toHaveCount(0, {
			timeout: 15_000,
		});
	});
});
