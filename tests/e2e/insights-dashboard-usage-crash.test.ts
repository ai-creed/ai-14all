/**
 * Regression gate for the "insights store unavailable" bug
 * (docs/bugreports/bug-insights-dashboard-error-state-in-packaged-build.md).
 *
 * The dashboard's error state is reachable from a USAGE read failure, not only
 * an insights one — three of the hook's five error branches are
 * `api.usage.queryRange` — and before the fix a dead usage worker made that
 * permanent: UsageHost registered no `exit` handler, so `this.proc` stayed
 * non-null, every read posted into a dead pipe, and only the 2s timeout ever
 * settled it. Retry re-ran the same dead read, so nothing but an app restart
 * recovered.
 *
 * The unit tests pin the host contract with a fake proc. This exercises a REAL
 * utilityProcess dying under the real app: kill the usage worker through the
 * production `exit` path (the `crashUsageWorker` seam does not mark the stop
 * intentional), then assert the dashboard neither breaks nor needs a restart.
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

// One claude usage event -> the tokens tile reads exactly "12M", so "the
// dashboard still has live usage data" is a seeded assertion, not a vacuous one.
function seedClaudeUsage(home: string): void {
	const dir = join(home, ".claude", "projects", "-tmp-proj");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "session.jsonl"),
		JSON.stringify({
			type: "assistant",
			timestamp: new Date().toISOString(),
			cwd: "/tmp/-tmp-proj",
			sessionId: "e2e-usage-crash",
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
		mkdtempSync(join(tmpdir(), "ofa-usage-crash-ud-")),
	);
	whisperRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-usage-crash-wr-")),
	);
	tempHome = realpathSync(mkdtempSync(join(tmpdir(), "ofa-usage-crash-home-")));
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

const crashUsageWorker = (p: Page): Promise<unknown> =>
	p.evaluate(() =>
		(
			window as unknown as {
				ai14all: {
					__insightsTest: { crashUsageWorker: () => Promise<unknown> };
				};
			}
		).ai14all.__insightsTest.crashUsageWorker(),
	);

test("the dashboard survives a usage-worker crash and recovers without an app restart", async () => {
	await page.click(".insights-entry-button");
	await expect(
		page.locator('[data-testid="insights-dashboard"]'),
	).toBeVisible();

	// Baseline: live data, no error.
	await expect(page.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
		{ timeout: 20_000 },
	);
	await expect(page.locator(".idb-state--error")).toHaveCount(0);

	// Kill the REAL usage utilityProcess through the production exit path.
	await crashUsageWorker(page);

	// The host settles in-flight reads and re-forks, so a refetch must succeed.
	// Before the fix this is exactly where the dashboard wedged: the read went
	// to a dead pipe, timed out after 2s, and rendered "insights store
	// unavailable" — permanently, because retry re-ran the same dead read.
	await page
		.locator(".idb-act", { hasText: "retry" })
		.click()
		.catch(() => {
			/* no error panel to retry from is the passing case */
		});

	await expect(page.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
		{ timeout: 30_000 },
	);
	await expect(page.locator(".idb-state--error")).toHaveCount(0);

	// A second crash must be survivable too — the budget is per consecutive
	// failure, and a worker that reported ready resets it, so an occasional
	// crash can never exhaust the re-fork allowance.
	await crashUsageWorker(page);
	await expect(page.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
		{ timeout: 30_000 },
	);
	await expect(page.locator(".idb-state--error")).toHaveCount(0);
});
