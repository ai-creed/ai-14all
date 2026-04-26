/**
 * E2E tests for Review Comments (Task 30).
 *
 * SKIP REASON: All E2E tests in this project currently fail because
 * `window.ai14all` (injected via contextBridge in the Electron preload) is
 * never defined when Playwright launches the app. Root-cause analysis shows
 * that Playwright 1.59's loader.js patches `app.whenReady` / `app.emit` and
 * inserts itself via `-r loader` before `out/main/index.js`. This interacts
 * with Electron 41's sandboxed-preload execution: the preload runs but
 * `contextBridge.exposeInMainWorld` does not surface `window.ai14all` in the
 * renderer's main execution context. React then crashes in its first
 * `useEffect` (`system.onUpdateAvailable`) because `window.ai14all` is
 * undefined. The same failure is reproduced by running `review-drawer.test.ts`
 * and `cumulative-flow.phase-0.test.ts` on this machine.
 *
 * Resolution path: investigate the Playwright+Electron preload timing issue
 * (possibly upgrade Playwright or adjust `sandbox`/`contextIsolation` flags)
 * before enabling these tests.
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
import { ensureReviewDrawerOpen } from "./helpers/review-drawer";

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
	page.setDefaultTimeout(60_000);
}

async function relaunch() {
	await launchRaw();
	await page
		.getByRole("button", { name: "Restore previous workspace" })
		.click();
	const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(
		worktreeNav.getByRole("button", { name: /feature-a/i }),
	).toBeVisible({ timeout: 15_000 });
}

/**
 * Select two lines in the modified diff editor to trigger the floating add button.
 * The floating button appears only for multi-line selections (not single-line
 * cursor placement), per diff-editor-decorations.ts onDidChangeCursorSelection.
 */
async function selectTwoLinesInModifiedEditor() {
	await page.waitForSelector(".modified-in-monaco-diff-editor", { timeout: 15_000 });
	const modifiedPane = page.locator(".modified-in-monaco-diff-editor");
	const viewLines = modifiedPane.locator(".view-line");
	await expect(viewLines.first()).toBeVisible({ timeout: 10_000 });

	const firstLine = viewLines.first();
	const box = await firstLine.boundingBox();
	if (!box) throw new Error("Modified editor first view-line has no bounding box");

	// Click to focus the editor
	await page.mouse.click(box.x + 60, box.y + box.height / 2);
	await page.waitForTimeout(200);

	// Drag from line 1 to line 2 to create a multi-line selection
	await page.mouse.move(box.x + 60, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 60, box.y + box.height * 2.5);
	await page.mouse.up();
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-review-comments-")));
	persistedStatePath = join(persistedStateDir, "workspace-state.json");

	// Launch and open the workspace — navigates to feature-a which has dirty files
	await launchRaw();
	await page.getByRole("button", { name: "Browse" }).click();
	await page.getByRole("button", { name: "Load" }).click();
	const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(
		worktreeNav.getByRole("button", { name: /feature-a/i }),
	).toBeVisible({ timeout: 15_000 });
	// Navigate to feature-a (has dirty src/index.ts and committed src/committed.ts)
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

test.describe.serial("Review comments", () => {
	test.skip(true, "Blocked: contextBridge/preload not surfacing window.ai14all under Playwright 1.59 + Electron 41 — all E2E tests broken in this environment");

	test("author, persist, mark addressed, delete in changes mode", async () => {
		test.setTimeout(120_000);

		// Open the review drawer and switch to Changes tab
		await ensureReviewDrawerOpen(page);
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });

		// Wait for src/index.ts in the changes list and click it
		const changedFileButton = page.getByRole("button", { name: /src\/index\.ts/i });
		await expect(changedFileButton).toBeVisible({ timeout: 15_000 });
		await changedFileButton.click({ force: true });

		// Wait for the diff viewer to appear
		await expect(page.getByText("Diff vs HEAD")).toBeVisible({ timeout: 15_000 });

		// Select two lines in the modified editor to trigger the floating add button
		await selectTwoLinesInModifiedEditor();

		// Wait for the floating add button to appear
		const floatingAdd = page.locator(".shell-review-floating-add");
		await expect(floatingAdd).toBeVisible({ timeout: 10_000 });

		// Click the floating button to open the comment form
		await floatingAdd.click();

		// Fill the textarea with a comment
		const textarea = page.locator('textarea[placeholder="What should the agent change?"]');
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill("rename x");

		// Click Save
		await page.getByRole("button", { name: "Save" }).click();

		// Assert comment card is visible in the sidebar
		const commentCard = page.locator(".shell-review-comment-card");
		await expect(commentCard).toBeVisible({ timeout: 10_000 });

		// Assert range text "L" and the comment body
		await expect(commentCard.locator(".shell-review-comment-card__range")).toContainText("L");
		await expect(commentCard.locator(".shell-review-comment-card__body")).toHaveText("rename x");

		// Assert the changes list shows [1] badge next to src/index.ts
		const badge = page.locator(".shell-review-comment-badge");
		await expect(badge).toBeVisible({ timeout: 5_000 });
		await expect(badge).toContainText("[1]");

		// Reload and verify persistence
		await closeApp(app);
		await relaunch();

		// Open drawer and go to Changes tab again
		await ensureReviewDrawerOpen(page);
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });
		await page.getByRole("button", { name: /src\/index\.ts/i }).click({ force: true });
		await expect(page.getByText("Diff vs HEAD")).toBeVisible({ timeout: 15_000 });

		// Assert the comment card persisted
		const persistedCard = page.locator(".shell-review-comment-card");
		await expect(persistedCard).toBeVisible({ timeout: 10_000 });
		await expect(persistedCard.locator(".shell-review-comment-card__body")).toHaveText("rename x");

		// Mark addressed
		await page.getByRole("button", { name: "mark addressed" }).click();
		await expect(persistedCard).toHaveAttribute("data-status", "addressed", { timeout: 5_000 });

		// Delete the comment
		await page.getByRole("button", { name: "delete comment" }).click();
		await expect(page.locator(".shell-review-comment-card")).toHaveCount(0, { timeout: 5_000 });
		await expect(page.locator(".shell-review-comment-badge")).toHaveCount(0, { timeout: 5_000 });
	});

	test("add comment in commits mode via focus-first", async () => {
		test.setTimeout(120_000);

		// Switch to Commits tab — feature-a has a "feature commit" with src/committed.ts
		await ensureReviewDrawerOpen(page);
		await page.getByRole("tab", { name: "Commits" }).click({ force: true });

		// Wait for the commit list and click the feature commit
		const commitButton = page.getByRole("button", { name: /feature commit/i });
		await expect(commitButton).toBeVisible({ timeout: 15_000 });
		await commitButton.click();

		// Wait for files list to expand and click src/committed.ts
		const commitFileButton = page
			.getByTestId("review-rail")
			.getByRole("button", { name: /src\/committed\.ts/i });
		await expect(commitFileButton).toBeVisible({ timeout: 10_000 });
		await commitFileButton.click();

		// Wait for the diff viewer to appear
		await expect(page.locator(".shell-viewer__title", { hasText: "feature commit" })).toBeVisible({ timeout: 15_000 });
		await expect(page.locator(".modified-in-monaco-diff-editor")).toBeVisible({ timeout: 15_000 });

		// Select two lines in the modified editor to trigger the floating add button
		await selectTwoLinesInModifiedEditor();

		// Wait for the floating add button to appear
		const floatingAdd = page.locator(".shell-review-floating-add");
		await expect(floatingAdd).toBeVisible({ timeout: 10_000 });

		// Click the floating button to open the comment form
		await floatingAdd.click();

		// Fill the textarea with a comment
		const textarea = page.locator('textarea[placeholder="What should the agent change?"]');
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill("rename committed");

		// Click Save
		await page.getByRole("button", { name: "Save" }).click();

		// Assert comment card is visible in the sidebar
		const commentCard = page.locator(".shell-review-comment-card");
		await expect(commentCard).toBeVisible({ timeout: 10_000 });
		await expect(commentCard.locator(".shell-review-comment-card__body")).toHaveText("rename committed");
		await expect(commentCard.locator(".shell-review-comment-card__range")).toContainText("L");
	});
});
