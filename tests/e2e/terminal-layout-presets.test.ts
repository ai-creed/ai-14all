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
	// This suite's subject is layout reorganization, not confirmation — that
	// behavior is covered by terminal-slot-chrome.spec.ts (terminal-ux-hardening
	// spec). Disable both confirm prefs so restart/close flows below stay
	// unmodified instead of parking a modal ConfirmDialog.
	await page.evaluate(() =>
		(
			window as never as {
				ai14all: { settings: { write: (p: unknown) => Promise<unknown> } };
			}
		).ai14all.settings.write({
			terminalConfirm: { restart: false, close: false },
		}),
	);
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

	test("closing a shell reorganizes the layout to fit the survivors", async () => {
		test.setTimeout(60_000);
		// Reset to a clean two-column layout with two running shells.
		await page.getByTestId("terminal-layout-button").click();
		await page.getByTestId("layout-tile-2-v").click();
		const cta1 = page.getByTestId("slot-cta-1");
		if (await cta1.isVisible().catch(() => false)) await cta1.click();
		await expect(page.getByTestId("slot-1")).toBeVisible();
		// Close one shell -> a single shell remains -> layout collapses to one pane,
		// no leftover empty slot or CTA.
		await page.getByTestId("slot-close-1").click();
		await expect(page.getByTestId("slot-0")).toBeVisible();
		await expect(page.getByTestId("slot-1")).toHaveCount(0);
		await expect(page.getByTestId("slot-cta-1")).toHaveCount(0);
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

test.describe.serial("Command presets redesign", () => {
	async function openPresetManager(): Promise<void> {
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "Manage presets" }).click();
		await expect(page.getByText("Command presets")).toBeVisible();
	}

	test("preset rows render the redesigned shape with accessible icon actions", async () => {
		test.setTimeout(60_000);
		await openPresetManager();
		// Scope to the kept yolo default's row and assert the icon-only actions by
		// ACCESSIBLE NAME (aria-label / tooltip label), not visible text or testid —
		// so a regression that drops or mislabels an icon button fails this test.
		const row = page.locator(".preset-row", {
			hasText: "start claude (yolo)",
		});
		await expect(row).toBeVisible();
		await expect(
			row.getByRole("button", { name: "Edit preset" }),
		).toBeVisible();
		await expect(
			row.getByRole("button", { name: "Delete preset" }),
		).toBeVisible();
		// The kept yolo defaults target a pinned terminal, so the Launch action's
		// accessible name reflects that.
		await expect(
			row.getByRole("button", { name: "Launch in pinned terminal" }),
		).toBeVisible();
		// The command renders in a codeblock.
		await expect(row.locator("code")).toHaveText(
			"claude --dangerously-skip-permissions",
		);
		// Retired plain default is gone from a fresh workspace.
		await expect(
			page.getByTestId("preset-launch-preset-start-claude"),
		).toHaveCount(0);
		// Close the dialog via the X button and wait for full dismissal before the
		// next test. (Escape is unreliable when no in-dialog click has taken focus.)
		await page.getByRole("button", { name: "Close" }).click();
		await expect(page.getByText("Command presets")).toBeHidden();
	});

	test("throwaway preset opens a floating shell; pinned preset fills a grid slot", async () => {
		test.setTimeout(120_000);
		// Free one grid slot (the layout suite above leaves all six occupied).
		// Closing a shell now reorganizes the layout to fit survivors, so we
		// close slot-5 (shrinks to 5 shells) then re-expand to a 6-slot layout
		// to get an empty slot-cta-5 for the pinned preset to fill.
		await page.getByTestId("slot-close-5").click();
		await expect(page.getByTestId("slot-4")).toBeVisible();
		await page.getByTestId("terminal-layout-button").click();
		await page.getByTestId("layout-tile-6-v").click();
		await expect(page.getByTestId("slot-cta-5")).toBeVisible();

		// Create one preset of each target via the manager form's toggle.
		await openPresetManager();
		await page.getByLabel("Preset label").fill("tw echo");
		await page.getByLabel("Preset command").fill("echo tw");
		await page.getByTestId("preset-target-throwaway").click();
		await expect(page.getByTestId("preset-target-throwaway")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.getByRole("button", { name: "Save preset" }).click();
		// The form resets to the default ("pinned") target after a save.
		await expect(page.getByTestId("preset-target-pinned")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.getByLabel("Preset label").fill("pin echo");
		await page.getByLabel("Preset command").fill("echo pin");
		await page.getByRole("button", { name: "Save preset" }).click();
		await page.keyboard.press("Escape");
		await expect(page.getByText("Command presets")).toBeHidden();

		// Throwaway launch (via the Presets dropdown) -> floating-shell popover;
		// the grid is untouched, so the freed slot 5 stays an empty CTA.
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "tw echo" }).click();
		await expect(page.getByTestId("floating-shell-popover")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("slot-cta-5")).toBeVisible();
		await page.getByTestId("floating-shell-close").click();
		await expect(page.getByTestId("floating-shell-popover")).toHaveCount(0, {
			timeout: 10_000,
		});

		// Pinned launch -> fills the freed grid slot, with no floating shell.
		await page.getByRole("button", { name: "Presets" }).click();
		await page.getByRole("menuitem", { name: "pin echo" }).click();
		await expect(page.getByTestId("slot-5")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId("slot-cta-5")).toHaveCount(0);
		await expect(page.getByTestId("floating-shell-popover")).toHaveCount(0);
	});
});
