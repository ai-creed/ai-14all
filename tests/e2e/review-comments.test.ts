/**
 * E2E tests for Review Comments — inline review UX.
 *
 * These tests exercise the new inline thread UX:
 *   - .shell-inline-thread (view-zone nodes in Monaco DOM, accessible via Playwright)
 *   - [data-testid^="minimap-dot-"] right-side comment minimap dots
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

/**
 * Add an inline comment to the first view-line of the modified diff editor.
 * Mirrors the hover-glyph / Meta+Shift+A fallback pattern used in the
 * "hover-plus add single line" test; saves via evaluate() to bypass Monaco's
 * pointer-event overlay. Call openIndexTsDiff() before this helper.
 */
async function addInlineComment(commentText: string) {
	const modifiedPane = page.locator(".modified-in-monaco-diff-editor");
	const viewLines = modifiedPane.locator(".view-line");
	const firstLine = viewLines.first();
	const box = await firstLine.boundingBox();
	if (!box) throw new Error("No bounding box for first view-line");

	// Hover over the glyph margin to trigger the plus glyph.
	await page.mouse.move(box.x - 10, box.y + box.height / 2);
	await page.waitForTimeout(300);

	const glyph = page.locator(".shell-review-plus-decoration").first();
	const glyphVisible = await glyph.isVisible().catch(() => false);

	if (glyphVisible) {
		await glyph.click();
	} else {
		await page.keyboard.press("Meta+Shift+A");
	}

	await page.waitForFunction(
		() =>
			document.querySelector('.shell-inline-thread[data-draft="true"]') !==
			null,
		null,
		{ timeout: 10_000 },
	);

	const textarea = page.locator(".shell-inline-thread__textarea");
	await expect(textarea).toBeVisible({ timeout: 5_000 });
	await textarea.fill(commentText);

	// Save via evaluate to bypass Monaco's view-lines pointer-event overlay.
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

	// Wait until the saved comment body is visible in the thread.
	await page.waitForFunction(
		(text) => {
			const threads = document.querySelectorAll(".shell-inline-thread");
			for (const t of threads) {
				const body = t.querySelector(".shell-inline-thread__body");
				if (body?.textContent?.includes(text)) return true;
			}
			return false;
		},
		commentText,
		{ timeout: 10_000 },
	);
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
	test("hover-plus add single line, save, appears as inline thread and minimap dot", async () => {
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

		// The saved comment must also surface a dot in the right-side minimap rail.
		const dot = page.locator('[data-testid^="minimap-dot-"]').first();
		await expect(dot).toBeVisible({ timeout: 10_000 });
	});

	test("mark addressed → chip count 0/1 → reopen → 1/1", async () => {
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

		// The review chip shows the worktree-wide unresolved/all comment count.
		// Addressing the sole comment drops the unresolved count to 0 while the
		// total stays 1, so the label reads "0/1".
		const commentsChip = page.getByTestId("review-chipbar-comments");
		await expect(commentsChip).toBeVisible({ timeout: 10_000 });
		await expect(commentsChip).toContainText("0/1", { timeout: 5_000 });

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

		// Reopening restores the unresolved count to 1, so the label reads "1/1".
		await expect(commentsChip).toContainText("1/1", { timeout: 5_000 });
	});

	test("persist across reload", async () => {
		test.setTimeout(180_000);

		// Close and relaunch with the same persisted state
		await closeApp(app);
		await relaunch();

		// Re-open the diff for src/index.ts
		await openIndexTsDiff();

		// The comment should persist as an inline thread in the diff.
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

	test("mark file viewed advances the progress header", async () => {
		test.setTimeout(120_000);
		await openIndexTsDiff();
		const header = page.locator('[data-testid="review-progress-header"]');
		await expect(header).toContainText("reviewed");
		await page.keyboard.press("Meta+Shift+V");
		await expect(header).toContainText("1 / ", { timeout: 10_000 });
	});

	test("inline comment shows a minimap dot", async () => {
		test.setTimeout(120_000);
		await openIndexTsDiff();
		await addInlineComment("minimap dot check");
		// A dot must appear in the minimap rail for the newly saved comment.
		const dot = page.locator('[data-testid^="minimap-dot-"]').first();
		await expect(dot).toBeVisible({ timeout: 10_000 });
	});

	test("resolve from the minimap flyout", async () => {
		test.setTimeout(120_000);
		// A minimap dot is present from the "minimap dot check" comment added in
		// the previous test. Hover the dot to open the flyout, then click Resolve
		// via evaluate to bypass any pointer-event overlay on the minimap rail.
		await openIndexTsDiff();
		const dot = page.locator('[data-testid^="minimap-dot-"]').first();
		await expect(dot).toBeVisible({ timeout: 10_000 });
		await dot.hover();
		// Wait for the flyout to become active (CommentMinimap flips aria-hidden
		// from "true" to "false" on hover via onMouseEnter → setActiveHeadId).
		await page.waitForFunction(
			() =>
				document.querySelector(
					'.shell-review-minimap__flyout[aria-hidden="false"]',
				) !== null,
			null,
			{ timeout: 5_000 },
		);
		await page.evaluate(() => {
			const flyout = document.querySelector(
				'.shell-review-minimap__flyout[aria-hidden="false"]',
			);
			if (!flyout) throw new Error("minimap flyout not visible");
			const btns = flyout.querySelectorAll("button");
			for (const btn of btns) {
				if (btn.textContent?.trim() === "Resolve") {
					btn.click();
					return;
				}
			}
			throw new Error("Resolve button not found in minimap flyout");
		});
		// Assert: resolving the "minimap dot check" comment moves it from unresolved
		// to addressed. The two comments in this file ("rename x" + "minimap dot
		// check") keep the total at 2 while the unresolved count drops to 1, so the
		// review chip reads "1/2".
		const commentsChip = page.getByTestId("review-chipbar-comments");
		await expect(commentsChip).toContainText("1/2", { timeout: 10_000 });
	});

	test("the open-comments chip is a non-interactive unresolved/all count label", async () => {
		test.setTimeout(120_000);
		await openIndexTsDiff();
		// After the resolve test, one comment is unresolved and one is addressed in
		// this file, so the chip reads "1/2". The chip is now a plain label (a
		// <span>), not a button, so it has no click behavior to exercise.
		const commentsChip = page.getByTestId("review-chipbar-comments");
		await expect(commentsChip).toBeVisible({ timeout: 10_000 });
		await expect(commentsChip).toContainText("1/2", { timeout: 10_000 });
		await expect(commentsChip).toHaveJSProperty("tagName", "SPAN");
	});

	test("Commits mode shows the progress header and mark-viewed toggle", async () => {
		test.setTimeout(120_000);
		await ensureReviewOverlayOpen(page);
		await page.keyboard.press("Meta+3"); // review.commits
		// Guard: if the fixture has no reviewable commits, skip rather than
		// silently passing as covered. Never omit this guard — an empty commit
		// list would let the assertions below trivially succeed without exercising
		// the Commits-mode rail chrome at all.
		const commitItems = page.locator(".shell-commit-list__item");
		if ((await commitItems.count()) === 0) {
			console.log(
				"Commits-mode e2e skipped: no reviewable commits in fixture",
			);
			test.skip();
			return;
		}
		await commitItems.first().click();
		await page
			.locator(".shell-commit-list__files .shell-list__item--split")
			.first()
			.click();
		await expect(
			page.locator('[data-testid="review-progress-header"]'),
		).toBeVisible({ timeout: 10_000 });
		const toggle = page.locator('[data-testid="mark-viewed-toggle"]');
		await expect(toggle).toBeVisible();
		await toggle.click();
		await expect(toggle).toHaveText(/viewed/i);
	});
});
