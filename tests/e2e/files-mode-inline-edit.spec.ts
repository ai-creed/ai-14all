// Files-mode inline editor e2e.
//
// Mirrors the test-strategy in
// docs/superpowers/specs/2026-05-28-review-chrome-inline-editor-design.md
//
// Coverage:
//   1. Selecting a whitelisted file in Files mode mounts InlineEditor; no dirty
//      bar visible initially.
//   2. Typing flips the dirty bar visible (Save / Discard).
//   3. Save persists to disk and survives an in-app reload (re-select after
//      navigating away and back).
//   4. Editing again then clicking another file opens ConfirmCloseDialog; Save
//      advances the switch and clears the bar.
//   5. "Show ignored" toggle reveals .env dimmed; node_modules stays elided by
//      the denylist.

import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeApp } from "./fixtures/close-app";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { ensureReviewOverlayOpen } from "./helpers/review-overlay";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	// Add an editable .md plus ignored noise to the feature-a worktree so the
	// Show ignored scenario has both an allowed ignored file and a denylisted
	// directory to elide.
	const wt = testRepo.worktreePath;
	writeFileSync(join(wt, ".gitignore"), "node_modules\n.env\n", { flag: "a" });
	writeFileSync(join(wt, ".env"), "SECRET=1\n");
	mkdirSync(join(wt, "node_modules"), { recursive: true });
	writeFileSync(join(wt, "node_modules", "pkg.js"), "x\n");

	stateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-inline-edit-state-")),
	);
	const workspaceStatePath = join(stateDir, "workspace-state.json");
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
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Files-mode inline edit", () => {
	test("loads the repo and navigates to Files tab on feature-a", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		const featureA = page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: "feature-a", exact: true });
		await expect(featureA).toBeVisible({ timeout: 15_000 });
		await featureA.click();
		await ensureReviewOverlayOpen(page);
		await page.getByRole("tab", { name: "Files" }).click({ force: true });
		// Files tab is mounted once we can see a tree row for a known file.
		const notesRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await expect(notesRow).toBeVisible({ timeout: 15_000 });
	});

	test("selecting a .md file mounts InlineEditor with no dirty bar", async () => {
		test.setTimeout(30_000);
		const notesRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await notesRow.click();
		await expect(page.getByTestId("inline-editor")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("editor-dirty-bar")).toHaveCount(0);
	});

	test("typing surfaces the dirty bar", async () => {
		test.setTimeout(30_000);
		// Click the editor body (not the IME-proxy textarea). The view-lines
		// region focuses the real input area without colliding with Monaco's
		// pointer-intercepting overlays.
		const editorBody = page.locator(".monaco-editor .view-lines").first();
		await editorBody.click();
		await page.keyboard.press("Meta+End");
		await page.keyboard.type("\nFIRST EDIT\n");
		await expect(page.getByTestId("editor-dirty-bar")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("Save persists content to disk and survives a reload", async () => {
		test.setTimeout(30_000);
		const dirtyBar = page.getByTestId("editor-dirty-bar");
		await dirtyBar.getByRole("button", { name: /save/i }).click();
		await expect(dirtyBar).toHaveCount(0, { timeout: 5_000 });
		// Disk content must contain the edit after save. The write flushes
		// asynchronously, so poll rather than reading once right after the dirty
		// bar clears.
		await expect
			.poll(
				() => readFileSync(join(testRepo.worktreePath, "NOTES.md"), "utf8"),
				{
					timeout: 10_000,
					message: "NOTES.md should contain the saved edit",
				},
			)
			.toContain("FIRST EDIT");

		// Reload coverage: navigate away to a different file, then back to
		// NOTES.md. The freshly-mounted editor must reflect the saved value.
		const srcDir = page
			.locator(".shell-list__item--dir")
			.filter({ hasText: "src" })
			.first();
		await expect(srcDir).toBeVisible({ timeout: 10_000 });
		await srcDir.click();
		const indexRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /index\.ts/ })
			.first();
		await expect(indexRow).toBeVisible({ timeout: 10_000 });
		await indexRow.click();
		await expect(page.getByTestId("inline-editor")).toBeVisible();

		const notesRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await notesRow.click();
		await expect(page.getByTestId("inline-editor")).toBeVisible();
		// Monaco renders the textarea content; the editor's visible text should
		// include the previously-saved marker.
		await expect(page.locator(".monaco-editor").first()).toContainText(
			"FIRST EDIT",
			{ timeout: 10_000 },
		);
	});

	test("dirty switch flow: Save in ConfirmCloseDialog advances to the new file", async () => {
		test.setTimeout(30_000);
		// Click the editor body (not the IME-proxy textarea). The view-lines
		// region focuses the real input area without colliding with Monaco's
		// pointer-intercepting overlays.
		const editorBody = page.locator(".monaco-editor .view-lines").first();
		await editorBody.click();
		await page.keyboard.press("Meta+End");
		await page.keyboard.type("\nSECOND EDIT\n");
		await expect(page.getByTestId("editor-dirty-bar")).toBeVisible({
			timeout: 5_000,
		});

		// Click a different file — should trigger ConfirmCloseDialog.
		const indexRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /index\.ts/ })
			.first();
		await indexRow.click();
		// Match the dialog heading specifically — the dirty bar also contains
		// the phrase, so a bare text match resolves to two elements.
		await expect(
			page.getByRole("heading", { name: /unsaved changes/i }),
		).toBeVisible({
			timeout: 5_000,
		});

		// Click Save in the dialog (the last matching Save button — first one is
		// the dirty bar's Save which the dialog supersedes).
		const saveButtons = page.getByRole("button", { name: /^save$/i });
		await saveButtons.last().click();

		// After save+switch: dirty bar is gone, current selection is index.ts.
		await expect(page.getByTestId("editor-dirty-bar")).toHaveCount(0, {
			timeout: 10_000,
		});
		await expect(page.getByTestId("inline-editor")).toBeVisible();

		// Persistence assertion on disk for NOTES.md. The save flushes to disk
		// asynchronously after the dialog resolves and the dirty bar clears, so
		// poll the file rather than reading it once (the dirty bar can clear from
		// the in-memory state before the write lands).
		await expect
			.poll(
				() => readFileSync(join(testRepo.worktreePath, "NOTES.md"), "utf8"),
				{
					timeout: 10_000,
					message: "NOTES.md should contain the saved edit",
				},
			)
			.toContain("SECOND EDIT");
	});

	test("Show ignored reveals .env, hides node_modules via denylist", async () => {
		test.setTimeout(30_000);
		// The toggle is a role="switch" button, not a native checkbox — click
		// to flip it on instead of `.check()`. The aria-label after the polish
		// pass is "Show gitignored files".
		const toggle = page.getByRole("switch", {
			name: /show gitignored/i,
		});
		await toggle.click();
		const envRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^\.env/ });
		await expect(envRow.first()).toBeVisible({ timeout: 10_000 });
		await expect(envRow.first()).toHaveAttribute("data-ignored", "true");

		// node_modules is denylisted — it must not appear even when ignored is on.
		const nodeModulesRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^node_modules/ });
		await expect(nodeModulesRow).toHaveCount(0);
	});
});
