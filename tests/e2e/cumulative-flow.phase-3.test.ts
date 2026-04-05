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
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase3-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			ONEFORALL_E2E: "1",
			ONEFORALL_WORKSPACE_STATE_PATH: join(persistedStateDir, "workspace-state.json"),
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

test.describe.serial("Cumulative flow — Phase 3", () => {
	const worktreeNav = () =>
		page.getByRole("navigation", { name: "Worktree sessions" });

	test("creates a preset and launches it in the selected worktree", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await expect(
			worktreeNav().getByRole("button", { name: /^main(?:\s+main)?$/i }),
		).toBeVisible({ timeout: 10_000 });

		await worktreeNav()
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		// Open preset manager and add a "Claude" preset
		await page.getByRole("button", { name: "Manage presets" }).click();
		await page.getByLabel("Preset label").fill("Claude");
		await page.getByLabel("Preset command").fill("printf 'error: phase 3\\n'");
		await page.getByRole("button", { name: "Save preset" }).click();
		await page.getByRole("button", { name: "Close dialog" }).click();

		// Launch the preset
		await page.getByRole("button", { name: "Launch preset" }).click();
		await page.getByRole("menuitem", { name: "Claude" }).click();

		// Assert pinned process tab appears
		const pinnedTab = page.getByRole("tab", { name: /Claude/i });
		await expect(pinnedTab).toBeVisible({ timeout: 10_000 });
		await expect(pinnedTab).toHaveAttribute("data-pinned", "true");
	});

	test("stops, restarts, and closes an ad hoc shell from the tab actions menu", async () => {
		// Phase 6: a default "shell 1" is auto-created on worktree activation.
		// Clicking "+ Shell" now creates "shell 2". Tab actions are now accessed
		// via right-click context menu instead of a dedicated "Actions" button.
		await page.getByRole("button", { name: "+ Shell" }).click();

		const shellTab = page.getByRole("tab", { name: "shell 2" });
		await expect(shellTab).toBeVisible({ timeout: 10_000 });

		await shellTab.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Stop" }).click();
		await expect(
			page.getByRole("tab", { name: /^shell 2 \(exited(?:: \d+)?\)$/i }),
		).toBeVisible({ timeout: 10_000 });

		await page.getByRole("tab", { name: /^shell 2/ }).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Restart" }).click();
		await expect(page.getByRole("tab", { name: "shell 2" })).toBeVisible({
			timeout: 10_000,
		});

		await page.getByRole("tab", { name: "shell 2" }).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Close" }).click();
		await expect(
			page.getByRole("tab", { name: /^shell 2(?: \((?:error|exited)\))?$/i }),
		).toHaveCount(0);

		// After closing the ad-hoc shell, activate the Claude tab so that the
		// attention-clearing test (test 4) works: clicking main calls
		// markProcessViewed for the active process (Claude), which clears the
		// actionRequired attention set by Claude's "error: phase 3" output.
		await page.getByRole("tab", { name: /Claude/i }).click();
	});

	test("rolls action-required attention up to the sidebar", async () => {
		// Switch to the feature-a worktree so the main worktree is no longer selected
		await worktreeNav()
			.getByRole("button", { name: /feature-a/i })
			.click();

		// The "main" sidebar item should show actionRequired attention
		// because the preset command output "error: phase 3" which triggers the heuristic
		const mainSidebarItem = worktreeNav().getByRole("button", {
			name: /^main(?:\s+main)?$/i,
		});
		await expect(mainSidebarItem).toHaveAttribute(
			"data-attention",
			"actionRequired",
			{ timeout: 10_000 },
		);
	});

	test("clears attention when the worktree is selected", async () => {
		// Click back to the main worktree — this triggers session/markProcessViewed
		// which resets the active process's (Claude's) attention to idle.
		const mainSidebarItem = worktreeNav().getByRole("button", {
			name: /^main(?:\s+main)?$/i,
		});
		await mainSidebarItem.click();

		// Phase 6: the default shell (shell 1) may produce background output that
		// keeps the session at "activity" attention even after Claude is cleared.
		// The important invariant is that "actionRequired" is no longer present.
		await expect(mainSidebarItem).not.toHaveAttribute(
			"data-attention",
			"actionRequired",
			{ timeout: 10_000 },
		);
	});
});
