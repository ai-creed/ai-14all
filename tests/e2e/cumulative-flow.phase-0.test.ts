import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	app = await electron.launch({ args: ["out/main/index.js"] });
	page = await app.firstWindow();
});

test.afterAll(async () => {
	try {
		if (app) await app.close();
	} finally {
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
		await page.getByRole("button", { name: "New terminal" }).click();

		await expect(page.locator(".xterm")).toHaveCount(1, { timeout: 10_000 });
		await expect(
			page.getByRole("tab", {
				name: /^shell 1(?: \((?:error|exited)\))?$/i,
			}),
		).toBeVisible();
	});

	test("runs a shell command inside the selected worktree", async () => {
		const textarea = page.locator(".xterm-helper-textarea");
		await textarea.waitFor({ state: "attached" });
		await textarea.focus();

		await page.keyboard.type("pwd");
		await page.keyboard.press("Enter");

		await expect(
			page.locator(".xterm-accessibility-tree").first(),
		).toContainText(testRepo.repoPath, { timeout: 10_000 });
	});

	test("opens a file in the embedded viewer", async () => {
		await page
			.getByRole("button", { name: "src/index.ts", exact: true })
			.click({ force: true });

		await expect(page.locator(".monaco-editor")).toBeVisible({
			timeout: 15_000,
		});
	});
});
