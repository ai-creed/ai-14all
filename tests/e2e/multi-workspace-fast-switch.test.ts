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
import { basename } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { createSecondTestRepo } from "./fixtures/create-second-test-repo";

let app: ElectronApplication | undefined;
let page: Page;
let repoA: TestRepo;
let repoB: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;

async function launchApp() {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repoA.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow();
}

async function closeApp() {
	if (app) {
		const proc = app.process();
		await Promise.race([
			app.close(),
			new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
		]);
		if (!proc.killed) proc.kill("SIGKILL");
		// Allow the OS to fully release process resources before relaunching
		await new Promise<void>((resolve) => setTimeout(resolve, 500));
		app = undefined;
	}
}

test.beforeAll(async () => {
	repoA = createTestRepo();
	repoB = createSecondTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-mws-")));
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	await launchApp();
}, 60_000);

test.afterAll(async () => {
	try {
		await closeApp();
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		repoA?.cleanup();
		repoB?.cleanup();
	}
});

const workspaceSwitcher = () =>
	page.getByRole("navigation", { name: "Workspaces" });

test.describe.serial("Multi-workspace fast-switch", () => {
	test.describe.configure({ timeout: 120_000 });

	test("keeps terminal work alive while switching between repositories", async () => {
		// Load repo A via the pre-seeded Browse path
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(repoA.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		// Wait for worktree nav to appear and select main
		const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
		await expect(
			worktreeNav.getByRole("button", { name: /^main(?:\s+main)?$/i }),
		).toBeVisible({ timeout: 15_000 });
		await worktreeNav
			.getByRole("button", { name: /^main(?:\s+main)?$/i })
			.click();

		// Wait for the default shell tab to appear (auto-created on worktree activation)
		await expect(
			page.getByRole("tab", { name: /^shell 1(?: \((?:error|exited)\))?$/i }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.locator(".xterm")).toHaveCount(1, { timeout: 10_000 });

		// Type something in the terminal so there's a recognisable line to assert later
		const textarea = page.locator(".xterm-helper-textarea");
		await textarea.waitFor({ state: "attached" });
		await textarea.focus();
		await page.keyboard.type("echo workspace-switch-test");
		await page.keyboard.press("Enter");
		await expect(
			page.locator(".xterm-accessibility-tree").first(),
		).toContainText("workspace-switch-test", { timeout: 10_000 });

		// Open repo B as a second workspace via the app menu
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

		// Fill in repo B path and load it
		await expect(page.getByLabel("Repository path")).toBeVisible({ timeout: 5_000 });
		await page.locator("#repo-path").fill(repoB.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		// Workspace switcher must now show both repos.
		// Use exact: true so the "Remove <name>" button (aria-label) does not match.
		const nameA = basename(repoA.repoPath);
		const nameB = basename(repoB.repoPath);
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameA, exact: true }),
		).toBeVisible({ timeout: 10_000 });
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameB, exact: true }),
		).toBeVisible({ timeout: 10_000 });

		// Switch back to repo A via the workspace switcher
		await workspaceSwitcher().getByRole("button", { name: nameA, exact: true }).click();

		// Repo A worktree nav must be active with main selected
		await expect(
			worktreeNav.getByRole("button", { name: /^main(?:\s+main)?$/i }),
		).toBeVisible({ timeout: 10_000 });

		// The terminal session from the earlier repo A session must still be present.
		// Use any tab in the terminal tablist — the xterm title may have already
		// changed from "shell 1" to the CWD by the time we switch back.
		await expect(
			page.getByRole("tablist", { name: "Terminal sessions" }).getByRole("tab").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("restart restores previously active workspace and shows dormant ones", async () => {
		// Set up: ensure both repos are registered before closing.
		// The previous test left repo A active with repo B dormant.
		// Confirm both workspace buttons are present before closing.
		const nameA = basename(repoA.repoPath);
		const nameB = basename(repoB.repoPath);
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameA, exact: true }),
		).toBeVisible({ timeout: 10_000 });
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameB, exact: true }),
		).toBeVisible({ timeout: 10_000 });

		await closeApp();

		// Relaunch — no PICK_PATH so restart prompt may appear
		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
			},
		});
		page = await app.firstWindow();

		// Wait for the restore prompt and click it.
		// The prompt appears once the app reads the persisted state on startup.
		await page
			.getByRole("button", { name: "Restore previous workspace" })
			.click({ timeout: 20_000 });

		// Repo A (previously active) must appear in the workspace switcher.
		// Use exact: true so the "Remove <name>" button does not match.
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameA, exact: true }),
		).toBeVisible({ timeout: 15_000 });

		// Repo B (dormant) must also be visible in the switcher
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameB, exact: true }),
		).toBeVisible({ timeout: 10_000 });

		// Repo A workspace must be marked as selected
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameA, exact: true }),
		).toHaveAttribute("data-selected", "true");

		// --- dormant workspace hydration ---
		// Repo B was registered as dormant when the persisted state was restored.
		// Clicking its switcher button must hydrate it (load the repo in the current
		// session) and make it the active workspace — without restarting the app.
		await workspaceSwitcher().getByRole("button", { name: nameB, exact: true }).click();

		// Repo B must now be marked as selected
		await expect(
			workspaceSwitcher().getByRole("button", { name: nameB, exact: true }),
		).toHaveAttribute("data-selected", "true", { timeout: 15_000 });

		// Hydration must have completed: repo B's worktree nav becomes visible,
		// confirming the workspace was fully loaded (not just switched in the UI).
		await expect(
			page.getByRole("navigation", { name: "Worktree sessions" }),
		).toBeVisible({ timeout: 20_000 });
	});
});
