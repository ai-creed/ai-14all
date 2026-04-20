import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStatePath: string;

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-rename-")));
	persistedStatePath = join(stateDir, "workspace-state.json");

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		worktreeNav().getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		const stateDir = persistedStatePath.replace(/\/[^/]+$/, "");
		rmSync(stateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test("renames a session via F2 and persists the title after restart", async () => {
	test.setTimeout(60_000);

	const sessionButton = worktreeNav().getByRole("button", { name: /main/i });
	await sessionButton.click();
	await expect(
		page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab").first(),
	).toBeVisible({ timeout: 15_000 });

	// Focus the session button and press F2 to start inline rename
	await sessionButton.focus();
	await page.keyboard.press("F2");
	const renameInput = page.getByRole("textbox", { name: "Rename session" });
	await expect(renameInput).toBeVisible({ timeout: 5_000 });
	await renameInput.fill("My Custom Title");
	await renameInput.press("Enter");

	// Sidebar button should now reflect the custom title
	await expect(
		worktreeNav().getByRole("button", { name: /My Custom Title/i }),
	).toBeVisible({ timeout: 5_000 });

	// Persisted state must include the title
	const saved = JSON.parse(readFileSync(persistedStatePath, "utf8")) as {
		workspaces: { snapshot: { worktreeSessions: Array<{ title: string }> } }[];
	};
	const sessions = saved.workspaces[0]?.snapshot?.worktreeSessions ?? [];
	expect(sessions.some((s) => s.title === "My Custom Title")).toBe(true);
});

test("clears the custom title when rename is submitted empty", async () => {
	test.setTimeout(30_000);

	const sessionButton = worktreeNav().getByRole("button", { name: /My Custom Title/i });
	await sessionButton.focus();
	await page.keyboard.press("F2");
	const renameInput = page.getByRole("textbox", { name: "Rename session" });
	await expect(renameInput).toBeVisible({ timeout: 5_000 });
	await renameInput.fill("");
	await renameInput.press("Enter");

	// Falls back to worktree label (branch name)
	await expect(
		worktreeNav().getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 5_000 });
	await expect(
		worktreeNav().getByRole("button", { name: /My Custom Title/i }),
	).not.toBeVisible();
});
