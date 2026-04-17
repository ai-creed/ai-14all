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

test.describe.serial("Cumulative flow — Phase 3", () => {
	const worktreeNav = () =>
		page.getByRole("navigation", { name: "Worktree sessions" });

	test("creates a preset and launches it in the selected worktree", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await expect(
			worktreeNav().getByRole("button", { name: / main$/i }),
		).toBeVisible({ timeout: 10_000 });

		await worktreeNav()
			.getByRole("button", { name: / main$/i })
			.click();

		// Wait for the default shell to be ready before interacting with the toolbar.
		// The xterm title changes to the CWD quickly, so match any tab.
		await expect(
			page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab").first(),
		).toBeVisible({ timeout: 10_000 });

		// Open preset manager and add a "Claude" preset.
		// "Manage presets" lives inside the "Presets" dropdown since the toolbar refactor.
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "Manage presets" }).click();
		await page.getByLabel("Preset label").fill("Claude");
		await page.getByLabel("Preset command").fill("printf 'error: phase 3\\n'");
		await page.getByRole("button", { name: "Save preset" }).click();
		await page.getByRole("button", { name: "Close dialog" }).click();

		// Launch the preset via the same "Presets" dropdown
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "Claude", exact: true }).click();

		// Assert pinned process tab appears
		const pinnedTab = page.getByRole("tab", { name: /Claude/i });
		await expect(pinnedTab).toBeVisible({ timeout: 10_000 });
		await expect(pinnedTab).toHaveAttribute("data-pinned", "true");
	});

	test("stops, restarts, and closes an ad hoc shell from the tab actions menu", async () => {
		// Phase 6: a default "shell 1" is auto-created on worktree activation.
		// Clicking "+ Shell" now creates "shell 2". Tab actions are now accessed
		// via right-click context menu instead of a dedicated "Actions" button.
		//
		// The xterm title changes to the CWD almost immediately after each shell
		// starts, so tab names are not reliable identifiers. Instead, count tabs
		// before and after adding, and identify shell 2 by its position (last tab).
		const termTabs = page
			.getByRole("tablist", { name: "Terminal sessions" })
			.getByRole("tab");
		const countBefore = await termTabs.count();

		await page.getByRole("button", { name: "Add shell" }).click();
		await expect(termTabs).toHaveCount(countBefore + 1, { timeout: 10_000 });

		// The newly added shell is always appended last.
		const shellTab = termTabs.last();

		await shellTab.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Stop" }).click();
		await expect(shellTab).toHaveAttribute("data-status", /exited|error/, {
			timeout: 10_000,
		});

		await shellTab.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Restart" }).click();
		await expect(shellTab).toHaveAttribute("data-status", "running", {
			timeout: 10_000,
		});

		await shellTab.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Close" }).click();
		await expect(termTabs).toHaveCount(countBefore, { timeout: 10_000 });
	});

	test("rolls action-required attention up to the sidebar", async () => {
		// Switch to the feature-a worktree so the main worktree is no longer selected
		await worktreeNav()
			.getByRole("button", { name: /feature-a/i })
			.click();

		// The "main" sidebar item should show actionRequired attention
		// because the preset command output "error: phase 3" which triggers the heuristic
		const mainSidebarItem = worktreeNav().getByRole("button", {
			name: / main$/i,
		});
		await expect(mainSidebarItem).toHaveAttribute(
			"data-attention",
			"actionRequired",
			{ timeout: 20_000 },
		);
	});

	test("clears attention when the worktree is selected", async () => {
		const mainSidebarItem = worktreeNav().getByRole("button", {
			name: / main$/i,
		});
		await mainSidebarItem.click();

		// Explicitly view the Claude process to clear its actionRequired attention
		await page.getByRole("tab", { name: /Claude/i }).click();

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
