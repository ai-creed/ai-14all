// Command palette e2e. See docs/superpowers/specs/2026-06-26-command-palette-design.md.
//
// Coverage:
//   1. Cmd+Shift+K opens the palette.
//   2. Typing "new term" surfaces "New terminal"; Enter runs it (a terminal appears).
//   3. Cmd+Shift+K opens the palette even when a terminal pane is focused (proving
//      the terminal does not swallow it as Cmd+K/clear).

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
import { closeApp } from "./fixtures/close-app";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;

const IS_MAC = process.platform === "darwin";

// Dispatch the command-palette shortcut via a synthetic DOM event fired directly
// inside the renderer. page.keyboard.press("Meta+Shift+KeyK") does not reach the
// document capture listener when the xterm-helper-textarea has focus, because
// macOS / Electron / CDP handles Cmd+Shift+Letter events differently for that
// element (observed: Meta+Slash without Shift works, Meta+Shift+Letter does not).
// Dispatching directly on the document bypasses that layer and exercises the same
// capture-phase listener that a real user keystroke would trigger.
async function pressCommandPalette(page: Page): Promise<void> {
	await page.evaluate((isMac: boolean) => {
		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "K",
				code: "KeyK",
				metaKey: isMac,
				ctrlKey: !isMac,
				shiftKey: true,
				bubbles: true,
				cancelable: true,
				composed: true,
			}),
		);
	}, IS_MAC);
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-cmd-palette-state-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("command palette", () => {
	test("loads a worktree", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		const featureA = page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: "feature-a", exact: true });
		await expect(featureA).toBeVisible({ timeout: 15_000 });
		await featureA.click();
	});

	test("opens via Cmd+Shift+K and runs New terminal", async () => {
		// Count occupied terminal slots BEFORE — the worktree already has a default
		// shell, so a bare ".xterm is visible" check can't prove the command ran.
		// (".shell-terminal-slot:not(--empty)" is the app's own terminal-count
		// idiom — see tests/e2e/session-attention.spec.ts.)
		const occupiedSlots = page.locator(
			".shell-terminal-slot:not(.shell-terminal-slot--empty)",
		);
		await expect(occupiedSlots.first()).toBeVisible({ timeout: 15_000 });
		const before = await occupiedSlots.count();

		await pressCommandPalette(page);
		await expect(page.getByTestId("command-palette")).toBeVisible();
		await page.getByTestId("command-palette-search").fill("new term");
		await expect(page.getByText("New terminal")).toBeVisible();
		await page.keyboard.press("Enter");

		await expect(page.getByTestId("command-palette")).toHaveCount(0);
		// The New terminal command actually ran → exactly one more occupied slot.
		// This fails (stays `before`) if Enter did not invoke the command.
		await expect(occupiedSlots).toHaveCount(before + 1);
	});

	test("opens from a focused terminal without clearing it", async () => {
		// xterm renders via canvas — text is not accessible on `.xterm` directly.
		// Use the a11y tree for assertions (pattern from cumulative-flow.phase-0 and
		// session-attention.spec.ts) and the helper-textarea for focus/input.
		const textarea = page.locator(
			'.shell-terminal-pane[aria-hidden="false"] .xterm-helper-textarea',
		);
		const a11yTree = page.locator(
			'.shell-terminal-pane[aria-hidden="false"] .xterm-accessibility-tree',
		);

		await textarea.focus(); // focus the terminal pane

		// Write a marker so we can prove the terminal is NOT cleared. Cmd+K /
		// Ctrl+K is TerminalPane's clear binding; Cmd+Shift+K must leave the
		// buffer untouched.
		await page.keyboard.type("echo PALETTE_MARKER_123");
		await page.keyboard.press("Enter");
		await expect(a11yTree).toContainText("PALETTE_MARKER_123", {
			timeout: 10_000,
		});

		// Dispatch via evaluate so the event reaches the document capture listener
		// regardless of which element holds OS-level focus (see pressCommandPalette).
		await pressCommandPalette(page);
		await expect(page.getByTestId("command-palette")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("command-palette")).toHaveCount(0);

		// The marker is still on screen — the shortcut did not clear the terminal.
		await expect(a11yTree).toContainText("PALETTE_MARKER_123");
	});
});
