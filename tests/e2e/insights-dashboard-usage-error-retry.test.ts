/**
 * Diagnosis §3.6's full user-visible loop: error state → Retry → recovery,
 * without an app restart.
 *
 * This needs the usage worker PRESENT but unresponsive. A cleanly-absent worker
 * reports `disabled`, which the dashboard renders as a quiet caption, not the
 * error panel — so killing the worker (covered in
 * insights-dashboard-usage-crash.test.ts) cannot produce this flow once the
 * supervision fix is in. `AI14ALL_E2E_USAGE_SLOW_START_MS` holds the worker's
 * reads for a bounded window, reproducing exactly the gap a user hits while a
 * replacement worker is still coming up: reads time out, the panel appears,
 * Retry during the gap keeps failing (which is what made the original bug feel
 * permanent), and Retry after it recovers the view in place.
 *
 * It also pins the corrected copy: the panel must blame TOKEN USAGE, not "the
 * local insights database" — that mislabelling sent the original bug report at
 * the wrong subsystem while the insights store was healthy throughout.
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOLD_MS = 12_000;

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
let tempHome: string;

function seedClaudeUsage(home: string): void {
	const dir = join(home, ".claude", "projects", "-tmp-proj");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "session.jsonl"),
		JSON.stringify({
			type: "assistant",
			timestamp: new Date().toISOString(),
			cwd: "/tmp/-tmp-proj",
			sessionId: "e2e-usage-retry",
			message: {
				model: "claude-opus-4-7",
				usage: {
					input_tokens: 12_000_000,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		}) + "\n",
	);
}

test.beforeEach(async () => {
	repo = createTestRepo();
	userDataDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-usage-retry-ud-")),
	);
	whisperRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-usage-retry-wr-")),
	);
	tempHome = realpathSync(mkdtempSync(join(tmpdir(), "ofa-usage-retry-home-")));
	seedClaudeUsage(tempHome);
	cpSync(
		join(HERE, "fixtures", "whisper-state-v7.db"),
		join(whisperRoot, "state.db"),
	);
	writeFileSync(join(userDataDir, "settings.json"), enabledSettings);

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI14ALL_WHISPER_STATE_ROOT: whisperRoot,
			AI14ALL_E2E_USAGE_SLOW_START_MS: String(HOLD_MS),
			HOME: tempHome,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });

	await expect(page.getByRole("button", { name: "Browse" })).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page.locator("main.shell-app:not(.shell-app--setup)"),
	).toBeVisible({ timeout: 30_000 });
});

test.afterEach(async () => {
	await closeApp(app);
	rmSync(userDataDir, { recursive: true, force: true });
	rmSync(whisperRoot, { recursive: true, force: true });
	rmSync(tempHome, { recursive: true, force: true });
	repo.cleanup();
});

test("an unresponsive usage worker shows the error panel; Retry recovers it in place", async () => {
	await page.click(".insights-entry-button");
	await expect(
		page.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();

	// The usage read times out (2s) and the panel appears.
	await expect(page.locator(".idb-state--error")).toHaveCount(1, {
		timeout: 20_000,
	});
	await expect(page.getByText("token usage unavailable")).toBeVisible();
	await expect(page.getByText("insights store unavailable")).toHaveCount(0);

	// Retry WHILE still held must keep failing rather than flicker to a false
	// success — a retry that cannot recover is what made the original bug read
	// as permanent to the reporter.
	await page.locator(".idb-act", { hasText: "retry" }).click();
	await expect(page.locator(".idb-state--error")).toHaveCount(1);

	// Once the worker answers again, Retry recovers the view — no app restart,
	// which is the acceptance criterion the bug report asked for.
	await page.waitForTimeout(HOLD_MS);
	await page.locator(".idb-act", { hasText: "retry" }).click();
	await expect(page.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
		{ timeout: 30_000 },
	);
	await expect(page.locator(".idb-state--error")).toHaveCount(0);
});
