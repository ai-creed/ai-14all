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

let testRepo: TestRepo;

function makeDirs() {
	const userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ob-ud-")));
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ob-st-")));
	return { userDataDir, stateDir };
}

async function launch(dirs: { userDataDir: string; stateDir: string }) {
	return electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_ONBOARDING: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(dirs.stateDir, "workspace-state.json"),
			AI14ALL_USER_DATA_PATH: dirs.userDataDir,
		},
	});
}

async function loadRepo(page: Page) {
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
}

test.beforeAll(() => {
	testRepo = createTestRepo();
});
test.afterAll(() => {
	testRepo?.cleanup();
});

test("fresh profile: setup screen is silent, tour fires after loading a repo", async () => {
	const dirs = makeDirs();
	let app: ElectronApplication | undefined;
	try {
		app = await launch(dirs);
		const page = await app.firstWindow({ timeout: 60_000 });
		// Setup screen (no repo) — the tour must NOT show.
		await expect(page.locator('[data-testid="tour-overlay"]')).toHaveCount(0);
		await loadRepo(page);
		// Session view mounted — the tour auto-shows.
		await expect(page.locator('[data-testid="tour-overlay"]')).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.locator('[data-testid="tour-card"]')).toContainText(
			"Sessions are isolated",
		);
	} finally {
		await closeApp(app);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});

test("seen flag: tour stays silent", async () => {
	const dirs = makeDirs();
	let app: ElectronApplication | undefined;
	try {
		app = await launch(dirs);
		const page = await app.firstWindow({ timeout: 60_000 });
		await page.evaluate(() =>
			localStorage.setItem("ai14all.onboarding.tourVersionSeen", "1"),
		);
		await page.reload();
		await loadRepo(page);
		await expect(page.locator('[data-testid="tour-overlay"]')).toHaveCount(0);
	} finally {
		await closeApp(app);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});

test("Help replay re-fires the tour after it was seen", async () => {
	const dirs = makeDirs();
	let app: ElectronApplication | undefined;
	try {
		app = await launch(dirs);
		const page = await app.firstWindow({ timeout: 60_000 });
		await page.evaluate(() =>
			localStorage.setItem("ai14all.onboarding.tourVersionSeen", "1"),
		);
		await page.reload();
		await loadRepo(page);
		await expect(page.locator('[data-testid="tour-overlay"]')).toHaveCount(0);
		// Drive the Help-menu replay channel directly (menu bridge → renderer).
		await app.evaluate(({ webContents }) => {
			webContents.getAllWebContents()[0].send("help/showWelcomeTour");
		});
		await expect(page.locator('[data-testid="tour-overlay"]')).toBeVisible({
			timeout: 15_000,
		});
	} finally {
		await closeApp(app);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});

test("retro-mark: an upgrading profile with a saved workspace stays silent", async () => {
	// Two launches share the same userData + state dirs. Launch 1 creates a
	// workspace, then we clear the seen-flag to simulate an upgrade where the
	// flag never existed. Launch 2's migration must retro-mark and stay silent.
	const dirs = makeDirs();
	let app1: ElectronApplication | undefined;
	try {
		app1 = await launch(dirs);
		const page1 = await app1.firstWindow({ timeout: 60_000 });
		await loadRepo(page1);
		await expect(page1.locator('[data-testid="tour-overlay"]')).toBeVisible({
			timeout: 15_000,
		});
		// Simulate "no onboarding flag ever" for the upgrade scenario.
		await page1.evaluate(() =>
			localStorage.removeItem("ai14all.onboarding.tourVersionSeen"),
		);
	} finally {
		await closeApp(app1);
	}

	let app2: ElectronApplication | undefined;
	try {
		app2 = await launch(dirs);
		const page2 = await app2.firstWindow({ timeout: 60_000 });
		// Launch 2 has a saved workspace, so it settles into EITHER the restore
		// prompt or (with an alwaysRestore preference) straight into the session
		// view. Wait for whichever appears before branching — do not race the
		// still-loading startup screen.
		const restore = page2.getByRole("button", {
			name: /restore previous workspace/i,
		});
		const nav = page2.getByRole("navigation", { name: "Worktree sessions" });
		await expect(restore.or(nav)).toBeVisible({ timeout: 20_000 });
		if (await restore.isVisible().catch(() => false)) {
			await restore.click();
		}
		await expect(nav).toBeVisible({ timeout: 15_000 });
		// The migration retro-marked the upgrading profile, so no tour appears.
		await expect(page2.locator('[data-testid="tour-overlay"]')).toHaveCount(0);
	} finally {
		await closeApp(app2);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});

test("mounted session view: a step whose anchor is absent is skipped, not wedged", async () => {
	const dirs = makeDirs();
	let app: ElectronApplication | undefined;
	try {
		app = await launch(dirs);
		const page = await app.firstWindow({ timeout: 60_000 });
		await loadRepo(page);
		await expect(page.locator('[data-testid="tour-overlay"]')).toBeVisible({
			timeout: 15_000,
		});
		// Remove a reliably-present middle-step anchor (session-row / the "Know
		// who needs you" step). When the tour reaches that step its anchor is
		// absent, so it must be skipped — never wedge — and the tour must still
		// drive to the end.
		await page.evaluate(() => {
			document
				.querySelectorAll('[data-tour="session-row"]')
				.forEach((el) => el.removeAttribute("data-tour"));
		});
		// Drive the tour forward. Some steps' anchors are environment-dependent
		// (e.g. the agent launcher renders nothing when no agent CLIs are
		// detected), so we do not assert per-step labels — only that Next keeps
		// advancing and the tour ultimately closes without hanging.
		for (let i = 0; i < 6; i++) {
			const next = page.locator('[data-testid="tour-next"]');
			if ((await next.count()) > 0) {
				await next.click({ timeout: 5_000 }).catch(() => {});
			}
			await page.waitForTimeout(250);
		}
		// The tour completed (overlay closed) rather than wedging on the absent
		// anchor, and the removed step was never shown.
		await expect(page.locator('[data-testid="tour-overlay"]')).toHaveCount(0);
		await expect(page.getByText("Know who needs you")).toHaveCount(0);
	} finally {
		await closeApp(app);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});
