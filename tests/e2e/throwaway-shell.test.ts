import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
	type Locator,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

// E2E coverage for the floating ("throwaway") shell feature: ⌘⇧T spawns a
// per-worktree floating shell rendered as a header pill + a drop-down popover;
// minimize/pin/kill; pin promotes into the grid reusing the PTY; natural exit
// lingers; per-worktree hide/restore; and the 6-shell cap creates no orphan PTY.
//
// Mirrors terminal-layout-presets.test.ts for the harness shape (Electron launch,
// test repo + feature-a worktree, the auto-created default shell in slot 0, and
// ZDOTDIR neutralization at the run command so zsh rc noise does not flake the
// terminal-output assertions).

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

const MAC = process.platform === "darwin";
// The renderer's shortcut predicate keys off metaKey on mac, ctrlKey elsewhere,
// and requires Shift. Mirror the platform-aware combo used by other e2e specs.
const NEW_FLOATING = MAC ? "Meta+Shift+T" : "Control+Shift+T";

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

const worktreeNav = () =>
	page.getByRole("navigation", { name: "Worktree sessions" });
const featureBtn = () =>
	worktreeNav().getByRole("button", { name: /feature-a/i });
const mainBtn = () => worktreeNav().getByRole("button", { name: / main$/i });

const pills = () => page.getByTestId("floating-shell-pills");
const popover = () => page.getByTestId("floating-shell-popover");
// All floating-shell pills (the body wrapper carries data-testid floating-shell-pill-<id>;
// exclude the per-pill close button, whose testid starts floating-shell-pill-close-).
const allPills = () =>
	page.locator(
		'[data-testid^="floating-shell-pill-"]:not([data-testid^="floating-shell-pill-close-"])',
	);

// The popover renders a TerminalPane (xterm) for the expanded shell. Scope all
// terminal reads/writes to the popover so we never touch a grid slot's xterm.
const popoverTextarea = () => popover().locator(".xterm-helper-textarea");
const popoverAccessibilityTree = () =>
	popover().locator(".xterm-accessibility-tree");

/** Spawn a floating shell via the shortcut and wait for popover + a new pill. */
async function spawnFloatingShell(): Promise<void> {
	const before = await allPills().count();
	await page.keyboard.press(NEW_FLOATING);
	await expect(popover()).toBeVisible({ timeout: 10_000 });
	await expect(allPills()).toHaveCount(before + 1, { timeout: 10_000 });
}

/** Type a line into the currently-expanded floating shell and press Enter. */
async function typeInPopover(line: string): Promise<void> {
	const ta = popoverTextarea();
	await ta.waitFor({ state: "attached", timeout: 10_000 });
	await ta.focus();
	await page.keyboard.type(line);
	await page.keyboard.press("Enter");
}

/** Resolve the live workspace id (for the backend-session probe). */
async function getWorkspaceId(): Promise<string> {
	return page.evaluate(async (repoPath: string) => {
		const ai = (window as unknown as { ai14all: typeof window.ai14all })
			.ai14all;
		const ws = await ai.workspace.openRepository(repoPath);
		return ws.id;
	}, testRepo.repoPath);
}

/** Count live backend PTY sessions for the workspace. */
async function liveBackendSessionCount(workspaceId: string): Promise<number> {
	return page.evaluate(async (wsId: string) => {
		const ai = (window as unknown as { ai14all: typeof window.ai14all })
			.ai14all;
		const sessions = await ai.terminals.list(wsId);
		return sessions.length;
	}, workspaceId);
}

/**
 * Reset to a single floating shell expanded over a clean grid between tests.
 * Kills every floating shell (popover close + each pill's ✕) so the per-test
 * cap math and pill counts start from zero.
 */
async function clearAllFloatingShells(): Promise<void> {
	// Dismiss an open popover first so its pill is removed too.
	if (
		await popover()
			.isVisible()
			.catch(() => false)
	) {
		await page.getByTestId("floating-shell-close").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
	}
	// Then kill any remaining minimized pills.
	for (let i = 0; i < 8; i++) {
		const closeBtn = page
			.locator('[data-testid^="floating-shell-pill-close-"]')
			.first();
		if ((await closeBtn.count()) === 0) break;
		await closeBtn.click();
		await page.waitForTimeout(150);
	}
	await expect(allPills()).toHaveCount(0, { timeout: 10_000 });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-throwaway-shell-")),
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

test.describe.serial("Throwaway shell", () => {
	// Each test leaves the feature-a session with no floating shells so the next
	// test's cap math and pill counts start from a known-empty state.
	test.afterEach(async () => {
		await clearAllFloatingShells().catch(() => {});
	});

	test("Cmd+Shift+T spawns a floating shell without touching the grid", async () => {
		test.setTimeout(60_000);
		// Baseline: layout "1" — only slot 0 occupied, no slot 1.
		await expect(page.getByTestId("slot-0")).toBeVisible();
		await expect(page.getByTestId("slot-1")).toHaveCount(0);

		await page.keyboard.press(NEW_FLOATING);

		await expect(popover()).toBeVisible({ timeout: 10_000 });
		await expect(pills()).toBeVisible();
		await expect(allPills()).toHaveCount(1);
		// Grid untouched: still a single occupied slot, no second slot created.
		await expect(page.getByTestId("slot-0")).toBeVisible();
		await expect(page.getByTestId("slot-1")).toHaveCount(0);
	});

	test("minimize then re-expand preserves scrollback", async () => {
		test.setTimeout(60_000);
		await spawnFloatingShell();
		await typeInPopover("echo HELLO_FLOAT");
		await expect(popoverAccessibilityTree()).toContainText("HELLO_FLOAT", {
			timeout: 10_000,
		});

		// Minimize: popover gone, pill remains.
		await page.getByTestId("floating-shell-minimize").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(1);

		// Re-expand by clicking the pill body; scrollback restored via replay.
		await allPills().first().getByRole("button").first().click();
		await expect(popover()).toBeVisible({ timeout: 10_000 });
		await expect(popoverAccessibilityTree()).toContainText("HELLO_FLOAT", {
			timeout: 10_000,
		});
	});

	test("worktree switch hides then restores the floating shell", async () => {
		test.setTimeout(90_000);
		await spawnFloatingShell();
		await typeInPopover("echo SWITCH_FLOAT");
		await expect(popoverAccessibilityTree()).toContainText("SWITCH_FLOAT", {
			timeout: 10_000,
		});

		// Switch to the sibling "main" worktree session (auto-creates its shell).
		await mainBtn().click();
		await expect(mainBtn()).toHaveAttribute("data-selected", "true", {
			timeout: 10_000,
		});
		// No floating shell belongs to the main session.
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });

		// Switch back to feature-a: the pill returns; expand it; marker survives.
		await featureBtn().click();
		await expect(featureBtn()).toHaveAttribute("data-selected", "true", {
			timeout: 10_000,
		});
		await expect(allPills()).toHaveCount(1, { timeout: 10_000 });
		await allPills().first().getByRole("button").first().click();
		await expect(popover()).toBeVisible({ timeout: 10_000 });
		await expect(popoverAccessibilityTree()).toContainText("SWITCH_FLOAT", {
			timeout: 10_000,
		});
	});

	test("natural exit lingers with final output; survives minimize", async () => {
		test.setTimeout(90_000);
		await spawnFloatingShell();
		const pill: Locator = allPills().first();
		await typeInPopover("echo BYE_FLOAT; exit");

		// The shell exits; popover lingers showing the final output, and the pill
		// reflects the exited (not running) state.
		await expect(popoverAccessibilityTree()).toContainText("BYE_FLOAT", {
			timeout: 15_000,
		});
		await expect(pill).toHaveAttribute("data-status", /exited|error/, {
			timeout: 15_000,
		});

		// Minimize then re-expand: the retained replay buffer repopulates the pane.
		await page.getByTestId("floating-shell-minimize").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await allPills().first().getByRole("button").first().click();
		await expect(popover()).toBeVisible({ timeout: 10_000 });
		await expect(popoverAccessibilityTree()).toContainText("BYE_FLOAT", {
			timeout: 10_000,
		});

		// Dismiss the exited shell: pill and popover gone.
		await page.getByTestId("floating-shell-close").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });
	});

	test("exited floating shell survives a worktree switch; dismissal works", async () => {
		test.setTimeout(120_000);
		await spawnFloatingShell();
		const pill: Locator = allPills().first();
		await typeInPopover("echo NAV_FLOAT; exit");

		// Wait for the exited state: popover lingers with NAV_FLOAT, pill exited.
		await expect(popoverAccessibilityTree()).toContainText("NAV_FLOAT", {
			timeout: 15_000,
		});
		await expect(pill).toHaveAttribute("data-status", /exited|error/, {
			timeout: 15_000,
		});

		// Switch to main: no floating shell there.
		await mainBtn().click();
		await expect(mainBtn()).toHaveAttribute("data-selected", "true", {
			timeout: 10_000,
		});
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });

		// Back to feature-a: the still-exited pill is restored; expand it; the
		// retained replay survives exit + navigation (not cleared on exit).
		await featureBtn().click();
		await expect(featureBtn()).toHaveAttribute("data-selected", "true", {
			timeout: 10_000,
		});
		await expect(allPills()).toHaveCount(1, { timeout: 10_000 });
		const restoredPill = allPills().first();
		await expect(restoredPill).toHaveAttribute("data-status", /exited|error/, {
			timeout: 10_000,
		});
		await restoredPill.getByRole("button").first().click();
		await expect(popover()).toBeVisible({ timeout: 10_000 });
		await expect(popoverAccessibilityTree()).toContainText("NAV_FLOAT", {
			timeout: 10_000,
		});

		// Dismiss: pill and popover gone, and the pill cannot be re-expanded.
		await page.getByTestId("floating-shell-close").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });
		// NOTE: the buffer-free guarantee (clearReplayOutput) is asserted at unit
		// level in Task 7's handleCloseFloatingShell tests; the e2e cannot observe
		// the in-memory replay map, so this UI check alone is not a full guard.
	});

	test("pin moves the shell into the grid, reusing the PTY", async () => {
		test.setTimeout(90_000);
		// Start from the baseline single-slot grid.
		await expect(page.getByTestId("slot-0")).toBeVisible();
		await expect(page.getByTestId("slot-1")).toHaveCount(0);

		await spawnFloatingShell();
		await typeInPopover("echo PIN_ME");
		await expect(popoverAccessibilityTree()).toContainText("PIN_ME", {
			timeout: 10_000,
		});

		await page.getByTestId("floating-shell-pin").click();

		// Popover gone, pill gone (promoted out of the floating set).
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });
		// Grid grew to a 2-slot layout.
		await expect(page.getByTestId("slot-1")).toBeVisible({ timeout: 10_000 });
		// The same PTY/buffer landed in a slot — its prior output (PIN_ME) is
		// still there, i.e. the PTY was reused, not respawned fresh. The promoted
		// shell now lives in slot 1 (slot 0 holds the original default shell).
		await expect(
			page.getByTestId("slot-1").locator(".xterm-accessibility-tree"),
		).toContainText("PIN_ME", { timeout: 10_000 });

		// Reset: close the promoted slot to return to the single-slot baseline so
		// later tests start clean.
		await page.getByTestId("slot-close-1").click();
		await expect(page.getByTestId("slot-1")).toHaveCount(0, {
			timeout: 10_000,
		});
	});

	test("pin is disabled when the grid is full (6 slots)", async () => {
		test.setTimeout(180_000);
		const add = page.getByTestId("terminal-add-shell");
		// Fill the grid to 6 slots.
		for (let i = 0; i < 8; i++) {
			if (await add.isDisabled()) break;
			await add.click();
			await page.waitForTimeout(250);
		}
		await expect(page.getByTestId("slot-5")).toBeVisible({ timeout: 15_000 });
		await expect(add).toBeDisabled();

		// Spawn a floating shell; its pin must be disabled (no room to promote).
		await spawnFloatingShell();
		await expect(page.getByTestId("floating-shell-pin")).toBeDisabled({
			timeout: 10_000,
		});

		// Reset: kill the floating shell, then drain the grid back to one slot.
		await page.getByTestId("floating-shell-close").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		for (let i = 5; i >= 1; i--) {
			const closeSlot = page.getByTestId(`slot-close-${i}`);
			if ((await closeSlot.count()) === 0) continue;
			await closeSlot.click();
			await page.waitForTimeout(200);
		}
	});

	test("spawn is a no-op at the 6-floating cap and creates no backend session", async () => {
		test.setTimeout(180_000);
		// Spawn six floating shells, asserting a pill appears each time.
		for (let i = 1; i <= 6; i++) {
			await page.keyboard.press(NEW_FLOATING);
			await expect(allPills()).toHaveCount(i, { timeout: 10_000 });
		}
		await expect(allPills()).toHaveCount(6);

		// Capture the live backend session count at the cap.
		const workspaceId = await getWorkspaceId();
		const atCap = await liveBackendSessionCount(workspaceId);

		// A 7th press is a no-op: still six pills AND no new backend PTY (the
		// pre-spawn cap gate must not orphan a session).
		await page.keyboard.press(NEW_FLOATING);
		await page.waitForTimeout(1_000);
		await expect(allPills()).toHaveCount(6);
		const afterSeventh = await liveBackendSessionCount(workspaceId);
		expect(afterSeventh).toBe(atCap);
	});

	test("Cmd+Shift+T fires while a terminal pane is focused", async () => {
		test.setTimeout(60_000);
		// Focus the default slot's xterm textarea (a focused terminal pane).
		const slot0Textarea = page
			.getByTestId("slot-0")
			.locator(".xterm-helper-textarea");
		await slot0Textarea.waitFor({ state: "attached", timeout: 10_000 });
		await slot0Textarea.focus();

		// The shortcut must still fire from inside a focused terminal.
		await page.keyboard.press(NEW_FLOATING);
		await expect(popover()).toBeVisible({ timeout: 10_000 });
		await expect(allPills()).toHaveCount(1);
	});
});
