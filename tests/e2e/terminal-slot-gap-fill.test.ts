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

// Regression for: closing a NON-last shell must never orphan a later shell's
// running process. Closing a shell now auto-reorganizes the layout — it shrinks
// to a smaller layout and compacts survivors forward (no empty slot left
// behind). This drives that close path end-to-end and asserts the later shell's
// process survives, packed forward into the freed slot rather than killed.
// (The in-place gap-fill path for restored/oversized layouts is covered by the
// terminal-layout-reducer unit tests.)

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
	// This suite's subject is layout reorganization, not confirmation — that
	// behavior is covered by terminal-slot-chrome.spec.ts (terminal-ux-hardening
	// spec). Disable both confirm prefs so restart/close flows below stay
	// unmodified instead of parking a modal ConfirmDialog.
	await page.evaluate(() =>
		(
			window as never as {
				ai14all: { settings: { write: (p: unknown) => Promise<unknown> } };
			}
		).ai14all.settings.write({
			terminalConfirm: { restart: false, close: false },
		}),
	);
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
});

test("closing a middle shell reorganizes and keeps the later shell alive", async () => {
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

	// Close the MIDDLE shell (slot 1). Auto-reorganize shrinks 3-v -> 2-v and
	// compacts survivors forward: the later shell moves from slot 2 into slot 1,
	// with no empty slot or CTA left behind.
	await page.getByTestId("slot-close-1").click();
	await expect(page.getByTestId("slot-1")).toBeVisible();
	await expect(page.getByTestId("slot-2")).toHaveCount(0);
	await expect(page.getByTestId("slot-cta-1")).toHaveCount(0);

	// The later shell must NOT have been killed/overwritten: its process is now
	// packed forward into slot 1, still alive with the same id.
	await expect(page.getByTestId("slot-1")).toHaveAttribute(
		"data-process-id",
		laterId!,
	);
});
