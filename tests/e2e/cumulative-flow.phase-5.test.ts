import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;

// These helpers support multi-launch — this suite relaunches the app to test
// persistence across sessions, unlike single-launch phase tests.
async function launchApp() {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}

async function closeApp() {
	if (app) {
		const proc = app.process();
		await Promise.race([
			app.close(),
			new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
		]);
		if (!proc.killed) proc.kill("SIGKILL");
		// Allow the OS to fully release the process resources before relaunching
		await new Promise<void>((resolve) => setTimeout(resolve, 500));
		app = undefined;
	}
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase5-")));
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	await launchApp();
}, 60_000);

test.afterAll(async () => {
	try {
		await closeApp();
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 5", () => {
	// Each test in this suite launches the Electron app at least once and
	// may launch it twice; 120 s gives ample headroom for slower CI machines
	// and resource contention from parallel workers.
	test.describe.configure({ timeout: 120_000 });

	test("restores the selected session and lazily hydrates another saved worktree", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		// Phase 6: a default "shell 1" is auto-created on worktree activation.
		// Wait for it to be stable before interacting with the Changes panel.
		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible({ timeout: 10_000 });
		await page.getByRole("textbox", { name: "Session note" }).fill("resume here");
		// Phase 6: force clicks in the review panel because the xterm pane in
		// the same column keeps the accessibility tree in flux.
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });
		await page.getByRole("button", { name: /src\/index\.ts/ }).click({ force: true });

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }) // partial match, accessible name is "main main"
			.click();
		// Phase 6: the default shell is auto-created when main is selected.
		// Wait for it so the session is persisted with at least one process.
		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible({ timeout: 10_000 });

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await closeApp();
		await launchApp();

		await page.getByRole("button", { name: "Restore previous workspace" }).click();

		await expect(
			page.getByRole("navigation", { name: "Worktree sessions" }).getByRole("button", {
				name: /feature-a/i,
			}),
		).toHaveAttribute("data-selected", "true");
		await expect(page.getByRole("textbox", { name: "Session note" })).toHaveValue("resume here");
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();
		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();

		// The main session's shell has not been hydrated yet — TerminalTabs
		// only renders the active session's tabs, so there are no tabs belonging
		// to main while feature-a is selected.
		// Phase 6: feature-a has one shell (the default shell 1, auto-created
		// when the worktree was activated above).
		await expect(page.getByRole("tab", { name: /^shell \d/ })).toHaveCount(1);

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }) // partial match
			.click();

		// After lazy hydration of the main session its shell tabs become visible.
		// Phase 6: main gets an auto-created default shell. We match any tab in
		// the terminal tablist rather than "shell 1" because the xterm title may
		// have already changed to the shell CWD by the time we check.
		await expect(
			page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab").first(),
		).toBeVisible();
	});

	test("remembers a start-clean choice when asked", async () => {
		await closeApp();
		await launchApp();

		// Relies on workspace state written by the first test
		await expect(
			page.getByRole("button", { name: "Restore previous workspace" }),
		).toBeVisible({ timeout: 5_000 });

		await page.getByLabel("Remember my choice").check();
		await page.getByRole("button", { name: "Start clean" }).click();

		await expect(
			page.getByRole("button", { name: "Load" }),
		).toBeVisible();

		await closeApp();
		await launchApp();

		await expect(
			page.getByRole("button", { name: "Restore previous workspace" }),
		).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Load" })).toBeVisible();
	});

	test("remembers an always-restore choice and auto-restores on the next launch", async () => {
		// Close the app left running by the previous test, then write a known
		// state directly so this test does not depend on the prior tests' state.
		// Worktree IDs equal the filesystem path of each worktree
		// (see services/worktrees/parse-worktree-porcelain.ts).
		await closeApp();

		writeFileSync(
			persistedStatePath,
			JSON.stringify({
				version: 1,
				restorePreference: "prompt",
				snapshot: {
					repositoryPath: testRepo.repoPath,
					selectedWorktreeId: testRepo.worktreePath,
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: testRepo.worktreePath,
							note: "always-restore note",
							reviewMode: "files",
							viewerMode: "file",
							selectedFilePath: null,
							selectedChangedFilePath: null,
							activeProcessSessionId: null,
							nextAdHocNumber: 1,
							processSessions: [],
						},
					],
				},
			}),
		);

		await launchApp();

		await expect(
			page.getByRole("button", { name: "Restore previous workspace" }),
		).toBeVisible({ timeout: 5_000 });

		// Tick "Remember my choice" and restore — this persists alwaysRestore
		await page.getByLabel("Remember my choice").check();
		await page.getByRole("button", { name: "Restore previous workspace" }).click();

		await expect(
			page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: /feature-a/i }),
		).toHaveAttribute("data-selected", "true");
		await expect(page.getByRole("textbox", { name: "Session note" })).toHaveValue("always-restore note");

		await closeApp();
		await launchApp();

		// The restore prompt must NOT appear — alwaysRestore skips it
		await expect(
			page.getByRole("button", { name: "Restore previous workspace" }),
		).toHaveCount(0);

		await expect(
			page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: /feature-a/i }),
		).toHaveAttribute("data-selected", "true");
		await expect(page.getByRole("textbox", { name: "Session note" })).toHaveValue("always-restore note");
	});

	test("recovers the previous workspace after the repository directory is renamed", async () => {
		// Start from a clean state so this test doesn't depend on previous test outcomes
		await closeApp();
		writeFileSync(
			persistedStatePath,
			JSON.stringify({ version: 1, restorePreference: "alwaysRestore", snapshot: null }),
		);
		await launchApp();

		// Load the repo and set up a session note to verify later
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible({ timeout: 10_000 });
		await page.getByRole("textbox", { name: "Session note" }).fill("resume here");

		// Close the app — this persists the snapshot with the original path
		await closeApp();

		// Rename the repo directory to simulate a repo move/rename
		const renamedRepoPath = `${testRepo.repoPath}-renamed`;
		renameSync(testRepo.repoPath, renamedRepoPath);

		// Relaunch — auto-restore fails (old path no longer exists) but snapshot is preserved
		await launchApp();
		await expect(page.getByRole("button", { name: "Load" })).toBeVisible({ timeout: 10_000 });

		// Manually open the repo at its new path — reattachment should kick in
		await page.locator("#repo-path").fill(renamedRepoPath);
		await page.getByRole("button", { name: "Load" }).click();

		// The session note must be recovered
		await expect(page.getByRole("textbox", { name: "Session note" })).toHaveValue("resume here", { timeout: 15_000 });
		// A recovery banner must be visible
		await expect(page.getByRole("status")).toContainText(/recovered/i);

		// Cleanup: rename back so testRepo.cleanup() can run correctly in afterAll,
		// or remove the renamed directory directly since the original path is now gone
		renameSync(renamedRepoPath, testRepo.repoPath);
	});
});
