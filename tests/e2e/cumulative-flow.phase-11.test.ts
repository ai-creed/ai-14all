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
let develSha: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	// Give origin/devel a DISTINCT commit ("devel-only commit") via commit-tree so
	// selecting it is provably different from the default (origin/master = "initial
	// commit"). No real `origin` remote is configured, so the dialog's fetch-on-open
	// fails non-blocking and the picker falls back to these cached refs — which also
	// exercises the non-blocking-fetch path end-to-end.
	develSha = execSync(
		'git commit-tree HEAD^{tree} -p HEAD -m "devel-only commit"',
		{ cwd: testRepo.repoPath },
	)
		.toString()
		.trim();
	execSync(`git update-ref refs/remotes/origin/devel ${develSha}`, {
		cwd: testRepo.repoPath,
		stdio: "ignore",
	});

	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase11-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(
				persistedStateDir,
				"workspace-state.json",
			),
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

const worktreeNav = () =>
	page.getByRole("navigation", { name: "Worktree sessions" });

test.describe
	.serial("Cumulative flow — Phase 11 (base branch selection)", () => {
	test("loads the repository", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		await expect(
			worktreeNav().getByRole("button", { name: "feature-a", exact: true }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("defaults the base picker to origin/master and previews its commit", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "New session" }).click();
		const dialog = page.getByRole("dialog", { name: "New session" });
		await dialog.getByLabel("Name").fill("Base Pick");
		await expect(page.getByText("/.worktrees/base-pick")).toBeVisible({
			timeout: 15_000,
		});
		// The default base resolves to origin/master; its commit subject is unique to
		// the preview (the picker lists branch names, not commit subjects).
		await expect(dialog.getByText(/initial commit/)).toBeVisible({
			timeout: 15_000,
		});
	});

	test("selecting origin/devel recomputes the preview to its distinct commit", async () => {
		test.setTimeout(60_000);
		const dialog = page.getByRole("dialog", { name: "New session" });
		await dialog.getByRole("option", { name: "origin/devel" }).click();
		// Preview's Latest-commit line recomputes to origin/devel's distinct subject.
		await expect(dialog.getByText(/devel-only commit/)).toBeVisible({
			timeout: 15_000,
		});
	});

	test("creates the session branched off origin/devel", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Create worktree" }).click();
		await expect(
			worktreeNav().getByRole("button", { name: "base-pick", exact: true }),
		).toBeVisible({ timeout: 15_000 });

		// End-to-end proof: the new branch was created off origin/devel, not the default.
		const branchSha = execSync(
			`git -C "${testRepo.repoPath}" rev-parse base-pick`,
		)
			.toString()
			.trim();
		const masterSha = execSync(
			`git -C "${testRepo.repoPath}" rev-parse origin/master`,
		)
			.toString()
			.trim();
		const reflog = execSync(
			`git -C "${testRepo.repoPath}" reflog show base-pick`,
		).toString();
		expect(branchSha).toBe(develSha);
		expect(branchSha).not.toBe(masterSha);
		expect(reflog).toContain("branch: Created from origin/devel");
	});
});
