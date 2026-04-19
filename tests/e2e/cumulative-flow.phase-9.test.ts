import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase9-")));
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

test.describe.serial("Cumulative flow — Phase 9 (Lightweight Editor)", () => {
	test("loads the repo and navigates to Files tab on feature-a", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		await expect(
			page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: "feature-a", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: "feature-a", exact: true })
			.click();
		await page.getByRole("tab", { name: "Files" }).click();
		await expect(
			page.getByText("feature-a", { exact: true }).first(),
		).toBeVisible({
			timeout: 15_000,
		});
	});

	test("right-clicking a whitelisted .md file shows both Preview and Edit", async () => {
		test.setTimeout(30_000);
		const notesMdRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await expect(notesMdRow).toBeVisible({ timeout: 10_000 });
		await notesMdRow.click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Preview" })).toBeVisible({
			timeout: 5_000,
		});
		await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
		// Dismiss menu
		await page.keyboard.press("Escape");
	});

	test("right-clicking a non-whitelisted file shows neither Preview nor Edit", async () => {
		test.setTimeout(30_000);
		const pngRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^logo\.png/ });
		await expect(pngRow).toBeVisible({ timeout: 10_000 });
		await pngRow.click({ button: "right" });
		// No menuitem should appear
		await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
		await expect(page.getByRole("menuitem", { name: "Preview" })).toHaveCount(
			0,
		);
		// Click elsewhere to dismiss any potential menu
		await page.keyboard.press("Escape");
	});

	test("Cmd+E on a non-whitelisted file is a no-op", async () => {
		test.setTimeout(30_000);
		// Click logo.png to select it (triggers session/selectFile)
		const pngRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^logo\.png/ });
		await pngRow.click();
		// Press Cmd+E — should be a no-op for non-whitelisted file
		await page.keyboard.press("Meta+e");
		// No editor dialog should have appeared
		await expect(page.locator(".shell-editor-modal")).toHaveCount(0, {
			timeout: 1_000,
		});
	});

	test("Edit opens modal with file content for a whitelisted file", async () => {
		test.setTimeout(30_000);
		const notesMdRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await notesMdRow.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Edit" }).click();
		// Modal should be visible
		const dialog = page.locator(".shell-editor-modal");
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		// Modal should contain some of the file content
		await expect(dialog.getByText("Preview Test")).toBeVisible({
			timeout: 5_000,
		});
	});

	test("editing and saving via Cmd+S persists content to disk", async () => {
		test.setTimeout(30_000);
		const dialog = page.locator(".shell-editor-modal");
		// The Monaco editor is in the dialog — click inside it and type
		const editorArea = dialog.locator(".monaco-editor");
		await editorArea.click();
		// Move to end of document and add a new line
		await page.keyboard.press("Meta+End");
		await page.keyboard.type("\n<!-- e2e-edit -->");
		// Save button should now be enabled (dirty)
		const saveBtn = dialog.getByRole("button", { name: "Save" });
		await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
		// Save with Cmd+S
		await page.keyboard.press("Meta+s");
		// Inline "Saved" status should appear in footer
		await expect(dialog.getByText(/Saved \d{1,2}:\d{2}:\d{2}/)).toBeVisible({
			timeout: 10_000,
		});
		// Modal should stay open after save
		await expect(dialog).toBeVisible();
		// File on disk should now contain the edit
		const diskContent = readFileSync(
			join(testRepo.worktreePath, "NOTES.md"),
			"utf8",
		);
		expect(diskContent).toContain("e2e-edit");
		// Close the modal
		await dialog.getByRole("button", { name: "Close" }).click();
		await expect(dialog).not.toBeVisible({ timeout: 5_000 });
	});

	test("closing with dirty buffer shows ConfirmCloseDialog; Cancel keeps modal open", async () => {
		test.setTimeout(30_000);
		// Open NOTES.md again
		const notesMdRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await notesMdRow.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Edit" }).click();
		const dialog = page.locator(".shell-editor-modal");
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		// Type to make dirty
		const editorArea = dialog.locator(".monaco-editor");
		await editorArea.click();
		await page.keyboard.press("Meta+End");
		await page.keyboard.type("\n<!-- dirty -->");
		// Click Close
		await dialog.getByRole("button", { name: "Close" }).click();
		// ConfirmCloseDialog should appear
		await expect(page.getByText("Unsaved changes")).toBeVisible({
			timeout: 5_000,
		});
		// Click Cancel — modal stays open
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeVisible({ timeout: 5_000 });
		// Discard to close cleanly
		await dialog.getByRole("button", { name: "Close" }).click();
		await page.getByRole("button", { name: "Discard" }).click();
		await expect(dialog).not.toBeVisible({ timeout: 5_000 });
	});

	test("mtime conflict: external write between open and save shows SaveConflictDialog", async () => {
		test.setTimeout(30_000);
		// Open src/index.ts (a .ts file — also whitelisted and editable)
		const srcDir = page.locator(".shell-list__item--dir", { hasText: "src" });
		await srcDir.click(); // expand src
		const indexRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^index\.ts/ });
		await expect(indexRow).toBeVisible({ timeout: 5_000 });
		await indexRow.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Edit" }).click();
		const dialog = page.locator(".shell-editor-modal");
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		// Make a small edit to become dirty
		const editorArea = dialog.locator(".monaco-editor");
		await editorArea.click();
		await page.keyboard.press("Meta+End");
		await page.keyboard.type(" // e2e");
		// Externally overwrite the file to change its mtime
		writeFileSync(
			join(testRepo.worktreePath, "src", "index.ts"),
			'export const hello = "conflict";\n',
		);
		// Press Cmd+S — should detect mtime conflict
		await page.keyboard.press("Meta+s");
		// SaveConflictDialog should appear
		await expect(page.getByText("File changed on disk")).toBeVisible({
			timeout: 10_000,
		});
		// Click Overwrite to force-save
		await page.getByRole("button", { name: "Overwrite" }).click();
		// Modal should remain open after overwrite; Saved status should appear
		await expect(dialog.getByText(/Saved \d{1,2}:\d{2}:\d{2}/)).toBeVisible({
			timeout: 10_000,
		});
		// Disk content should match the editor buffer (with the e2e edit)
		const diskContent = readFileSync(
			join(testRepo.worktreePath, "src", "index.ts"),
			"utf8",
		);
		expect(diskContent).toContain("e2e");
		// Close cleanly
		await dialog.getByRole("button", { name: "Close" }).click();
		await expect(dialog).not.toBeVisible({ timeout: 5_000 });
	});

	test("Markdown Preview flow still works (phase-8 regression)", async () => {
		test.setTimeout(30_000);
		const notesMdRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^NOTES\.md/ });
		await notesMdRow.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Preview" }).click();
		// Markdown preview modal should open
		await expect(page.getByText("Preview Test")).toBeVisible({
			timeout: 10_000,
		});
		// Close it
		await page.keyboard.press("Escape");
		await expect(page.getByText("Preview Test")).not.toBeVisible({
			timeout: 5_000,
		});
	});
});
