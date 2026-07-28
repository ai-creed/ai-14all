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
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
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
// AC2 harness: a fresh $HOME per test, seeded with ONE claude-format usage
// event under ~/.claude/projects — the real usage worker sweeps it on boot
// (os.homedir() honors $HOME on POSIX), giving the detached window a
// deterministic LIVE pulled token value to assert against. Deliberately NOT
// AI14ALL_E2E_USAGE_SNAPSHOT, which suppresses the worker and would turn
// usage.queryRange into `disabled`.
let tempHome: string;

// 12,000,000 billable tokens (input_tokens + output_tokens +
// cache_creation_input_tokens, per services/usage/token-math.ts's
// claudeTokens — cache_read is excluded from billable) -> fmtTokens rounds
// to exactly "12M". The line shape is copied from
// tests/unit/usage/claude-source.test.ts (the format's source of truth).
// cwd deliberately does NOT match the test repo's path, so this event folds
// into the workspace table's "untracked" row, not the named workspace row —
// AC5's zero-row assertion below depends on that separation.
function seedClaudeUsage(home: string): void {
	const dir = join(home, ".claude", "projects", "-tmp-proj");
	mkdirSync(dir, { recursive: true });
	const line = JSON.stringify({
		type: "assistant",
		timestamp: new Date().toISOString(),
		cwd: "/tmp/-tmp-proj",
		sessionId: "e2e-ac2-session",
		message: {
			model: "claude-opus-4-7",
			usage: {
				input_tokens: 12_000_000,
				output_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
		},
	});
	writeFileSync(join(dir, "session.jsonl"), line + "\n");
}

const launch = (): Promise<ElectronApplication> =>
	electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI14ALL_WHISPER_STATE_ROOT: whisperRoot,
			HOME: tempHome,
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
	tempHome = realpathSync(mkdtempSync(join(tmpdir(), "ofa-insights-db-home-")));
	seedClaudeUsage(tempHome);
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
	rmSync(tempHome, { recursive: true, force: true });
	repo.cleanup();
});

test("AC1: chip-bar action opens the overlay; ✕ restores the prior layout", async () => {
	await page.click(".insights-entry-button");
	await expect(
		page.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();

	// Escape closes it too — the overlay focuses itself on mount so the
	// keypress is scoped inside it (see InsightsOverlay's focus-on-mount
	// effect), pinning the fix end-to-end rather than just unit-testing it.
	await page.keyboard.press("Escape");
	await expect(page.locator('[data-testid="insights-dashboard"]')).toHaveCount(
		0,
	);
	await expect(page.locator(".shell-main-column")).toBeVisible();

	// Reopen for the existing ✕ flow.
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

// AC2 (design spec §2 decision 4): ⧉ detach creates/focuses a SINGLETON
// window (never window.open() from the renderer) sharing the same preload +
// navigation guard; the overlay closes on detach; ⇱ reattach closes the
// window and reopens the overlay; an OS-driven close just closes (no
// overlay reopen). The detached host renders LIVE pulled token data (the
// seeded 12M from tempHome's ~/.claude/projects) and seeds the same
// workspace registry rows as the overlay (AC5).
test("AC2: detach → singleton window with LIVE pulled token data; reattach reverses; OS-close never reopens", async () => {
	const repoName = basename(repo.repoPath);

	await page.click(".insights-entry-button");
	await page.click('[title="Detach into its own window"]');
	const dash = await app.waitForEvent("window"); // second BrowserWindow
	await expect(page.locator('[data-testid="insights-dashboard"]')).toHaveCount(
		0,
	);
	await expect(
		dash.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();

	// AC2/§2.2: the DETACHED host pulls a KNOWN token value cross-window — the
	// seeded 12M billable event must render in the tokens tile (fmtTokens ->
	// "12M"). `.v` is the tile's value line; `[data-testid="tile-tokens"]`
	// alone also contains the "tokens" label and cost/billable caption, so
	// asserting on the whole block would never equal "12M" exactly.
	await expect(dash.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
		{ timeout: 15_000 },
	);
	await expect(dash.locator(".idb-state--error")).toHaveCount(0);

	// AC5 in the detached host: the NAMED persisted workspace (the harness's
	// test repo, zero runs/tokens — its cwd never appears in the seeded usage
	// log) renders as its own table row. repoName = basename(repo.repoPath),
	// the same derivation workspaceIndex's mapper uses.
	await dash.getByRole("button", { name: "workspaces" }).click();
	await expect(
		dash.locator(".idb-ws-grid .ws-name", { hasText: repoName }),
	).toBeVisible();
	// …and it is a ZERO row (seeded, not data-driven):
	const zeroRow = dash.locator(".idb-ws-grid .cell.ws-runs", {
		hasText: "0 done · 0 halted · 0 failed",
	});
	await expect(zeroRow.first()).toBeVisible();

	// detach again focuses the SAME window (singleton — still exactly 2 windows):
	await page.click(".insights-entry-button"); // overlay reopens in main
	await page.click('[title="Detach into its own window"]');
	expect(app.windows()).toHaveLength(2);

	// reattach:
	await dash.click('[title="Reattach to main window"]');
	await expect(
		page.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();
	expect(app.windows()).toHaveLength(1);
});

test("AC2: OS-close just closes — the overlay does NOT reopen", async () => {
	await page.click(".insights-entry-button");
	await page.click('[title="Detach into its own window"]');
	const dash = await app.waitForEvent("window");
	await expect(page.locator('[data-testid="insights-dashboard"]')).toHaveCount(
		0,
	);
	// OS chrome close (Playwright page.close() drives the real window close path):
	await dash.close();
	await expect.poll(() => app.windows().length).toBe(1);
	// the overlay must NOT auto-reopen (decision 3):
	await page.waitForTimeout(500);
	await expect(page.locator('[data-testid="insights-dashboard"]')).toHaveCount(
		0,
	);
});
