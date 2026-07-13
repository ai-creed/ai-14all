import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

interface Harness {
	app: ElectronApplication;
	page: Page;
	testRepo: TestRepo;
	persistedStateDir: string;
}

async function launch(extraEnv: Record<string, string>): Promise<Harness> {
	const testRepo = createTestRepo();
	const persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-update-")),
	);
	const app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(
				persistedStateDir,
				"workspace-state.json",
			),
			...extraEnv,
		},
	});
	const page = await app.firstWindow({ timeout: 60_000 });

	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	if (!(await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false))) {
		const repoInput = page.locator("#repo-path");
		await expect(repoInput).toBeVisible({ timeout: 15_000 });
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(repoInput).toHaveValue(testRepo.repoPath);
		await repoInput.press("Enter");
		await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
	}
	return { app, page, testRepo, persistedStateDir };
}

async function teardown(h: Harness): Promise<void> {
	try {
		await closeApp(h.app);
	} finally {
		rmSync(h.persistedStateDir, { recursive: true, force: true });
		h.testRepo.cleanup();
	}
}

test.describe("downloaded update shows Restart now / Later", () => {
	let h: Harness;

	test.beforeAll(async () => {
		h = await launch({
			AI14ALL_E2E_UPDATE_DOWNLOADED: "1",
			AI14ALL_E2E_UPDATE_VERSION: "99.0.0",
		});
	}, 90_000);

	test.afterAll(async () => {
		await teardown(h);
	});

	test("banner shows the downloaded version with a Restart now button", async () => {
		// Scoped locator: role=status is ambiguous when the install-gap banner is present.
		await expect(h.page.locator(".update-banner")).toBeVisible({
			timeout: 15_000,
		});
		await expect(h.page.locator(".update-banner")).toContainText("99.0.0");
		await expect(
			h.page.getByRole("button", { name: /restart now/i }),
		).toBeVisible();
	});

	test("clicking Restart now invokes update:install in the main process", async () => {
		await h.page.getByRole("button", { name: /restart now/i }).click();
		await expect
			.poll(() =>
				h.app.evaluate(() => {
					type Capture = { __AI14ALL_E2E_INSTALL_CALLS__?: number };
					return (globalThis as Capture).__AI14ALL_E2E_INSTALL_CALLS__ ?? 0;
				}),
			)
			.toBeGreaterThan(0);
	});
});

test.describe("Later dismisses the restart prompt for the session", () => {
	let h: Harness;

	test.beforeAll(async () => {
		h = await launch({
			AI14ALL_E2E_UPDATE_DOWNLOADED: "1",
			AI14ALL_E2E_UPDATE_VERSION: "99.0.0",
		});
	}, 90_000);

	test.afterAll(async () => {
		await teardown(h);
	});

	test("Later hides the banner", async () => {
		await expect(h.page.locator(".update-banner")).toBeVisible({
			timeout: 15_000,
		});
		await h.page.getByRole("button", { name: /later/i }).click();
		await expect(h.page.locator(".update-banner")).toBeHidden();
	});
});
