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
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeApp } from "./fixtures/close-app";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

const scopeData = (
	scope: string,
	codexTokens: number,
	claudeTokens: number,
) => ({
	scope,
	totalTokens: codexTokens + claudeTokens,
	byProvider: [
		{
			provider: "codex",
			tokens: codexTokens,
			costUsd: (codexTokens / 1_000_000) * 10,
		},
		{
			provider: "claude",
			tokens: claudeTokens,
			costUsd: (claudeTokens / 1_000_000) * 15,
		},
	]
		.filter((r) => r.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens),
	rows: [
		{
			workspaceId: "ws1",
			worktreeId: "w1",
			worktreePath: "/p/w1",
			worktreeTitle: "main",
			provider: "codex",
			active: true,
			tokens: {
				input: codexTokens,
				output: 0,
				billable: codexTokens,
				raw: codexTokens,
			},
			costUsd: (codexTokens / 1_000_000) * 10,
		},
	],
	cost: {
		perProvider: {
			codex: (codexTokens / 1_000_000) * 10,
			claude: (claudeTokens / 1_000_000) * 15,
		},
		total: (codexTokens / 1_000_000) * 10 + (claudeTokens / 1_000_000) * 15,
		currency: "USD",
		notional: true,
		unpricedTokens: 0,
	},
});

const SNAPSHOT = {
	generatedAtMs: 1_000_000_000_000,
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
		// Inert provider: capabilities all off, no series tokens, no scope tokens.
		// E2e must prove an inert provider renders NO chart segment.
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
	scopes: {
		session: scopeData("session", 500_000, 0),
		week: scopeData("week", 800_000, 500_000),
		month: scopeData("month", 800_000, 500_000),
		"all-time": scopeData("all-time", 1_200_000, 900_000),
	},
	seriesDaily: [
		{
			dayStartMs: 1_000_000_000_000 - 86_400_000,
			tokens: { claude: 500_000, codex: 300_000 },
		},
		{ dayStartMs: 1_000_000_000_000, tokens: { codex: 500_000 } },
	],
	seriesHourly: [
		{ hourStartMs: 1_000_000_000_000 - 3_600_000, tokens: { codex: 200_000 } },
		{ hourStartMs: 1_000_000_000_000, tokens: { codex: 300_000 } },
	],
	codexLimits: {
		provider: "codex",
		fiveHour: { percent: 41, resetsAtMs: 1_000_000_000_000 + 5_400_000 },
		weekly: { percent: 23, resetsAtMs: null, used: null, budget: null },
	},
	config: { chipRange: "week", includeUntracked: false },
};

test.describe.serial("usage chip + popover", () => {
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

		// (a) the popover opens on Session by default.
		// Scope to .usage-pop to avoid strict-mode collision with "New session" / "Rename session"
		// buttons that are also in the page at the same time.
		const pop = page.locator(".usage-pop");
		await page.getByRole("button", { name: "Open token breakdown" }).click();
		await expect(
			pop.getByRole("button", { name: "Session", exact: true }),
		).toHaveClass(/on/);

		// (b) switching scope changes the rendered total.
		await pop.getByRole("button", { name: "All-time", exact: true }).click();
		await expect(
			pop.getByRole("button", { name: "All-time", exact: true }),
		).toHaveClass(/on/);
		await expect(page.getByText(/2\.1\s?M|2,100,000/).first()).toBeVisible(); // 1.2M + 0.9M all-time

		// (c) REOPEN REGRESSION: scope is ephemeral renderer state — closing and reopening the
		//     popover MUST reset it to Session (the last-viewed scope is never persisted).
		await page.locator(".usage-gear").click(); // close affordance (UsagePopover onClose)
		await expect(page.locator(".usage-pop")).toHaveCount(0);
		await page.getByRole("button", { name: "Open token breakdown" }).click(); // reopen
		const pop2 = page.locator(".usage-pop");
		await expect(
			pop2.getByRole("button", { name: "Session", exact: true }),
		).toHaveClass(/on/);
		await expect(
			pop2.getByRole("button", { name: "All-time", exact: true }),
		).not.toHaveClass(/on/);

		// (d) All-time omits the chart entirely.
		await pop2.getByRole("button", { name: "All-time", exact: true }).click();
		await expect(page.locator(".usage-pop .usage-chart")).toHaveCount(0);

		// (e) INERT PROVIDER no-segment: switch to Week (daily chart shows claude+codex).
		//     The inert `cursor` provider has no tokens, so no segment uses --provider-cursor,
		//     while the active providers still render their segments.
		await pop2.getByRole("button", { name: "Week", exact: true }).click();
		await expect(
			page.locator('.usage-chart-seg[style*="--provider-cursor"]'),
		).toHaveCount(0);
		await expect(
			page.locator('.usage-chart-seg[style*="--provider-codex"]').first(),
		).toBeVisible();

		// (f) cost shows a real `$` (never `$0`) in a scope with tokens.
		await expect(page.getByText(/\$\s?\d/).first()).toBeVisible();

		// Provider roll-up shows priced providers.
		// Use the CSS class instead of getByText("codex") to avoid a strict-mode
		// violation: the popover simultaneously shows the rollup span
		// (.usage-prov--codex) and the collapsed limits row "▸ Codex limits · native"
		// which contains "codex" as a substring.
		await expect(page.locator(".usage-prov--codex")).toBeVisible();

		// Codex native limits are collapsed; expand to reveal the gauges.
		await page.getByRole("button", { name: /Codex limits/ }).click();
		await expect(page.getByText(/41%/)).toBeVisible();
	});
});

// Real scan path: NO AI14ALL_E2E_USAGE_SNAPSHOT. The app forks the real usage
// worker, which resolves driver roots via os.homedir() — HOME is overridden to
// a temp dir seeded with a fixture hax store, so the worker scans, parses, and
// buckets real turn_usage rows through the full pipeline (root -> keep -> parser
// -> scanner -> ledger -> snapshot). Guards the layers the snapshot seam bypasses.
test.describe.serial("usage telemetry — real hax-store scan", () => {
	let app: ElectronApplication | undefined;
	let page: Page;
	let testRepo: TestRepo;
	let stateDir: string;
	let tempHome: string;

	test.beforeAll(async () => {
		testRepo = createTestRepo();
		stateDir = realpathSync(
			mkdtempSync(join(tmpdir(), "ai14-usage-live-state-")),
		);
		tempHome = realpathSync(
			mkdtempSync(join(tmpdir(), "ai14-usage-live-home-")),
		);

		// Fixture hax store: header (absolute cwd = the test repo) + two usage rows.
		// billable = (1_500_000-200_000)+300_000 + (500_000-0)+100_000 = 2_200_000 -> "2.2M".
		// raw (no cached subtraction) = 1_500_000+300_000 + 500_000+100_000 = 2_400_000 -> distinct from billable.
		const storeDir = join(
			tempHome,
			".local",
			"state",
			"hax",
			"sessions",
			"Users-e2e-repo.deadbeef00000000",
		);
		mkdirSync(storeDir, { recursive: true });
		writeFileSync(
			join(storeDir, "2026-07-17T08-00-00Z_e2e-fixture.jsonl"),
			[
				JSON.stringify({
					type: "session",
					version: 1,
					id: "e2e-session",
					timestamp: "2026-07-17T08:00:00Z",
					cwd: testRepo.repoPath,
					provider: "codex",
					model: "gpt-5.6-terra",
				}),
				JSON.stringify({
					kind: "turn_usage",
					provider: "codex",
					model: "gpt-5.6-terra",
					usage: { input: 1_500_000, output: 300_000, cached: 200_000 },
				}),
				JSON.stringify({
					kind: "turn_usage",
					provider: "codex",
					model: "gpt-5.6-terra",
					usage: { input: 500_000, output: 100_000, cached: 0 },
				}),
				"",
			].join("\n"),
		);

		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
				AI14ALL_USER_DATA_PATH: join(stateDir, "user-data"),
				HOME: tempHome,
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

	test("worker scans the hax store and the popover shows the ezio rollup", async () => {
		test.setTimeout(120_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await page.getByRole("button", { name: "Load" }).click();
		const worktreeNav = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(
			worktreeNav.getByRole("button", { name: /feature-a/i }),
		).toBeVisible({ timeout: 15_000 });
		await worktreeNav.getByRole("button", { name: /feature-a/i }).click();

		// Real worker: first snapshot arrives after the initial sweep (throttled ~1.5s).
		await expect(page.locator(".usage-strip")).toBeVisible({ timeout: 30_000 });
		await page.getByRole("button", { name: "Open token breakdown" }).click();
		const pop = page.locator(".usage-pop");
		await pop.getByRole("button", { name: "All-time", exact: true }).click();
		// The fixture's 2.2M billable ezio tokens came through the REAL pipeline.
		await expect(page.locator(".usage-prov--ezio")).toBeVisible();
		await expect(page.getByText(/2\.2\s?M|2,200,000/).first()).toBeVisible();
	});
});
