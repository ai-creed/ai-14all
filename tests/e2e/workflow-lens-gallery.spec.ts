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

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let userDataDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-wflens-ud-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.evaluate(() => {
		window.location.hash = "#/ui-gallery";
	});
	await page.reload();
	// Route ships in this repo — required, not skippable.
	await expect(page.locator('[data-testid="ui-gallery"]')).toBeVisible({
		timeout: 15_000,
	});
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test("workflow lens shows the explicit status word in the dot's tier color", async () => {
	const lens = page.locator('[data-testid="gallery-workflow-lens"]');
	await expect(lens).toBeVisible();

	// The explicit status word renders for each state ('done' reads as
	// 'completed'; escalation outranks the raw status).
	await expect(lens.getByText("running", { exact: true })).toBeVisible();
	await expect(lens.getByText("completed", { exact: true })).toBeVisible();
	await expect(lens.getByText("halted", { exact: true })).toBeVisible();
	await expect(lens.getByText("escalated", { exact: true })).toBeVisible();

	// Word + dot share one colored element, so the label matches the dot tier.
	const done = lens.locator('.workflow-row__status[data-status="done"]');
	await expect(done).toHaveAttribute("data-tier", "ready");
	await expect(done.locator(".workflow-row__status-label")).toHaveText(
		"completed",
	);

	const halted = lens.locator('.workflow-row__status[data-status="halted"]');
	await expect(halted).toHaveAttribute("data-tier", "actionRequired");
});
