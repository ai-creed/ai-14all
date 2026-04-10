import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { writeFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let workspaceStatePath: string;
let gitFaultsPath: string;

async function ensureWorkspaceLoaded() {
	const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
	if (await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false)) {
		return;
	}

	const repoInput = page.locator("#repo-path");
	await expect(repoInput).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(repoInput).toHaveValue(testRepo.repoPath);
	await repoInput.press("Enter");

	await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase6-")));
	workspaceStatePath = join(persistedStateDir, "workspace-state.json");
	gitFaultsPath = join(persistedStateDir, "git-faults.json");
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: workspaceStatePath,
			AI14ALL_E2E_GIT_FAULTS_PATH: gitFaultsPath,
		},
	});
	page = await app.firstWindow();
});

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

// Note: gitFaultsPath cleanup is handled by rmSync(persistedStateDir) above.

test.describe.serial("Cumulative flow — Phase 6", () => {
	test("shows a default shell, opens a terminal tab context menu, and reviews a recent commit", async () => {
		test.setTimeout(60_000);
		await ensureWorkspaceLoaded();

		await page.getByRole("button", { name: "Presets" }).click();
		await expect(page.getByRole("menuitem", { name: "start claude" })).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "start codex" })).toBeVisible();
		await page.keyboard.press("Escape");

		await page.getByRole("tab", { name: "Commits" }).click();
		await expect(page.getByRole("button", { name: "Refresh review" })).toBeVisible();
		await expect(
			page.getByTestId("review-rail").getByText("origin/main"),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: /initial commit/i }),
		).toBeVisible();
		await expect(
			page.getByText("No recent commits to review."),
		).toHaveCount(0);
		await page.getByRole("button", { name: /initial commit/i }).click();
		await expect(
			page.getByTestId("review-rail").getByRole("button", { name: /src\/index\.ts/i }),
		).toBeVisible();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
		await expect(page.getByText("1 ahead of origin/main")).toBeVisible();

		const shellLayout = page.getByTestId("shell-layout");
		await expect(shellLayout).toHaveAttribute(
			"style",
			/grid-template-columns:\s*240px minmax\(0px?,\s*1fr\)/,
		);

		const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
		await worktreeNav.getByRole("button", { name: "Collapse sidebar" }).click();
		await expect(shellLayout).toHaveAttribute(
			"style",
			/grid-template-columns:\s*56px minmax\(0px?,\s*1fr\)/,
		);
		await worktreeNav.getByRole("button", { name: "Expand sidebar" }).click();

		const terminalSection = page.locator(".shell-terminal-section");
		const terminalBefore = await terminalSection.boundingBox();
		const reviewHandle = page.getByTestId("review-panel-resize-handle");
		const reviewHandleBox = await reviewHandle.boundingBox();
		if (!terminalBefore || !reviewHandleBox) {
			throw new Error("Review panel resize handle was not visible.");
		}

		await page.mouse.move(
			reviewHandleBox.x + reviewHandleBox.width / 2,
			reviewHandleBox.y + reviewHandleBox.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			reviewHandleBox.x + reviewHandleBox.width / 2,
			reviewHandleBox.y + reviewHandleBox.height / 2 + 60,
		);
		await page.mouse.up();

		await expect
			.poll(async () => (await terminalSection.boundingBox())?.height ?? 0)
			.toBeGreaterThan(terminalBefore.height);

		await page.evaluate(async () => {
			const pane = document.querySelector<HTMLElement>(
				'.shell-terminal-pane[aria-hidden="false"]',
			);
			const terminalSessionId = pane?.dataset.terminalSessionId;
			if (!terminalSessionId) {
				throw new Error("Visible terminal session was not found.");
			}
			await window.ai14all.terminals.sendInput(
				terminalSessionId,
				"printf '\\033]0;codex\\007'; sleep 1\n",
			);
		});
		await expect(page.getByRole("tab", { name: /^codex$/i })).toBeVisible();

		// Check the tab context menu while the title is still "codex".
		// This must happen before the Ctrl+L clear below, which causes the shell
		// to reprint its prompt and reset the xterm title back to the CWD.
		await page.getByRole("tab", { name: /^codex$/i }).click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Pin" })).toBeVisible();
		await page.keyboard.press("Escape");

		await expect(
			page.getByTestId("review-rail").getByRole("tablist", { name: "Review mode" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Refresh review" })).toBeVisible();

		await page.getByRole("tab", { name: "Changes" }).click();
		await page.getByRole("button", { name: /src\/index\.ts/i }).click();
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();

		await page.getByRole("button", { name: "Collapse review panel" }).click();
		await expect(page.getByTestId("review-stack-header")).toContainText(
			"Review: Changes",
		);
		await page.getByRole("button", { name: "Expand review panel" }).click();
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();

		const textarea = page.locator('.shell-terminal-pane[aria-hidden="false"] .xterm-helper-textarea');
		await textarea.focus();
		await page.keyboard.type("echo phase-6-clear");
		await page.keyboard.press("Enter");
		const visibleAccessTree = page.locator(
			'.shell-terminal-pane[aria-hidden="false"] .xterm-accessibility-tree',
		);
		await expect(visibleAccessTree).toContainText("phase-6-clear", { timeout: 10_000 });

		// Cmd+K / Ctrl+K clears the xterm buffer — tested in TerminalPane unit tests.
		// In e2e, Playwright CDP key events are untrusted and don't reach xterm's
		// custom key event handler reliably. Use Ctrl+L (sendInput) to clear the
		// terminal viewport and verify the output is gone.
		await page.evaluate(async () => {
			const pane = document.querySelector<HTMLElement>(
				'.shell-terminal-pane[aria-hidden="false"]',
			);
			const terminalSessionId = pane?.dataset.terminalSessionId;
			if (!terminalSessionId) throw new Error("Visible terminal session not found.");
			await window.ai14all.terminals.sendInput(terminalSessionId, "\x0c");
		});
		await expect(visibleAccessTree).not.toContainText("phase-6-clear", { timeout: 5_000 });

		await page.keyboard.type("echo after-clear");
		await page.keyboard.press("Enter");
		await expect(visibleAccessTree).toContainText("after-clear", { timeout: 10_000 });

		const reviewRail = page.getByTestId("review-rail");
		const resizeHandle = page.getByTestId("review-rail-resize-handle");
		const reviewRailBefore = await reviewRail.boundingBox();
		const resizeHandleBox = await resizeHandle.boundingBox();
		if (!reviewRailBefore || !resizeHandleBox) {
			throw new Error("Review rail resize controls were not visible.");
		}

		await page.mouse.move(
			resizeHandleBox.x + resizeHandleBox.width / 2,
			resizeHandleBox.y + resizeHandleBox.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			resizeHandleBox.x + resizeHandleBox.width / 2 + 72,
			resizeHandleBox.y + resizeHandleBox.height / 2,
		);
		await page.mouse.up();

		await expect
			.poll(async () => (await reviewRail.boundingBox())?.width ?? 0)
			.toBeGreaterThan(reviewRailBefore.width);

		await page.getByRole("tab", { name: "Commits" }).click();
		await expect(page.getByRole("button", { name: "Refresh review" })).toBeVisible();
		await expect(
			page.getByTestId("review-rail").getByText("origin/main"),
		).toBeVisible({ timeout: 15_000 });
		const commitButton = page.getByRole("button", { name: /feature commit/i });
		await expect(commitButton).toBeVisible();
		await commitButton.click();
		await page
			.getByTestId("review-rail")
			.getByRole("button", { name: /src\/committed\.ts/i })
			.click();
		await expect(
			page.locator(".shell-viewer__title", { hasText: "feature commit" }),
		).toBeVisible();
		await expect(
			page.locator('[data-testid="commit-diff-section-src/committed.ts"]'),
		).toBeVisible();
		await expect(page.getByText("Diff vs HEAD")).toHaveCount(0);

		const scrollCheck = await page.evaluate(() => ({
			body: document.body.scrollHeight > document.body.clientHeight,
			root:
				document.documentElement.scrollHeight >
				document.documentElement.clientHeight,
		}));
		expect(scrollCheck.body).toBe(false);
		expect(scrollCheck.root).toBe(false);
	});

	test("launches maximized, collapses the top band, and keeps the main window non-scrollable", async () => {
		const isMaximized = await app!.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].isMaximized(),
		);
		expect(isMaximized).toBe(true);

		await ensureWorkspaceLoaded();
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await expect(page.getByText("Session info")).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Session note" })).toBeVisible();

		await page.getByRole("button", { name: "Collapse top band" }).click();
		await expect(page.getByRole("textbox", { name: "Session note" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Expand top band" })).toBeVisible();

		const scrollCheck = await page.evaluate(() => ({
			body: document.body.scrollHeight > document.body.clientHeight,
			root:
				document.documentElement.scrollHeight >
				document.documentElement.clientHeight,
		}));
		expect(scrollCheck.body).toBe(false);
		expect(scrollCheck.root).toBe(false);
	});

	test("returns to the workspace picker from the app menu and keeps the current session when reopening the same repo", async () => {
		await app!.evaluate(({ Menu, BrowserWindow }) => {
			const mainWindow = BrowserWindow.getAllWindows()[0];
			const menu = Menu.getApplicationMenu();
			const workspaceMenu = menu?.items.find((item) => item.label === "Workspace");
			const openWorkspaceItem = workspaceMenu?.submenu?.items.find(
				(item) => item.label === "Open Workspace...",
			);

			if (!openWorkspaceItem) {
				throw new Error("Workspace > Open Workspace... menu item was not found.");
			}

			openWorkspaceItem.click(undefined, mainWindow, undefined);
		});

		await expect(page.getByLabel("Repository path")).toBeVisible();
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		// The xterm title was reset from "codex" to the CWD by Ctrl+L in the first
		// test. Check for any terminal tab to verify the session was restored.
		await expect(
			page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab").first(),
		).toBeVisible();
		await expect(
			page.getByRole("navigation", { name: "Worktree sessions" }).getByRole(
				"button",
				{ name: /feature-a/i },
			),
		).toHaveAttribute("data-selected", "true");
	});

	test("auto-refreshes review data while focused without clicking Refresh review", async () => {
		test.setTimeout(60_000);
		await ensureWorkspaceLoaded();
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });
		// Wait for the initial summary to render before writing the new file.
		await expect(page.getByRole("button", { name: /src\/index\.ts/i })).toBeVisible();

		writeFileSync(
			join(testRepo.worktreePath, "src", "auto-refresh.ts"),
			"export const autoRefresh = true;\n",
		);

		// Simulate a focus regain so the app triggers an immediate refresh.
		// In headless test environments the window may not have native focus,
		// so we drive the blur→focus transition ourselves.
		await page.evaluate(() => {
			window.dispatchEvent(new Event("blur"));
		});
		// Small delay to let React flush the blur state before dispatching focus.
		await page.waitForTimeout(100);
		await page.evaluate(() => {
			window.dispatchEvent(new Event("focus"));
		});

		await expect(
			page.getByRole("button", { name: /src\/auto-refresh\.ts/i }),
		).toBeVisible({ timeout: 30_000 });
	});

	test("shows stale review data when a focused refresh read fails once", async () => {
		await ensureWorkspaceLoaded();
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();
		await page.getByRole("tab", { name: "Changes" }).click({ force: true });
		await expect(page.getByRole("button", { name: /src\/index\.ts/i })).toBeVisible();

		writeFileSync(
			gitFaultsPath,
			JSON.stringify({ readSummaryFailuresRemaining: 1 }),
		);

		await page.getByRole("button", { name: "Refresh review" }).click();
		await expect(page.getByText(/showing last successful result/i)).toBeVisible();
		await expect(page.getByRole("button", { name: /src\/index\.ts/i })).toBeVisible();
	});

	test("right-clicking a .md file shows Preview and opens the markdown modal", async () => {
		await ensureWorkspaceLoaded();

		// Navigate to feature-a — it has a dirty NOTES.md so scopeRoots is non-empty
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		// Switch to Files tab in the review rail
		await page.getByRole("tab", { name: "Files" }).click({ force: true });

		// Wait for NOTES.md to appear (scopeRoots includes "." for root-level dirty files)
		const notesButton = page.getByRole("button", { name: /^NOTES\.md/i });
		await expect(notesButton).toBeVisible({ timeout: 10_000 });

		// Right-click to open context menu
		await notesButton.click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Preview" })).toBeVisible();

		// Click Preview
		await page.getByRole("menuitem", { name: "Preview" }).click();

		// Modal should appear with rendered heading from "# Preview Test"
		await expect(
			page.getByRole("heading", { name: "Preview Test" }),
		).toBeVisible({ timeout: 10_000 });

		// ESC should close the modal
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("heading", { name: "Preview Test" }),
		).not.toBeVisible();
	});

	test("right-clicking a .md file in Changes shows Preview and opens the markdown modal", async () => {
		await ensureWorkspaceLoaded();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await page.getByRole("tab", { name: "Changes" }).click({ force: true });

		const notesButton = page.getByRole("button", { name: /^NOTES\.md/i });
		await expect(notesButton).toBeVisible({ timeout: 10_000 });

		await notesButton.click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Preview" })).toBeVisible();
		await page.getByRole("menuitem", { name: "Preview" }).click();

		await expect(
			page.getByRole("heading", { name: "Preview Test" }),
		).toBeVisible({ timeout: 10_000 });

		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("heading", { name: "Preview Test" }),
		).not.toBeVisible();
	});

	test("right-clicking viewer panel header of a .md file shows Preview and opens the modal", async () => {
		await ensureWorkspaceLoaded();

		// Navigate to feature-a
		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		// Open Files tab and click NOTES.md to load it in the viewer
		await page.getByRole("tab", { name: "Files" }).click({ force: true });
		const notesButton = page.getByRole("button", { name: "NOTES.md", exact: true });
		await expect(notesButton).toBeVisible({ timeout: 10_000 });
		await notesButton.click();

		// Wait for viewer header to show the file path
		const viewerTitle = page.locator(".shell-viewer__title", { hasText: "NOTES.md" });
		await expect(viewerTitle).toBeVisible({ timeout: 10_000 });

		// Right-click the viewer header
		await viewerTitle.click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Preview" })).toBeVisible();

		// Click Preview — modal should open with "# Preview Test" heading
		await page.getByRole("menuitem", { name: "Preview" }).click();
		await expect(
			page.getByRole("heading", { name: "Preview Test" }),
		).toBeVisible({ timeout: 10_000 });

		// ESC closes the modal
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("heading", { name: "Preview Test" }),
		).not.toBeVisible();
	});

	test("right-clicking a markdown file under selected commit previews commit snapshot", async () => {
		await ensureWorkspaceLoaded();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await page.getByRole("tab", { name: "Commits" }).click({ force: true });
		await page.getByRole("button", { name: /initial commit/i }).click();
		const commitButton = page.getByRole("button", { name: /feature commit/i });
		await expect(commitButton).toBeVisible({ timeout: 10_000 });
		await commitButton.click();

		const commitNotesButton = page
			.getByTestId("review-rail")
			.getByRole("button", { name: /^COMMIT_NOTES\.md/i });
		await expect(commitNotesButton).toBeVisible({ timeout: 10_000 });

		await commitNotesButton.click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Preview" })).toBeVisible();
		await page.getByRole("menuitem", { name: "Preview" }).click();

		await expect(
			page.getByRole("heading", { name: "Committed Preview" }),
		).toBeVisible({ timeout: 10_000 });

		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("heading", { name: "Committed Preview" }),
		).not.toBeVisible();
	});

	test("shows two assigned shells side by side and preserves split mode when switching worktrees", async () => {
		test.setTimeout(60_000);
		await ensureWorkspaceLoaded();

		const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
		const terminalTabs = page.getByRole("tablist", { name: "Terminal sessions" });
		await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
		await expect(terminalTabs.getByRole("tab")).toHaveCount(1, { timeout: 15_000 });

		await page.getByRole("button", { name: "Add shell" }).click();
		await expect(terminalTabs.getByRole("tab")).toHaveCount(2, { timeout: 15_000 });

		await page.getByRole("button", { name: "Enable split shells" }).click();
		await expect(page.getByRole("button", { name: "Disable split shells" })).toBeVisible();

		await expect(page.locator('.shell-terminal-pane:not([aria-hidden="true"])')).toHaveCount(2);

		await terminalTabs.getByRole("tab").nth(0).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Show in split left" }).click();

		await terminalTabs.getByRole("tab").nth(1).click({ button: "right" });
		await page.getByRole("menuitem", { name: "Show in split right" }).click();

		await expect(page.getByRole("button", { name: "Disable split shells" })).toBeVisible();
		await expect(page.locator('.shell-terminal-pane:not([aria-hidden="true"])')).toHaveCount(2);

		await worktreeNav.getByRole("button", { name: /^main$/ }).click();
		await expect(page.getByRole("button", { name: "Enable split shells" })).toBeVisible();

		await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
		await expect(page.getByRole("button", { name: "Disable split shells" })).toBeVisible();
		await expect(page.locator('.shell-terminal-pane:not([aria-hidden="true"])')).toHaveCount(2);
	});
});
