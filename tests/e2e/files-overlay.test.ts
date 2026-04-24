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
import {
	openFilesOverlayViaChipBar,
	openFilesOverlayViaShortcut,
	closeFilesOverlay,
} from "./helpers/files-overlay";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

async function ensureWorkspaceLoaded(): Promise<void> {
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
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
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-files-overlay-")),
	);
	const workspaceStatePath = join(persistedStateDir, "workspace-state.json");
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
	await ensureWorkspaceLoaded();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test.describe.serial("Files overlay", () => {
	test("opens via chip bar Files button and closes via Esc", async () => {
		test.setTimeout(30_000);
		await openFilesOverlayViaChipBar(page);
		await closeFilesOverlay(page);
	});

	test("opens via Cmd+P / Ctrl+Shift+P shortcut", async () => {
		test.setTimeout(30_000);
		await openFilesOverlayViaShortcut(page);
		await closeFilesOverlay(page);
	});

	test("search narrows the list", async () => {
		test.setTimeout(30_000);
		await openFilesOverlayViaChipBar(page);
		const search = page.getByTestId("files-overlay-search");
		await search.fill("inde");
		await expect(
			page.locator(".shell-files-overlay__row-basename", {
				hasText: "index.ts",
			}),
		).toBeVisible();
		await expect(page.getByText("README.md")).toHaveCount(0);
		await closeFilesOverlay(page);
	});

	test("Enter selects a file and opens the review drawer on the Files tab", async () => {
		test.setTimeout(30_000);
		await openFilesOverlayViaChipBar(page);
		await page.getByTestId("files-overlay-search").fill("index");
		// Wait for the file list to load before pressing Enter (async trackedFilesLoader)
		await expect(
			page.locator(".shell-files-overlay__row-basename").first(),
		).toBeVisible({ timeout: 10_000 });
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("files-overlay")).toHaveCount(0);
		const drawer = page.getByRole("region", { name: "Review" });
		await expect(drawer).toHaveAttribute("data-open", "true");
		await expect(page.getByRole("tab", { name: /files/i })).toHaveAttribute(
			"data-state",
			"active",
		);
	});

	test("pointer click selects a file and closes the overlay", async () => {
		test.setTimeout(30_000);
		await openFilesOverlayViaChipBar(page);
		// Scope to the overlay to avoid matching the file tree behind the backdrop (async load)
		await page
			.locator(
				"[data-testid='files-overlay'] .shell-files-overlay__row-basename",
				{ hasText: "README.md" },
			)
			.click();
		await expect(page.getByTestId("files-overlay")).toHaveCount(0);
		await expect(page.getByRole("region", { name: "Review" })).toHaveAttribute(
			"data-open",
			"true",
		);
	});

	test("Esc closes the overlay; chip-bar Files button remains accessible", async () => {
		test.setTimeout(30_000);
		const trigger = page.getByRole("button", { name: /open files/i });
		await trigger.click();
		await expect(page.getByTestId("files-overlay")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("files-overlay")).toHaveCount(0);
		// Verify the trigger is still visible and clickable after close
		await expect(trigger).toBeVisible();
		await expect(trigger).toBeEnabled();
	});
});
