/**
 * Task 13 — AC1 end-to-end coverage for the insights dashboard's entry
 * points (design spec `docs/design-specs/2026-07-28-insights-dashboard-design.md`
 * §7 AC1): a chip-bar action AND a command-palette entry both open the
 * overlay, which replaces the main column; the overlay's ✕ restores the
 * prior layout.
 *
 * Launches the REAL built app (out/main/index.js) with the
 * AI14ALL_USER_DATA_PATH / AI14ALL_WHISPER_STATE_ROOT env seams (mirrors
 * tests/e2e/insights.test.ts's harness) and a settings fixture with usage
 * telemetry + insights ON and the one-time notice already acknowledged
 * (noticeShown: true) — AC1 only cares about the overlay opening/closing, so
 * the first-capture notice banner is suppressed to keep it out of the way of
 * the chip-bar button and the palette shortcut.
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	cpSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

const HERE = dirname(fileURLToPath(import.meta.url)); // ESM-safe; no __dirname
const IS_MAC = process.platform === "darwin";

// Complete-enough settings.json: omitted top-level fields fall back to schema
// defaults on parse (PersistedSettingsV1Schema). Telemetry + insights ON, and
// noticeShown true so the first-capture notice never covers the chip bar.
const enabledSettings = JSON.stringify({
	version: 1,
	usageTelemetry: {
		enabled: true,
		includeUntracked: false,
		chipRange: "week",
		insights: { enabled: true, noticeShown: true },
	},
});

let app: ElectronApplication;
let page: Page;
let repo: TestRepo;
let userDataDir: string;
let whisperRoot: string;

const launch = (): Promise<ElectronApplication> =>
	electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI14ALL_WHISPER_STATE_ROOT: whisperRoot,
		},
	});

// Bring up the MAIN shell from the fresh setup screen: Browse resolves to
// AI14ALL_E2E_PICK_PATH via ipc.ts repository:pickRoot, then Load. Each test
// launches into a brand-new userDataDir, so there is never a persisted
// workspace snapshot to restore from — the setup screen always shows Browse.
async function bootToMainShell(page: Page): Promise<void> {
	await expect(page.getByRole("button", { name: "Browse" })).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page.locator("main.shell-app:not(.shell-app--setup)"),
	).toBeVisible({ timeout: 30_000 });
}

// Press the REAL ⌘⇧K / Ctrl+Shift+K chord through the input pipeline (same
// approach as tests/e2e/command-palette.spec.ts's pressCommandPalette) so it
// travels the same path a user keystroke does.
async function pressCommandPalette(page: Page): Promise<void> {
	const mod = IS_MAC ? "Meta" : "Control";
	await page.keyboard.down(mod);
	await page.keyboard.down("Shift");
	await page.keyboard.press("KeyK");
	await page.keyboard.up("Shift");
	await page.keyboard.up(mod);
}

test.beforeEach(async () => {
	repo = createTestRepo();
	userDataDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-insights-db-ud-")),
	);
	whisperRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-insights-db-wr-")),
	);
	cpSync(
		join(HERE, "fixtures", "whisper-state-v7.db"),
		join(whisperRoot, "state.db"),
	);
	writeFileSync(join(userDataDir, "settings.json"), enabledSettings);

	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });
	await bootToMainShell(page);
});

test.afterEach(async () => {
	await closeApp(app);
	rmSync(userDataDir, { recursive: true, force: true });
	rmSync(whisperRoot, { recursive: true, force: true });
	repo.cleanup();
});

test("AC1: chip-bar action opens the overlay; ✕ restores the prior layout", async () => {
	await page.click(".insights-entry-button");
	await expect(
		page.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();
	await page.click('[data-testid="insights-dashboard"] [title="Close"]');
	await expect(page.locator('[data-testid="insights-dashboard"]')).toHaveCount(
		0,
	);
	// the main column content is visible again:
	await expect(page.locator(".shell-main-column")).toBeVisible();
});

test("AC1: command palette entry opens the overlay", async () => {
	await pressCommandPalette(page);
	await expect(page.getByTestId("command-palette")).toBeVisible();
	await page.getByTestId("command-palette-search").fill("insights");
	await expect(page.getByText("Insights: open dashboard")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(
		page.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();
});
