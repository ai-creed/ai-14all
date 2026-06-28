// E2E: usage chip (dense chart) + popover render from a fixture snapshot.
//
// The AI14ALL_E2E_USAGE_SNAPSHOT env seam injects a UsageSnapshot into the
// main process's UsageHost; it skips forking the real usage worker and emits
// the snapshot directly. The preload's buffered-channel mechanism (see
// preload/index.ts) captures the snapshot that arrives on did-finish-load and
// replays it when React's useUsageSnapshot effect registers its listener.
//
// Navigation: UsageStrip is only rendered inside SessionChipBar which itself
// is only mounted when activeWorktree + activeSession are truthy. We therefore
// navigate into a workspace before asserting (same pattern as command-palette.spec.ts).

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
import { closeApp } from "./fixtures/close-app";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

const SNAPSHOT = {
	generatedAtMs: 1_000_000_000_000,
	rows: [
		{
			workspaceId: "ws1",
			worktreeId: "w1",
			worktreePath: "/p/w1",
			worktreeTitle: "main",
			provider: "codex",
			active: true,
			sinceLaunch: {
				input: 700_000,
				output: 100_000,
				billable: 800_000,
				raw: 800_000,
			},
			thisWeek: { input: 0, output: 0, billable: 800_000, raw: 0 },
		},
	],
	totals: { input: 700_000, output: 100_000, billable: 800_000, raw: 800_000 },
	config: { range: "week", includeUntracked: false },
	providers: [
		{
			id: "claude",
			label: "Claude",
			brand: "var(--provider-claude)",
			capabilities: {
				tokenLog: true,
				storeKind: "jsonl-tree",
				timeSource: "per-event",
				cwdSource: "in-line",
				nativeLimits: false,
			},
			hasData: true,
		},
		{
			id: "codex",
			label: "Codex",
			brand: "var(--provider-codex)",
			capabilities: {
				tokenLog: true,
				storeKind: "jsonl-tree",
				timeSource: "per-event",
				cwdSource: "in-line",
				nativeLimits: true,
			},
			hasData: true,
		},
		{
			id: "cursor",
			label: "Cursor",
			brand: "var(--provider-cursor)",
			capabilities: {
				tokenLog: false,
				storeKind: "none",
				timeSource: "none",
				cwdSource: "none",
				nativeLimits: false,
			},
			hasData: false,
		},
	],
	series: [
		{
			dayStartMs: 1_000_000_000_000 - 86_400_000,
			tokens: { claude: 500_000, codex: 300_000 },
		},
		{ dayStartMs: 1_000_000_000_000, tokens: { codex: 500_000 } },
	],
	cost: {
		perProvider: { claude: 1.5, codex: 1.4 },
		total: 2.9,
		currency: "USD",
		notional: true,
		unpricedTokens: 0,
	},
	codexLimits: {
		provider: "codex",
		fiveHour: { percent: 41, resetsAtMs: 1_000_000_000_000 + 5_400_000 },
		weekly: { percent: 23, resetsAtMs: null, used: null, budget: null },
	},
};

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;
let tempHome: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ai14-usage-state-")));
	tempHome = realpathSync(mkdtempSync(join(tmpdir(), "ai14-usage-home-")));

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			AI14ALL_E2E_USAGE_SNAPSHOT: JSON.stringify(SNAPSHOT),
			HOME: tempHome,
			// Empty ZDOTDIR: prevents the user's .zshrc (OSC title sequences, plugins)
			// from being sourced inside the app's shells, which mirrors CI's clean shell
			// environment and avoids terminal-title assertion flakes.
			ZDOTDIR: join(tempHome, ".zdotdir"),
			XDG_CONFIG_HOME: join(tempHome, ".config"),
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	page.setDefaultTimeout(60_000);
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(tempHome, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("usage chip + popover", () => {
	test("navigates into a worktree so the chip bar mounts", async () => {
		test.setTimeout(60_000);
		// AI14ALL_E2E_PICK_PATH auto-fills the repo picker; Load navigates in.
		await page.getByRole("button", { name: "Browse" }).click();
		await page.getByRole("button", { name: "Load" }).click();
		const worktreeNav = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(
			worktreeNav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 15_000 });
		// Click into the worktree so activeWorktree + activeSession are set, which
		// causes MainColumnChrome to mount SessionChipBar (and therefore UsageStrip).
		await worktreeNav.getByRole("button", { name: /feature-a/i }).click();
	});

	test("usage chip renders the dense chart and the popover drills down", async () => {
		test.setTimeout(60_000);

		// Wait for the strip itself (snapshot must have arrived).
		await expect(page.locator(".usage-strip")).toBeVisible({ timeout: 20_000 });

		// Chip: the daily stacked chart renders bars (one per series day in-week).
		await expect(page.locator(".usage-chart-bar")).toHaveCount(2);

		// Inert providers render NO segments. The fixture's `cursor` is inert
		// (tokenLog:false, no series tokens); only claude+codex have data, so
		// exactly 3 segments render (day1: claude+codex, day2: codex) and zero are
		// painted with the cursor brand color.
		await expect(page.locator(".usage-chart-seg")).toHaveCount(3);
		await expect(
			page.locator('.usage-chart-seg[style*="--provider-cursor"]'),
		).toHaveCount(0);

		// Open the popover via the caret.
		await page.getByRole("button", { name: "Open token breakdown" }).click();

		// Default provider roll-up shows priced providers and notional cost.
		// Use the CSS class instead of getByText("codex") to avoid a strict-mode
		// violation: the popover simultaneously shows the rollup span
		// (.usage-prov--codex) and the collapsed limits row "▸ Codex limits · native"
		// which contains "codex" as a substring.
		await expect(page.locator(".usage-prov--codex")).toBeVisible();
		await expect(page.getByText(/\$1\.40/)).toBeVisible();

		// Codex native limits are collapsed; expand to reveal the gauges.
		await page.getByRole("button", { name: /Codex limits/ }).click();
		await expect(page.getByText(/41%/)).toBeVisible();
	});
});
