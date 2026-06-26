import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

async function ensureWorkspaceLoaded(): Promise<void> {
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	if (await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false)) {
		return;
	}
	const repoInput = page.locator("#repo-path");
	await expect(repoInput).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(repoInput).toHaveValue(testRepo.repoPath);
	await repoInput.press("Enter");
	await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
	await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-terminal-layout-")),
	);
	const workspaceStatePath = join(persistedStateDir, "workspace-state.json");
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: workspaceStatePath,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.waitForFunction(() => "ai14all" in window, null, {
		timeout: 30_000,
	});
	await ensureWorkspaceLoaded();
	// The worktree auto-creates one default shell occupying slot 0.
	await expect(page.getByTestId("slot-0")).toBeVisible({ timeout: 20_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test.describe.serial("Terminal layout presets", () => {
	test("selects a layout by keyboard (arrow + Enter), no mouse on tiles", async () => {
		test.setTimeout(60_000);
		const dialog = page.getByTestId("terminal-layout-dialog");
		// Open via the toolbar button (not a tile).
		await page.getByTestId("terminal-layout-button").click();
		await expect(dialog).toBeVisible();
		// On open, the current layout's tile holds focus.
		const currentTile = dialog.locator(
			'[data-testid^="layout-tile-"][data-current="true"]',
		);
		await expect(currentTile).toBeFocused();
		const currentId = await currentTile.getAttribute("data-testid");
		// Arrow keys move focus to a DIFFERENT tile (proving keyboard navigation),
		// with no mouse touching a tile. One shell is running here, so all tiles
		// are enabled and ArrowDown always finds a neighbor below.
		await page.keyboard.press("ArrowDown");
		const landedId = await dialog.locator(":focus").getAttribute("data-testid");
		expect(landedId).toBeTruthy();
		expect(landedId).not.toBe(currentId);
		// Enter selects the focused tile and closes the dialog.
		await page.keyboard.press("Enter");
		await expect(dialog).toBeHidden();
		// Reopen (toolbar button) and confirm the keyboard-selected layout applied.
		await page.getByTestId("terminal-layout-button").click();
		await expect(dialog).toBeVisible();
		await expect(page.getByTestId(landedId!)).toHaveAttribute(
			"data-current",
			"true",
		);
		// Close via Escape (not a tile) to leave the dialog shut for the next test.
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});

	test("opens the layout dialog and applies a 3-column layout", async () => {
		test.setTimeout(60_000);
		await page.getByTestId("terminal-layout-button").click();
		await expect(page.getByTestId("terminal-layout-dialog")).toBeVisible();
		// 1 shell running -> all layouts enabled. Pick 3 equal columns.
		await page.getByTestId("layout-tile-3-v").click();
		await expect(page.getByTestId("slot-cta-1")).toBeVisible();
		await expect(page.getByTestId("slot-cta-2")).toBeVisible();
	});

	test("start-shell CTA fills an empty slot", async () => {
		test.setTimeout(60_000);
		await page.getByTestId("slot-cta-1").click();
		await expect(page.getByTestId("slot-1")).toBeVisible();
		await expect(page.getByTestId("slot-cta-1")).toHaveCount(0);
	});

	test("closing a shell leaves an empty slot (no layout shrink)", async () => {
		test.setTimeout(60_000);
		await page.getByTestId("slot-close-1").click();
		await expect(page.getByTestId("slot-cta-1")).toBeVisible();
		await expect(page.getByTestId("slot-cta-2")).toBeVisible();
		await expect(page.getByTestId("slot-0")).toBeVisible();
	});

	test("adding when all slots are full auto-promotes to the next bucket", async () => {
		test.setTimeout(60_000);
		// Reset to a 2-col layout (1 shell running compacts into slot 0).
		await page.getByTestId("terminal-layout-button").click();
		await page.getByTestId("layout-tile-2-v").click();
		// Fill the remaining empty slot so the 2-slot layout is full.
		await page.getByTestId("slot-cta-1").click();
		await expect(page.getByTestId("slot-1")).toBeVisible();
		await expect(page.getByTestId("slot-cta-1")).toHaveCount(0);
		// Add with no free slot -> promote to a 3-slot layout (new occupied slot 2).
		await page.getByTestId("terminal-add-shell").click();
		await expect(page.getByTestId("slot-2")).toBeVisible();
	});

	test("promote swaps a child shell into the master slot", async () => {
		test.setTimeout(60_000);
		await page.getByTestId("terminal-layout-button").click();
		await page.getByTestId("layout-tile-3-vm").click();
		const cta1 = page.getByTestId("slot-cta-1");
		if (await cta1.isVisible().catch(() => false)) await cta1.click();
		await expect(page.getByTestId("slot-1")).toBeVisible();
		// Identify slots by process id (shell labels are identical OSC titles).
		const masterBefore = await page
			.getByTestId("slot-0")
			.getAttribute("data-process-id");
		const child1Id = await page
			.getByTestId("slot-1")
			.getAttribute("data-process-id");
		expect(child1Id).toBeTruthy();
		expect(child1Id).not.toBe(masterBefore);
		await page.getByTestId("slot-promote-1").click();
		// The child's process is now in the master slot (slot 0).
		await expect(page.getByTestId("slot-0")).toHaveAttribute(
			"data-process-id",
			child1Id!,
		);
	});

	test("the add control is disabled once 6 shells are running", async () => {
		test.setTimeout(120_000);
		const add = page.getByTestId("terminal-add-shell");
		for (let i = 0; i < 8; i++) {
			if (await add.isDisabled()) break;
			await add.click();
			await page.waitForTimeout(200);
		}
		await expect(page.getByTestId("slot-5")).toBeVisible();
		await expect(add).toBeDisabled();
	});
});
