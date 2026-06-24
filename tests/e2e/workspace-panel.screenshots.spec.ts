import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

/**
 * Captures the reworked Workspace sidebar (nav[aria-label="Worktree sessions"])
 * per theme (dark, light, warm, tui) to lock the visual result of the
 * Workspace Panel Rework branch. Writes PNGs to tests/__screenshots__/.
 *
 * Run to create baselines:
 *   pnpm test:e2e -- workspace-panel.screenshots --update-snapshots
 * Run to verify stable:
 *   pnpm test:e2e -- workspace-panel.screenshots
 */

const PALETTES = ["dark", "light", "warm", "tui"] as const;
type Palette = (typeof PALETTES)[number];

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
	const stateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-workspace-panel-")),
	);
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });

	// AI14ALL_E2E_PICK_PATH fills the repo path field automatically (the
	// "Browse" button seeds it), but the user still needs to click "Load".
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	// Wait for the sidebar to be present and populated with at least one
	// worktree item before we start taking screenshots.
	const sidebar = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(sidebar).toBeVisible({ timeout: 30_000 });
	// Wait for worktree items to appear (the test repo has main + feature-a).
	await expect(sidebar.locator(".shell-sidebar__item").first()).toBeVisible({
		timeout: 15_000,
	});
});

test.afterAll(async () => {
	await closeApp(app);
	testRepo?.cleanup();
});

async function setTheme(palette: Palette): Promise<void> {
	await page.evaluate(
		(t) => document.documentElement.setAttribute("data-theme", t),
		palette,
	);
	await expect(page.locator("html")).toHaveAttribute("data-theme", palette);
	// Allow theme-driven repaints (CSS custom properties, Nerd Font glyphs) to
	// settle before capturing.
	await page.waitForTimeout(200);
}

for (const palette of PALETTES) {
	test(`workspace panel — ${palette} — expanded`, async () => {
		await setTheme(palette);

		const sidebar = page.getByRole("navigation", { name: "Worktree sessions" });
		await expect(sidebar).toBeVisible();

		// Ensure the panel is expanded (data-collapsed="false").
		const isCollapsed = await sidebar.evaluate(
			(el) => el.getAttribute("data-collapsed") === "true",
		);
		if (isCollapsed) {
			await page.getByRole("button", { name: "Expand sidebar" }).click();
			await expect(sidebar).toHaveAttribute("data-collapsed", "false");
			await page.waitForTimeout(150);
		}

		await sidebar.screenshot({
			path: join(OUT_DIR, `workspace-${palette}-expanded.png`),
		});
	});
}

for (const palette of PALETTES) {
	test(`workspace panel — ${palette} — collapsed`, async () => {
		await setTheme(palette);

		const sidebar = page.getByRole("navigation", { name: "Worktree sessions" });
		await expect(sidebar).toBeVisible();

		// Ensure the panel is expanded first, then collapse it.
		const isCollapsed = await sidebar.evaluate(
			(el) => el.getAttribute("data-collapsed") === "true",
		);
		if (isCollapsed) {
			await page.getByRole("button", { name: "Expand sidebar" }).click();
			await expect(sidebar).toHaveAttribute("data-collapsed", "false");
			await page.waitForTimeout(150);
		}

		// Now collapse the sidebar.
		await page.getByRole("button", { name: "Collapse sidebar" }).click();
		await expect(sidebar).toHaveAttribute("data-collapsed", "true");
		await page.waitForTimeout(150);

		await sidebar.screenshot({
			path: join(OUT_DIR, `workspace-${palette}-collapsed.png`),
		});

		// Re-expand for subsequent tests.
		await page.getByRole("button", { name: "Expand sidebar" }).click();
		await expect(sidebar).toHaveAttribute("data-collapsed", "false");
		await page.waitForTimeout(150);
	});
}
