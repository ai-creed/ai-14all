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

// Drive a real fetch cycle the way a user would: switch range and come back.
// `7d` is the default, so this ends where it started and the tile assertions
// stay comparable across the whole test.
async function forceRefetch(p: Page): Promise<void> {
	await p.getByRole("button", { name: "30d", exact: true }).click();
	await p.getByRole("button", { name: "7d", exact: true }).click();
}

// Let a fetch cycle finish before asserting anything about it. This matters
// more than it looks: a failing usage read needs the host's full 2s
// RANGE_TIMEOUT_MS before the view flips to its error state, and the previous
// render stays on screen until then. Assert too early and BOTH a
// `.idb-state--error` count-of-0 and a `12M` tile match pass against a build
// with no worker at all — verified in both directions while writing this.
const settle = (p: Page): Promise<void> => p.waitForTimeout(6000);

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

	// Kill the REAL usage utilityProcess through the production exit path, then
	// FORCE a fetch cycle. Forcing it is the whole point: the hook only refetches
	// on a range switch, retry, or its 30s poll, so merely re-asserting here
	// would pass against the broken build purely because the DOM still held the
	// pre-crash render. A range switch runs the same `fetchAll` a user's click
	// does, and every cycle issues `api.usage.queryRange`.
	await crashUsageWorker(page);
	await forceRefetch(page);
	// Assert the POSITIVE signal first. A bare `.idb-state--error` count-of-0
	// would pass vacuously: the panel needs the read's full 2s timeout to
	// appear, so an absence assertion fired straight after the click succeeds on
	// the transient pre-error render (verified — the broken build reaches
	// `error: true` only ~2s later). The tokens tile can only render from a
	// COMPLETED usage read, so waiting for it is what actually proves recovery.
	await expect(page.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
		{ timeout: 30_000 },
	);
	await expect(page.locator(".idb-state--error")).toHaveCount(0);

	// A second crash must be survivable too — the budget counts CONSECUTIVE
	// failures and a worker that reports ready resets it, so an occasional crash
	// can never exhaust the re-fork allowance.
	await crashUsageWorker(page);
	await forceRefetch(page);
	await settle(page);
	await expect(page.locator(".idb-state--error")).toHaveCount(0);
	await expect(page.locator('[data-testid="tile-tokens"] .v')).toHaveText(
		"12M",
	);
});
