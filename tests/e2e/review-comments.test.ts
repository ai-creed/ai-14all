/**
 * E2E tests for Review Comments — inline review UX.
 *
 * These tests exercise the new inline thread UX:
 *   - .shell-inline-thread (view-zone nodes in Monaco DOM, accessible via Playwright)
 *   - [data-testid="review-queue-panel"] queue sidebar
 *   - Keyboard shortcut Meta+Shift+A to open draft at caret (installCommentKeyBindings)
 *
 * Preload guard: window.ai14all is injected via contextBridge (contextIsolation:true,
 * sandbox:true). We waitForFunction after firstWindow() to ensure the bridge has
 * surfaced before any test interaction.
 */

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
import { ensureReviewOverlayOpen } from "./helpers/review-overlay";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;

async function launchRaw(firstWindowTimeout = 60_000) {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow({ timeout: firstWindowTimeout });
	// Ensure contextBridge has surfaced window.ai14all before any test interaction.
	// Under Playwright 1.59 + Electron 41 the preload runs but the bridge may not
	// be visible in the renderer main context immediately after firstWindow().
	await page.waitForFunction(() => "ai14all" in window, null, {
		timeout: 30_000,
	});
	page.setDefaultTimeout(60_000);
}

async function relaunch() {
	await launchRaw();
	await page
		.getByRole("button", { name: "Restore previous workspace" })
		.click();
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	await expect(
		worktreeNav.getByRole("button", { name: /feature-a/i }),
	).toBeVisible({ timeout: 15_000 });
}

/**
 * Open the diff viewer for src/index.ts in the Changes tab, focus the modified
 * editor, and return. Callers can then trigger comment shortcuts or hover glyphs.
 */
async function openIndexTsDiff() {
	await ensureReviewOverlayOpen(page);
	// Wait for the portal entry animation to finish so the Changes tab is inside
	// the viewport before clicking.
	await expect(page.getByTestId("review-expanded-portal")).toBeVisible();
	await expect(page.getByTestId("review-expanded-portal")).not.toHaveAttribute(
		"data-leaving",
		"true",
	);
	await page.getByRole("tab", { name: "Changes" }).click({ force: true });

	const changedFileButton = page.getByRole("button", {
		name: /src\/index\.ts/i,
	});
	await expect(changedFileButton).toBeVisible({ timeout: 15_000 });
	await changedFileButton.click({ force: true });

	// Wait for the diff editor to render
	await page.waitForSelector(".modified-in-monaco-diff-editor", {
		timeout: 15_000,
	});

	// Click into the modified editor to give it focus
	const modifiedPane = page.locator(".modified-in-monaco-diff-editor");
	const viewLines = modifiedPane.locator(".view-line");
	await expect(viewLines.first()).toBeVisible({ timeout: 10_000 });
	const firstLine = viewLines.first();
	const box = await firstLine.boundingBox();
	if (!box)
		throw new Error("Modified editor first view-line has no bounding box");
	await page.mouse.click(box.x + 60, box.y + box.height / 2);
	await page.waitForTimeout(200);
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-review-comments-")),
	);
	persistedStatePath = join(persistedStateDir, "workspace-state.json");

	await launchRaw();
	await page.getByRole("button", { name: "Browse" }).click();
	await page.getByRole("button", { name: "Load" }).click();
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	await expect(
		worktreeNav.getByRole("button", { name: /feature-a/i }),
	).toBeVisible({ timeout: 15_000 });
	// Navigate to feature-a (has dirty src/index.ts)
	await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Review comments — inline UX", () => {
	test("hover-plus add single line, save, appears in queue panel", async () => {
		test.setTimeout(120_000);

		await openIndexTsDiff();

		// Try hover-glyph first. The glyph class is shell-review-plus-decoration.
		// In headless Electron hover events may not fire reliably; fall back to
		// the keyboard shortcut Meta+Shift+A (installCommentKeyBindings).
		const modifiedPane = page.locator(".modified-in-monaco-diff-editor");
		const viewLines = modifiedPane.locator(".view-line");
		const firstLine = viewLines.first();
		const box = await firstLine.boundingBox();
		if (!box) throw new Error("No bounding box for first view-line");

		// Hover over the glyph margin of the first line to trigger the plus glyph
		await page.mouse.move(box.x - 10, box.y + box.height / 2);
		await page.waitForTimeout(300);

		const glyph = page.locator(".shell-review-plus-decoration").first();
		const glyphVisible = await glyph.isVisible().catch(() => false);

		if (glyphVisible) {
			await glyph.click();
		} else {
			// Fallback: keyboard shortcut to add comment at caret
			await page.keyboard.press("Meta+Shift+A");
		}

		// Draft thread should appear (data-draft="true")
		await page.waitForFunction(
			() =>
				document.querySelector('.shell-inline-thread[data-draft="true"]') !==
				null,
			null,
			{ timeout: 10_000 },
		);

		// Type comment text in the draft textarea
		const textarea = page.locator(".shell-inline-thread__textarea");
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill("rename x");

		// Save the comment via evaluate() — Monaco's view-lines overlay sits on top
		// of the view-zone DOM and intercepts pointer events, making regular .click()
		// and even force:true unreliable. Dispatching a click event directly on the
		// DOM node bypasses the overlay entirely.
		await page.evaluate(() => {
			const draft = document.querySelector(
				'.shell-inline-thread[data-draft="true"]',
			);
			if (!draft) throw new Error("draft thread not found");
			const btns = draft.querySelectorAll("button");
			for (const btn of btns) {
				if (btn.textContent?.trim() === "Save") {
					btn.click();
					return;
				}
			}
			throw new Error("Save button not found in draft thread");
		});

		// Saved thread visible with body text
		await page.waitForFunction(
			() => {
				const threads = document.querySelectorAll(".shell-inline-thread");
				for (const t of threads) {
					const body = t.querySelector(".shell-inline-thread__body");
					if (body?.textContent?.includes("rename x")) return true;
				}
				return false;
			},
			null,
			{ timeout: 10_000 },
		);

		// Queue panel has a row containing "rename x". The panel may scroll internally
		// so we assert on the panel's text content rather than the row element's
		// visibility (which can be "hidden" when scrolled out of view in the overlay).
		const queuePanel = page.locator('[data-testid="review-queue-panel"]');
		await expect(queuePanel).toBeVisible({ timeout: 10_000 });
		await expect(queuePanel).toContainText("rename x", { timeout: 10_000 });
	});

	test("mark addressed → queue shows 0 open → reopen → queue shows 1 open", async () => {
		test.setTimeout(120_000);

		// The previous test left a saved open comment. Find the inline thread.
		const thread = page
			.locator('.shell-inline-thread[data-state="open"]')
			.first();
		await expect(thread).toBeVisible({ timeout: 10_000 });

		// Address button is inside a Monaco view-zone — dispatch via evaluate to
		// bypass the view-lines pointer-event overlay.
		await page.evaluate(() => {
			const open = document.querySelector(
				'.shell-inline-thread[data-state="open"]',
			);
			if (!open) throw new Error("open thread not found");
			const btn = open.querySelector(
				'button[aria-label="Address comment"]',
			) as HTMLButtonElement | null;
			if (!btn) throw new Error("Address button not found");
			btn.click();
		});

		// Queue should now show "0 open" — comment is addressed
		const queuePanel = page.locator('[data-testid="review-queue-panel"]');
		await expect(queuePanel).toContainText("0 open", { timeout: 5_000 });

		// The thread stays visible but the queue row should reflect addressed state.
		// To test reopen: click the Reopen button (component stays in expanded view).
		// After addressing, the component flips aria-label from "Address comment" to "Reopen comment".
		await page.evaluate(() => {
			const threads = document.querySelectorAll(".shell-inline-thread");
			for (const t of threads) {
				const btn = t.querySelector(
					'button[aria-label="Reopen comment"]',
				) as HTMLButtonElement | null;
				if (btn) {
					btn.click();
					return;
				}
			}
			throw new Error("Reopen button not found");
		});

		// Queue should now show "1 open" again
		await expect(queuePanel).toContainText("1 open", { timeout: 5_000 });
	});

	test("persist across reload", async () => {
		test.setTimeout(180_000);

		// Close and relaunch with the same persisted state
		await closeApp(app);
		await relaunch();

		// Re-open the diff for src/index.ts
		await openIndexTsDiff();

		// Comment should still be in the queue panel
		const queuePanel = page.locator('[data-testid="review-queue-panel"]');
		await expect(queuePanel).toBeVisible({ timeout: 10_000 });
		await expect(queuePanel).toContainText("rename x", { timeout: 15_000 });

		// Inline thread should also be visible in the diff
		await page.waitForFunction(
			() => {
				const threads = document.querySelectorAll(".shell-inline-thread");
				for (const t of threads) {
					const body = t.querySelector(".shell-inline-thread__body");
					if (body?.textContent?.includes("rename x")) return true;
				}
				return false;
			},
			null,
			{ timeout: 15_000 },
		);
	});
});
