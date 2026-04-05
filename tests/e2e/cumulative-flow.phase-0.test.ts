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
			ONEFORALL_E2E: "1",
			ONEFORALL_WORKSPACE_STATE_PATH: join(persistedStateDir, "workspace-state.json"),
		},
	});
	page = await app.firstWindow();
});

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
		page.getByRole("navigation", { name: "Worktree sessions" });

	test("loads a repository and shows worktree sessions", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await expect(
			worktreeNav().getByRole("button", { name: /^main(?:\s+main)?$/i }),
		).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			worktreeNav().getByRole("button", { name: /feature-a/i }),
		).toBeVisible();
	});

	test("selects a worktree and opens a terminal", async () => {
		await worktreeNav()
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		// Phase 6: a default shell is automatically created when a worktree is
		// activated.  Wait for it instead of clicking "+ Shell".
		await expect(
			page.getByRole("tab", {
				name: /^shell 1(?: \((?:error|exited)\))?$/i,
			}),
		).toBeVisible({ timeout: 10_000 });
		await expect(page.locator(".xterm")).toHaveCount(1, { timeout: 10_000 });

		const terminalSection = page.locator(".shell-terminal-section");
		await expect(terminalSection).toBeVisible();
		const box = await terminalSection.boundingBox();
		expect(box).not.toBeNull();
		// Phase 6: the terminal section is now fluid (min-height 520px) rather
		// than the old fixed 720px.  Assert it is at least the minimum height.
		expect(box!.height).toBeGreaterThanOrEqual(520);
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
		await page.getByRole("tab", { name: "Files" }).click({ force: true });
		await expect(page.getByText("src", { exact: true })).toBeVisible();
		// Phase 6: force the click because the xterm pane in the same column
		// keeps the accessibility tree in flux, causing Playwright's stability
		// check to time out even when the button is at its correct position.
		await page.getByRole("button", { name: "index.ts", exact: true }).click({ force: true });

		await expect(page.locator(".monaco-editor")).toBeVisible({
			timeout: 15_000,
		});
	});
});
