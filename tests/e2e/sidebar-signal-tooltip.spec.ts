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
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-signal-ud-")));
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

test("actionRequired signal shows a VISIBLE glyph/shape + label, not color alone", async () => {
	const signal = page.locator(
		'[data-testid="gallery-needs-you"] [data-testid="row-needs-you"]',
	);
	await expect(signal).toBeVisible();
	await expect(signal).toHaveText(/needs you/i);
	await expect(signal).toHaveAttribute("aria-label", "Needs your attention");
	// The distinct Nerd Font glyph/shape is actually rendered and visible.
	await expect(signal.locator(".app-nf").first()).toBeVisible();
});

test("truncated branch/path and task rows expose full text via Radix tooltip", async () => {
	await page.locator('[data-testid="gallery-branch"]').hover();
	await expect(page.getByRole("tooltip")).toContainText(
		"feature/very-long-branch-name-that-is-truncated",
	);

	// Move away, then hover the task row.
	await page.locator('[data-testid="gallery-sidebar"]').hover({
		position: { x: 0, y: 0 },
	});
	await page.locator('[data-testid="gallery-task-row"]').hover();
	await expect(page.getByRole("tooltip")).toContainText(
		"Refine demo recording hygiene — awaiting approval",
	);
});
