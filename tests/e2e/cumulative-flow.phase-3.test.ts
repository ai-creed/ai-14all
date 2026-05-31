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

test.describe.serial("Cumulative flow — Phase 3", () => {
	const worktreeNav = () =>
		page.getByRole("navigation", { name: "Sessions" });

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
			page
				.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
				.first(),
		).toBeVisible({ timeout: 10_000 });

		// Open preset manager and add a "Claude" preset.
		// "Manage presets" lives inside the "Presets" dropdown since the toolbar refactor.
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "Manage presets" }).click();
		await page.getByLabel("Preset label").fill("Claude");
		// Repeat the error output after a short delay so at least one chunk
		// arrives while another tab is active (Claude tab is viewed immediately
		// on launch, which suppresses attention escalation for the first chunk).
		await page
			.getByLabel("Preset command")
			.fill("printf 'error: phase 3\\n'; sleep 2; printf 'error: phase 3\\n'");
		await page.getByRole("button", { name: "Save preset" }).click();
		await page.getByRole("button", { name: "Close" }).click();

		// Launch the preset via the same "Presets" dropdown
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "Claude", exact: true }).click();

		// The launched preset occupies a terminal slot (label shown in its header).
		const claudeSlot = page
			.locator(".shell-terminal-slot__label", { hasText: /Claude/i })
			.first();
		await expect(claudeSlot).toBeVisible({ timeout: 10_000 });
	});

	test("restarts and closes a shell from the slot header actions", async () => {
		// A default shell occupies slot 0. Adding a shell auto-promotes the layout
		// and appends the new shell into the next slot.
		// A previous test opened the review overlay, which covers the terminal slot
		// grid. Collapse it so slot-header actions are clickable.
		const portal = page.getByTestId("review-expanded-portal");
		if (await portal.isVisible().catch(() => false)) {
			await page.getByRole("button", { name: /collapse full review/i }).click();
		}
		await expect(portal).toHaveCount(0, { timeout: 10_000 });
		// The default shell occupies slot 0 (Claude preset is in slot 1).
		await expect(page.getByTestId("slot-restart-0")).toBeVisible({
			timeout: 15_000,
		});

		// Operate on slot 0 (the default "shell 1"); the launched Claude preset in
		// slot 1 must survive for the attention tests below.
		const termTabs = page.locator(
			".shell-terminal-slot:not(.shell-terminal-slot--empty)",
		);
		const countBefore = await termTabs.count();

		// Restart slot 0 via its slot-header action; the slot stays occupied
		// (restart replaces the terminal in place — PTY exit status is environment
		// dependent and covered by unit tests, so we only assert the slot persists).
		await page.getByTestId("slot-restart-0").click();
		await expect(page.getByTestId("slot-0")).toBeVisible({ timeout: 10_000 });

		// Close slot 0 via the slot-header ✕; the occupied-slot count drops by one.
		await page.getByTestId("slot-close-0").click();
		await expect(termTabs).toHaveCount(countBefore - 1, { timeout: 10_000 });
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
		await page
			.locator(".shell-terminal-slot__label", { hasText: /Claude/i })
			.first()
			.click();

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
