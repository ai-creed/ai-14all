import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import { ensureReviewOverlayOpen } from "./helpers/review-overlay";

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
	// Select the feature-a worktree (has dirty files).
	await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	// Seed a deterministic, viewable first changed file. changedFiles is sorted
	// by path.localeCompare (services/git/git-service.ts:244), and "AAA-first.ts"
	// sorts before the fixture's other changes (logo.png, NOTES.md, src/*), so it
	// is firstViewableChangedFile — and it is a real .ts file the viewer renders.
	writeFileSync(
		join(testRepo.worktreePath, "AAA-first.ts"),
		"export const first = true;\n",
	);
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-review-chip-actions-")),
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
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test.describe.serial("Review chip actions", () => {
	test("changed-files chip opens Files mode with the first non-deleted file selected and rendered", async () => {
		test.setTimeout(60_000);

		// The seeded file was written before launch, so it is already in the
		// changed set. Click the actionable "x changed" chip.
		const filesChip = page.getByTestId("review-chipbar-files");
		await expect(filesChip).toBeVisible({ timeout: 15_000 });
		await filesChip.click();

		// Overlay open, Files tab active, and the FILE VIEWER shows the first
		// non-deleted changed file — i.e. it was actually selected, not just the
		// tab switched.
		await expect(page.getByTestId("review-expanded-portal")).toBeVisible();
		await expect(page.getByRole("tab", { name: /files/i })).toHaveAttribute(
			"data-state",
			"active",
		);
		await expect(page.locator(".shell-viewer__title")).toHaveText(
			"AAA-first.ts",
			{ timeout: 15_000 },
		);

		// Reset for the next test.
		await page.keyboard.press("Escape");
	});

	test("open-comments chip navigates to, reveals, and focuses the first open comment", async () => {
		test.setTimeout(120_000);

		// --- Arrange: create one open comment in src/index.ts via the inline draft flow ---
		await ensureReviewOverlayOpen(page);
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });
		const changedFileButton = page.getByRole("button", {
			name: /src\/index\.ts/i,
		});
		await expect(changedFileButton).toBeVisible({ timeout: 15_000 });
		await changedFileButton.click({ force: true });

		await page.waitForSelector(".modified-in-monaco-diff-editor", {
			timeout: 15_000,
		});
		const viewLines = page.locator(
			".modified-in-monaco-diff-editor .view-line",
		);
		await expect(viewLines.first()).toBeVisible({ timeout: 10_000 });
		const box = await viewLines.first().boundingBox();
		if (!box) {
			throw new Error("Modified editor first view-line has no bounding box");
		}
		await page.mouse.click(box.x + 60, box.y + box.height / 2);
		await page.waitForTimeout(200);

		// Open a draft at the caret (installCommentKeyBindings).
		await page.keyboard.press("Meta+Shift+A");
		await page.waitForFunction(
			() =>
				document.querySelector('.shell-inline-thread[data-draft="true"]') !==
				null,
			null,
			{ timeout: 10_000 },
		);
		const textarea = page.locator(".shell-inline-thread__textarea");
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill("rename x");
		// Save via evaluate(): Monaco's view-lines overlay intercepts pointer events.
		await page.evaluate(() => {
			const draft = document.querySelector(
				'.shell-inline-thread[data-draft="true"]',
			);
			if (!draft) throw new Error("No draft thread");
			for (const btn of Array.from(draft.querySelectorAll("button"))) {
				if (btn.textContent?.trim() === "Save") {
					(btn as HTMLButtonElement).click();
					return;
				}
			}
			throw new Error("Save button not found in draft thread");
		});
		// Confirm the comment persisted (queue panel will show it).
		await expect(page.getByTestId("review-queue-panel")).toBeVisible({
			timeout: 15_000,
		});

		// Collapse the overlay so the chip drives a cold-open jump. Use the
		// collapse button (Escape is swallowed by the focused Monaco editor).
		await page
			.getByRole("button", { name: /collapse full review/i })
			.click({ force: true });
		await expect(page.getByTestId("review-expanded-portal")).toHaveCount(0, {
			timeout: 15_000,
		});

		// --- Act: click the open-comments chip ---
		const commentsChip = page.getByTestId("review-chipbar-comments");
		await expect(commentsChip).toBeVisible({ timeout: 15_000 });
		await commentsChip.click();

		// --- Assert: overlay + sidebar open, jumped to the comment's file, thread
		// revealed, and the thread is focused (not merely "sidebar visible"). ---
		await expect(page.getByTestId("review-expanded-portal")).toBeVisible();
		await expect(page.getByTestId("review-queue-panel")).toBeVisible();
		await expect(
			page.locator('.shell-list__item[data-selected="true"]'),
		).toContainText("index.ts", { timeout: 15_000 });
		await expect(
			page.locator(".shell-inline-thread", { hasText: "rename x" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("review-grid")).not.toHaveAttribute(
			"data-focused-thread-id",
			"",
		);
	});
});
