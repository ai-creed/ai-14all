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
let workspaceStatePath: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase6-")));
	workspaceStatePath = join(persistedStateDir, "workspace-state.json");
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_WORKSPACE_STATE_PATH: workspaceStatePath,
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

test.describe.serial("Cumulative flow — Phase 6", () => {
	test("shows a default shell, opens a terminal tab context menu, and reviews a recent commit", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page.getByRole("tab", { name: "Commits" }).click();
		await expect(page.getByRole("button", { name: "Refresh review" })).toBeVisible();
		await expect(page.getByText("origin/main")).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: /initial commit/i }),
		).toBeVisible();
		await expect(
			page.getByText("No recent commits to review."),
		).toHaveCount(0);

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
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
		await expect(
			page.getByTestId("review-rail").getByRole("tablist", { name: "Review mode" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Refresh review" })).toBeVisible();

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

		await page.getByRole("tab", { name: /^codex$/i }).click({ button: "right" });
		await expect(page.getByRole("menuitem", { name: "Pin" })).toBeVisible();
		await page.keyboard.press("Escape");

		await page.getByRole("tab", { name: "Commits" }).click();
		await expect(page.getByRole("button", { name: "Refresh review" })).toBeVisible();
		await expect(page.getByText("origin/main")).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: /feature commit/i }),
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

		const loadButton = page.getByRole("button", { name: "Load" });
		if (await loadButton.isVisible()) {
			await page.locator("#repo-path").fill(testRepo.repoPath);
			await loadButton.click();
			await page
				.getByRole("navigation", { name: "Worktree sessions" })
				.getByRole("button", { name: /feature-a/i })
				.click();
		}

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
});
