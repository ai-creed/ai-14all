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

async function ensureWorkspaceLoaded() {
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	if (await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false))
		return;
	const repoInput = page.locator("#repo-path");
	await expect(repoInput).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(repoInput).toHaveValue(testRepo.repoPath);
	await repoInput.press("Enter");
	await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase10-")));
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

test.describe.serial("Cumulative flow — Phase 10", () => {
	// Detect the OS inside the running Electron window to use the correct modifier.
	let modKey: string;
	test.beforeAll(async () => {
		await ensureWorkspaceLoaded();
		const isMac: boolean = await page.evaluate(() =>
			navigator.platform.toUpperCase().includes("MAC"),
		);
		modKey = isMac ? "Meta" : "Control";
		// Select the main worktree session so the chip bar is rendered.
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: / main$/i })
			.click();
		await expect(page.getByRole("region", { name: "Session" })).toBeVisible({
			timeout: 10_000,
		});
	});

	test("shortcuts help opens via keyboard shortcut and lists all actions", async () => {
		test.setTimeout(30_000);
		// Focus a non-terminal area so the shortcut fires. Click a fixed inert
		// corner of the region rather than its geometric center — the center
		// shifts as chip-bar buttons are added (the Plugins button landed there
		// and its dialog swallowed the shortcut).
		await page
			.getByRole("region", { name: "Session" })
			.click({ position: { x: 8, y: 8 } });
		await page.keyboard.press(`${modKey}+Slash`);
		await expect(
			page.getByRole("dialog", { name: /keyboard shortcuts/i }),
		).toBeVisible({ timeout: 5_000 });
		// Verify at least the files-overlay and review.open entries are shown.
		await expect(
			page.getByTestId("shortcuts-help-row-files-overlay"),
		).toBeVisible();
		await expect(
			page.getByTestId("shortcuts-help-row-review.open"),
		).toBeVisible();
		await expect(
			page.getByTestId("shortcuts-help-row-rename-session"),
		).toBeVisible();
		// Escape closes it.
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", { name: /keyboard shortcuts/i }),
		).not.toBeVisible({ timeout: 5_000 });
	});

	test("review overlay toggles open and closed via keyboard shortcut", async () => {
		test.setTimeout(30_000);
		await ensureWorkspaceLoaded();
		const portal = page.getByTestId("review-expanded-portal");
		// Focus non-terminal area.
		await page
			.getByRole("region", { name: "Session" })
			.click({ position: { x: 8, y: 8 } });
		// Ensure overlay starts closed by toggling if currently open.
		if (await portal.isVisible({ timeout: 500 }).catch(() => false)) {
			await page.keyboard.press(`${modKey}+j`);
			await expect(portal).not.toBeVisible({ timeout: 5_000 });
		}
		// Toggle open.
		await page.keyboard.press(`${modKey}+j`);
		await expect(portal).toBeVisible({ timeout: 5_000 });
		// Toggle closed.
		await page.keyboard.press(`${modKey}+j`);
		await expect(portal).not.toBeVisible({ timeout: 5_000 });
	});

	test("rename shortcut expands sidebar and focuses the rename input", async () => {
		test.setTimeout(30_000);
		await ensureWorkspaceLoaded();
		// Focus non-terminal area.
		await page
			.getByRole("region", { name: "Session" })
			.click({ position: { x: 8, y: 8 } });
		await page.keyboard.press(
			modKey === "Meta" ? "Meta+Shift+r" : "Control+Alt+r",
		);
		// Rename input should appear in the sidebar.
		await expect(
			page.getByRole("textbox", { name: /rename session/i }),
		).toBeVisible({ timeout: 5_000 });
		// Cancel the rename.
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("textbox", { name: /rename session/i }),
		).not.toBeVisible({ timeout: 3_000 });
	});

	test("keyboard shortcuts do not fire when terminal input has focus", async () => {
		test.setTimeout(30_000);
		await ensureWorkspaceLoaded();
		// Close the shortcuts help if it is open.
		const helpDialog = page.getByRole("dialog", {
			name: /keyboard shortcuts/i,
		});
		if (await helpDialog.isVisible({ timeout: 500 }).catch(() => false)) {
			await page.keyboard.press("Escape");
		}
		// Focus the xterm textarea.
		const terminalTextarea = page.locator(
			'.shell-terminal-pane[aria-hidden="false"] .xterm-helper-textarea',
		);
		await terminalTextarea.focus();
		// Pressing the help shortcut key combo in the terminal should NOT open shortcuts help.
		await page.keyboard.press(`${modKey}+Slash`);
		await expect(
			page.getByRole("dialog", { name: /keyboard shortcuts/i }),
		).not.toBeVisible({ timeout: 2_000 });
	});
});
