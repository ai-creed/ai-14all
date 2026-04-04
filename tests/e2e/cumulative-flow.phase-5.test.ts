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

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;

async function launchApp() {
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			ONEFORALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow();
}

async function closeApp() {
	if (app) {
		await app.close();
		app = undefined;
	}
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase5-")));
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	await launchApp();
});

test.afterAll(async () => {
	try {
		await closeApp();
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 5", () => {
	// Each test in this suite launches the Electron app at least once and
	// may launch it twice; 60 s gives ample headroom for slower CI machines.
	test.setTimeout(60_000);

	test("restores the selected session and lazily hydrates another saved worktree", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await page.getByRole("button", { name: "+ Shell" }).click();
		await page.getByLabel("Session note").fill("resume here");
		await page.getByRole("tab", { name: "Changes" }).click();
		await page.getByRole("button", { name: /src\/index\.ts/ }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }) // partial match, accessible name is "main main"
			.click();
		await page.getByRole("button", { name: "+ Shell" }).click();

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		await closeApp();
		await launchApp();

		await page.getByRole("button", { name: "Restore previous workspace" }).click();

		await expect(
			page.getByRole("navigation", { name: "Worktree sessions" }).getByRole("button", {
				name: /feature-a/i,
			}),
		).toHaveAttribute("data-selected", "true");
		await expect(page.getByLabel("Session note")).toHaveValue("resume here");
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();
		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();

		// The main session's shell has not been hydrated yet — TerminalTabs
		// only renders the active session's tabs, so there is no tab labelled
		// "shell 1" belonging to main while feature-a is selected.  The only
		// "shell 1" in the DOM is the feature-a tab we just checked above.
		// Verify there is exactly one shell tab while feature-a is active.
		await expect(page.getByRole("tab", { name: /^shell \d/ })).toHaveCount(1);

		await page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }) // partial match
			.click();

		// After lazy hydration of the main session its shell tab becomes visible.
		// The main worktree's ad-hoc counter starts at 1, so the tab is "shell 1".
		await expect(page.getByRole("tab", { name: "shell 1" })).toBeVisible();
	});

	test("remembers a start-clean choice when asked", async () => {
		await closeApp();
		await launchApp();

		await page.getByLabel("Remember my choice").check();
		await page.getByRole("button", { name: "Start clean" }).click();

		await expect(
			page.getByRole("button", { name: "Load" }),
		).toBeVisible();

		await closeApp();
		await launchApp();

		await expect(
			page.getByRole("button", { name: "Restore previous workspace" }),
		).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Load" })).toBeVisible();
	});
});
