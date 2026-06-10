import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

/**
 * Captures the #/ui-gallery primitive gallery per theme into
 * tests/__screenshots__/ for visual review of theme PRs
 * (docs/tui-css-spec.md §10.2). Not an assertion suite — it exists to
 * produce before/after PNGs, so keep it filterable:
 *
 *   pnpm build && pnpm exec playwright test ui-gallery
 */
const PALETTES = ["dark", "light", "warm", "tui"] as const;
const OUT_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"__screenshots__",
);

let app: ElectronApplication;
let page: Page;
let testRepo: TestRepo;

test.beforeAll(async () => {
	mkdirSync(OUT_DIR, { recursive: true });
	testRepo = createTestRepo();
	const persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-gallery-")),
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
	// The gallery gate in main.tsx only checks the hash at load, so set it
	// and reload (safe in a production build — no HMR guard).
	await page.evaluate(() => {
		window.location.hash = "#/ui-gallery";
		window.location.reload();
	});
	await expect(page.getByTestId("ui-gallery")).toBeVisible({
		timeout: 30_000,
	});
});

test.afterAll(async () => {
	await closeApp(app);
	testRepo?.cleanup();
});

for (const palette of PALETTES) {
	test(`capture ${palette} gallery`, async () => {
		await page.getByTestId(`gallery-theme-${palette}`).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", palette);
		// Let theme-driven repaints (fonts, scrollbars) settle.
		await page.waitForTimeout(200);

		await page.screenshot({
			path: join(OUT_DIR, `ui-gallery-${palette}.png`),
			fullPage: true,
		});

		await page.getByTestId("gallery-open-dialog").click();
		await expect(page.getByTestId("gallery-dialog-content")).toBeVisible();
		await page.screenshot({
			path: join(OUT_DIR, `ui-gallery-${palette}-dialog.png`),
		});
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("gallery-dialog-content")).toHaveCount(0);

		await page.getByTestId("gallery-open-dropdown").click();
		await expect(page.getByTestId("gallery-dropdown-content")).toBeVisible();
		await page.screenshot({
			path: join(OUT_DIR, `ui-gallery-${palette}-dropdown.png`),
		});
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("gallery-dropdown-content")).toHaveCount(0);

		await page.getByTestId("gallery-context-target").click({ button: "right" });
		await expect(page.getByTestId("gallery-context-content")).toBeVisible();
		await page.screenshot({
			path: join(OUT_DIR, `ui-gallery-${palette}-context.png`),
		});
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("gallery-context-content")).toHaveCount(0);
	});
}
