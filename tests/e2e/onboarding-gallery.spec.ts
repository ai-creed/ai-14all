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
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ob-gal-ud-")));
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

test("tour card fixture renders with the flat TUI styling and step label", async () => {
	const card = page.locator(
		'[data-testid="gallery-onboarding-tour"] [data-testid="tour-card"]',
	);
	await expect(card).toBeVisible();
	await expect(card).toContainText("Step 1 of 4");
	await expect(card).toContainText("Sessions are isolated");
	// Flat TUI look: monospace type + a solid square border, no rounded bubble.
	await expect(card).toHaveClass(/font-mono/);
	await expect(card).toHaveClass(/border-2/);
	await expect(card).toHaveClass(/tui:rounded-none/);
});

test("coachmark fixture renders with the info glyph and label", async () => {
	const card = page.locator(
		'[data-testid="gallery-onboarding-coachmark"] [data-testid="coachmark"]',
	);
	await expect(card).toBeVisible();
	await expect(card).toContainText("Built-in power tools");
	// The Nerd Font glyph is rendered via the .app-nf span (Icon name="info").
	await expect(card.locator(".app-nf").first()).toBeVisible();
	// Flat TUI look: square corners, no rounded bubble.
	await expect(card).toHaveClass(/tui:rounded-none/);
});
