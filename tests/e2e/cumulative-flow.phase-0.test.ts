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

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase0-")));
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

test.describe.serial("Cumulative flow — Phase 0", () => {
	const worktreeNav = () =>
		page.getByRole("navigation", { name: "Sessions" });

	test("loads a repository and shows worktree sessions", async () => {
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await expect(
			worktreeNav().getByRole("button", { name: / main$/i }),
		).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			worktreeNav().getByRole("button", { name: /feature-a/i }),
		).toBeVisible();
	});

	test("selects a worktree and opens a terminal", async () => {
		await worktreeNav()
			.getByRole("button", { name: / main$/i })
			.click();

		// Phase 6: a default shell is automatically created when a worktree is
		// activated.  Wait for it instead of clicking "+ Shell".
		await expect(
			page
				.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
				.first(),
		).toBeVisible({ timeout: 10_000 });
		await expect(page.locator(".xterm")).toHaveCount(1, { timeout: 10_000 });

		const terminalSection = page.locator(".shell-terminal-section");
		await expect(terminalSection).toBeVisible();
		const box = await terminalSection.boundingBox();
		expect(box).not.toBeNull();
		// Phase 6: the terminal section shares space with the review panel.
		expect(box!.height).toBeGreaterThan(0);
	});

	test("runs a shell command inside the selected worktree", async () => {
		const textarea = page.locator(".xterm-helper-textarea");
		await textarea.waitFor({ state: "attached" });
		await textarea.focus();

		await page.keyboard.type("echo phase-0");
		await page.keyboard.press("Enter");

		await expect(
			page.locator(".xterm-accessibility-tree").first(),
		).toContainText("phase-0", { timeout: 10_000 });
	});

	test("opens a file in the embedded viewer", async () => {
		// Phase 6: ensure the Files tab is active and the file list has rendered
		// before attempting the click. The explicit tab click also ensures the
		// review panel is the active tab so the viewer updates on file selection.
		await ensureReviewOverlayOpen(page);
		await page.getByRole("tab", { name: "Files" }).click({ force: true });
		await expect(
			page.getByRole("button", { name: "src", exact: true }),
		).toBeVisible();
		// Expand src directory so index.ts becomes visible.
		await page
			.getByRole("button", { name: "src", exact: true })
			.click({ force: true });
		// Phase 6: force the click because the xterm pane in the same column
		// keeps the accessibility tree in flux, causing Playwright's stability
		// check to time out even when the button is at its correct position.
		await page
			.getByRole("button", { name: "index.ts", exact: true })
			.click({ force: true });

		await expect(page.locator(".monaco-editor")).toBeVisible({
			timeout: 15_000,
		});
	});
});
