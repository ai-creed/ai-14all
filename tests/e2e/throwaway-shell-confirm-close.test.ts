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

// Reproduction spec for docs/bugreports/bug-throwaway-shell-confirm-close-stuck.md:
// with "confirm before closing a shell" ENABLED, confirming the "Close shell?"
// dialog must actually close the floating throwaway shell. The main
// throwaway-shell.test.ts suite deliberately disables both confirm settings in
// its beforeAll, so this path had no e2e coverage — this spec keeps the close
// confirmation ON.
//
// Harness shape mirrors throwaway-shell.test.ts (Electron launch, test repo +
// feature-a worktree, auto-created default shell in slot 0).

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;

const MAC = process.platform === "darwin";
const NEW_FLOATING = MAC ? "Meta+Shift+T" : "Control+Shift+T";

const popover = () => page.getByTestId("floating-shell-popover");
const confirmDialog = () => page.getByTestId("confirm-dialog");
const allPills = () =>
	page.locator(
		'[data-testid^="floating-shell-pill-"]:not([data-testid^="floating-shell-pill-close-"])',
	);

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
	await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
}

async function spawnFloatingShell(): Promise<void> {
	const before = await allPills().count();
	await page.keyboard.press(NEW_FLOATING);
	await expect(popover()).toBeVisible({ timeout: 10_000 });
	await expect(allPills()).toHaveCount(before + 1, { timeout: 10_000 });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-throwaway-confirm-")),
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
	await page.waitForFunction(() => "ai14all" in window, null, {
		timeout: 30_000,
	});
	await ensureWorkspaceLoaded();
	await expect(page.getByTestId("slot-0")).toBeVisible({ timeout: 20_000 });
	// The subject of this spec IS the close confirmation: keep close ON
	// (restart stays off — it is not under test and would park extra modals).
	await page.evaluate(() =>
		(
			window as never as {
				ai14all: { settings: { write: (p: unknown) => Promise<unknown> } };
			}
		).ai14all.settings.write({
			terminalConfirm: { restart: false, close: true },
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

test.describe.serial("Throwaway shell close confirmation", () => {
	test("confirming the Close shell? dialog kills the floating shell", async () => {
		test.setTimeout(90_000);
		await spawnFloatingShell();

		// Kill from the popover header: with terminalConfirm.close enabled and a
		// running shell process this must park the confirmation dialog.
		await page.getByTestId("floating-shell-close").click();
		await expect(confirmDialog()).toBeVisible({ timeout: 10_000 });

		// Confirm. Designed behavior (spec §5.4): the running process is killed
		// and the floating shell is fully dismissed — no popover, no pill, no
		// stuck shell left behind.
		await page.getByTestId("confirm-dialog-confirm").click();
		await expect(confirmDialog()).toHaveCount(0, { timeout: 10_000 });
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });
	});

	test("after a confirmed close, a fresh shell still closes directly when the pref is off", async () => {
		test.setTimeout(90_000);
		// Guard against the reported "stuck" aftermath wedging later closes:
		// disable the confirmation and verify the ungated path still works.
		await page.evaluate(() =>
			(
				window as never as {
					ai14all: { settings: { write: (p: unknown) => Promise<unknown> } };
				}
			).ai14all.settings.write({
				terminalConfirm: { restart: false, close: false },
			}),
		);
		await spawnFloatingShell();
		await page.getByTestId("floating-shell-close").click();
		await expect(popover()).toHaveCount(0, { timeout: 10_000 });
		await expect(allPills()).toHaveCount(0, { timeout: 10_000 });
	});
});
