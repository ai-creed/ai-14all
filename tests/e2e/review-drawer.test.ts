import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStatePath: string;

function drawer() {
	return page.getByRole("region", { name: "Review" });
}

async function launchRaw(firstWindowTimeout = 60_000) {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow({ timeout: firstWindowTimeout });
}

async function firstLaunch() {
	await launchRaw();
	await page.getByRole("button", { name: "Browse" }).click();
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });
	await page
		.getByRole("navigation", { name: "Worktree sessions" })
		.getByRole("button", { name: /main/i })
		.click();
}

async function relaunch() {
	await launchRaw();
	await page
		.getByRole("button", { name: "Restore previous workspace" })
		.click();
	await expect(
		page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	// createTestRepo adds a linked worktree under `.worktrees/`, which leaves
	// the main worktree with an untracked `.worktrees/` entry. The auto-expand
	// test depends on main starting clean, so ignore `.worktrees/` and commit
	// the gitignore to make main fully clean.
	writeFileSync(join(testRepo.repoPath, ".gitignore"), ".worktrees/\n");
	execSync("git add .gitignore && git commit -m 'ignore worktrees'", {
		cwd: testRepo.repoPath,
	});
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-review-drawer-")));
	persistedStatePath = join(stateDir, "workspace-state.json");
	await firstLaunch();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		const stateDir = persistedStatePath.replace(/\/[^/]+$/, "");
		rmSync(stateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Review drawer", () => {
	test("new session defaults to collapsed — drawer is present but children are not", async () => {
		await expect(drawer()).toHaveAttribute("data-open", "false");
		await expect(page.getByRole("tab", { name: "Files" })).toHaveCount(0);
	});

	test("chevron toggles expand/collapse", async () => {
		await page.getByRole("button", { name: /expand review drawer/i }).click();
		await expect(drawer()).toHaveAttribute("data-open", "true");
		await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
		await page.getByRole("button", { name: /collapse review drawer/i }).click();
		await expect(drawer()).toHaveAttribute("data-open", "false");
	});

	test("refresh button does not toggle expansion", async () => {
		await expect(drawer()).toHaveAttribute("data-open", "false");
		await page.getByRole("button", { name: "Refresh review" }).click();
		await expect(drawer()).toHaveAttribute("data-open", "false");
	});

	test("clean→dirty auto-expands; explicit collapse suppresses re-expand in runtime", async () => {
		// Seed the clean summary first so the auto-expand hook has recorded
		// changedCount=0 for this worktreeId before the test writes anything.
		// The "✓ clean" badge is only rendered after cacheGitSummarySuccess
		// resolves, guaranteeing the hook has seen at least one sample.
		await expect(drawer().getByText(/clean/i)).toBeVisible({ timeout: 10_000 });

		writeFileSync(join(testRepo.repoPath, "dirty-file.txt"), "hello\n");
		// Retry git add in case the app holds the index.lock briefly
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				execSync("git add -A", { cwd: testRepo.repoPath });
				break;
			} catch (err) {
				if (attempt === 4) throw err;
				execSync("sleep 0.4");
			}
		}

		// Trigger a new summary fetch via the drawer's Refresh button — this
		// drives the 0→>0 transition.
		await page.getByRole("button", { name: "Refresh review" }).click();

		await expect(
			page.getByRole("button", { name: /\d+ changed/i }),
		).toBeVisible({ timeout: 10_000 });
		await expect(drawer()).toHaveAttribute("data-open", "true", { timeout: 5_000 });

		// Explicit collapse while dirty should stick through subsequent refreshes.
		await page.getByRole("button", { name: /collapse review drawer/i }).click();
		await expect(drawer()).toHaveAttribute("data-open", "false");

		writeFileSync(join(testRepo.repoPath, "dirty-file-2.txt"), "world\n");
		execSync("git add -A", { cwd: testRepo.repoPath });
		await page.getByRole("button", { name: "Refresh review" }).click();
		await expect(drawer()).toHaveAttribute("data-open", "false");
	});

	test("explicit drawer state persists across restart", async () => {
		await page.getByRole("button", { name: /expand review drawer/i }).click();
		await expect(drawer()).toHaveAttribute("data-open", "true");
		await closeApp(app);
		await relaunch();
		await expect(drawer()).toHaveAttribute("data-open", "true");
	});

	test("restored already-dirty session does NOT auto-expand after load", async () => {
		await page.getByRole("button", { name: /collapse review drawer/i }).click();
		await expect(drawer()).toHaveAttribute("data-open", "false");
		await closeApp(app);
		await relaunch();
		await expect(
			page.getByRole("button", { name: /\d+ changed/i }),
		).toBeVisible({ timeout: 10_000 });
		await expect(drawer()).toHaveAttribute("data-open", "false");
	});
});
