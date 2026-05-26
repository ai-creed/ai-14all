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

// Regression for: adding a shell into a slot left empty by closing a NON-last
// shell killed a later shell (its running process was orphaned). The in-grid
// "+ start a shell" CTA dispatches session/placeProcessInNewSlot, which
// compacted the slot model before placing — shifting a later shell into the
// target index and overwriting it. This drives the real CTA path end-to-end.

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

async function ensureWorkspaceLoaded(): Promise<void> {
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	if (await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false))
		return;
	const repoInput = page.locator("#repo-path");
	await expect(repoInput).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(repoInput).toHaveValue(testRepo.repoPath);
	await repoInput.press("Enter");
	await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
	await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-slot-gap-")),
	);
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
	await page.waitForFunction(() => "ai14all" in window, null, {
		timeout: 30_000,
	});
	await ensureWorkspaceLoaded();
	await expect(page.getByTestId("slot-0")).toBeVisible({ timeout: 20_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test("filling a gap from a closed middle shell keeps the later shell alive", async () => {
	test.setTimeout(90_000);

	// 3 equal columns; fill all three slots.
	await page.getByTestId("terminal-layout-button").click();
	await expect(page.getByTestId("terminal-layout-dialog")).toBeVisible();
	await page.getByTestId("layout-tile-3-v").click();
	await page.getByTestId("slot-cta-1").click();
	await expect(page.getByTestId("slot-1")).toBeVisible();
	await page.getByTestId("slot-cta-2").click();
	await expect(page.getByTestId("slot-2")).toBeVisible();

	// Record the LATER shell (slot 2) identity — it must survive untouched.
	const laterId = await page
		.getByTestId("slot-2")
		.getAttribute("data-process-id");
	expect(laterId).toBeTruthy();

	// Close the MIDDLE shell (slot 1) -> leaves an empty slot with a CTA.
	await page.getByTestId("slot-close-1").click();
	await expect(page.getByTestId("slot-cta-1")).toBeVisible();
	// The later shell is still in slot 2 at this point.
	await expect(page.getByTestId("slot-2")).toHaveAttribute(
		"data-process-id",
		laterId!,
	);

	// Fill the gap via the in-grid CTA.
	await page.getByTestId("slot-cta-1").click();
	await expect(page.getByTestId("slot-1")).toBeVisible();

	// The later shell must NOT have been killed/overwritten: slot 2 still holds
	// the same process, and the new shell occupies slot 1 with a different id.
	await expect(page.getByTestId("slot-2")).toHaveAttribute(
		"data-process-id",
		laterId!,
	);
	const newId = await page
		.getByTestId("slot-1")
		.getAttribute("data-process-id");
	expect(newId).toBeTruthy();
	expect(newId).not.toBe(laterId);
});
