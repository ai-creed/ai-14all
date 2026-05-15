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
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-tab-focus-")),
	);
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

/**
 * Locator for the terminal-tablist tab list. Terminal tabs no longer label
 * themselves "shell N" — xterm relabels them with the working-directory path
 * almost immediately. Identify tabs positionally instead.
 */
function terminalTablist() {
	return page.getByRole("tablist", { name: /terminal sessions/i });
}

/**
 * Wait for the terminal tab at `index` (0-based) to be visible and for its
 * xterm pane to be ready (i.e. the textarea exists — xterm creates it on open()).
 */
async function waitForShellTab(index: number, timeout = 15_000) {
	await expect(terminalTablist().getByRole("tab").nth(index)).toBeVisible({
		timeout,
	});
	await page.locator(".xterm-helper-textarea").first().waitFor({
		state: "attached",
		timeout,
	});
}

/**
 * Type a command into whichever element currently has keyboard focus and
 * press Enter. Does NOT explicitly focus the xterm textarea — the test relies
 * on the app's auto-focus behavior to route keystrokes to the right terminal.
 */
async function typeIntoFocusedElement(text: string) {
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

/**
 * Locator for the accessibility tree of the currently visible terminal pane.
 * Panes that are hidden use aria-hidden="true"; the active pane uses "false".
 * In split mode both panes are visible — this returns the first visible one.
 */
function visibleTerminalTree() {
	return page
		.locator(
			'[aria-hidden="false"].shell-terminal-pane .xterm-accessibility-tree',
		)
		.first();
}

test.describe.serial("Terminal tab auto-focus", () => {
	test.describe.configure({ timeout: 120_000 });

	test("focuses the terminal immediately after clicking its tab — single mode", async () => {
		// ── Setup ──────────────────────────────────────────────────────────────
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		await waitForShellTab(0);

		// Confirm shell 1 is interactive (explicit focus just for baseline).
		const textarea = page.locator(".xterm-helper-textarea").first();
		await textarea.focus();
		const baseline = `BASELINE_${Date.now()}`;
		await page.keyboard.type(`echo ${baseline}`);
		await page.keyboard.press("Enter");
		await expect(visibleTerminalTree()).toContainText(baseline, {
			timeout: 10_000,
		});

		// ── Add shell 2 ────────────────────────────────────────────────────────
		await page.getByRole("button", { name: "Add shell" }).click();
		await waitForShellTab(1);

		// Shell 2 becomes active after creation — confirm it is visible/active.
		await expect(terminalTablist().getByRole("tab").nth(1)).toHaveAttribute(
			"data-state",
			"active",
		);

		// ── Click shell 1 tab (no explicit textarea focus) ─────────────────────
		await terminalTablist().getByRole("tab").nth(0).click();
		await expect(terminalTablist().getByRole("tab").nth(0)).toHaveAttribute(
			"data-state",
			"active",
		);

		// Type WITHOUT explicitly focusing the textarea.
		// If auto-focus works, this text goes to shell 1's PTY.
		const marker1 = `AUTOFOCUS_TAB_${Date.now()}`;
		await typeIntoFocusedElement(`echo ${marker1}`);

		await expect(visibleTerminalTree()).toContainText(marker1, {
			timeout: 10_000,
		});

		// ── Click shell 2 tab (no explicit focus) ──────────────────────────────
		await terminalTablist().getByRole("tab").nth(1).click();
		await expect(terminalTablist().getByRole("tab").nth(1)).toHaveAttribute(
			"data-state",
			"active",
		);

		const marker2 = `AUTOFOCUS_TAB2_${Date.now()}`;
		await typeIntoFocusedElement(`echo ${marker2}`);

		// Shell 2's pane is now visible — the marker should appear in its tree.
		await expect(visibleTerminalTree()).toContainText(marker2, {
			timeout: 10_000,
		});
	});

	test("re-clicking the already-active tab restores focus to the terminal", async () => {
		// Shell 2 should still be active from the previous test.
		await expect(terminalTablist().getByRole("tab").nth(1)).toHaveAttribute(
			"data-state",
			"active",
		);

		// Click somewhere outside the terminal to move focus away from it.
		// Clicking the "Add shell" button moves keyboard focus to that button.
		await page.getByRole("button", { name: "Add shell" }).focus();

		// Re-click the already-active tab. focused prop does not change, so only
		// focusSignal can trigger the re-focus.
		await terminalTablist().getByRole("tab").nth(1).click();

		const marker = `REFOCUS_SAME_TAB_${Date.now()}`;
		await typeIntoFocusedElement(`echo ${marker}`);

		await expect(visibleTerminalTree()).toContainText(marker, {
			timeout: 10_000,
		});
	});

	test("focuses the correct terminal after split-mode tab switch exits to single", async () => {
		// Add shell 3 so we have enough terminals for a split.
		await page.getByRole("button", { name: "Add shell" }).click();
		await waitForShellTab(2);

		// Enable split mode via the toggle button.
		await page.getByRole("button", { name: /enable split shells/i }).click();

		// Assign shells 2 and 3 to the split slots via context menu.
		await terminalTablist().getByRole("tab").nth(1).click({ button: "right" });
		await page.getByRole("menuitem", { name: /show in split left/i }).click();

		await terminalTablist().getByRole("tab").nth(2).click({ button: "right" });
		await page.getByRole("menuitem", { name: /show in split right/i }).click();

		// Now click shell 1's tab — it is NOT in either split slot, so the app
		// should exit split mode and show shell 1 alone.
		await terminalTablist().getByRole("tab").nth(0).click();
		await expect(
			page.getByRole("button", { name: /enable split shells/i }),
		).toBeVisible({ timeout: 5_000 });

		const marker = `SPLIT_EXIT_FOCUS_${Date.now()}`;
		await typeIntoFocusedElement(`echo ${marker}`);

		await expect(visibleTerminalTree()).toContainText(marker, {
			timeout: 10_000,
		});
	});
});
