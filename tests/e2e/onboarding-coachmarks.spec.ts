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
	return {
		userDataDir: realpathSync(mkdtempSync(join(tmpdir(), "cm-ud-"))),
		stateDir: realpathSync(mkdtempSync(join(tmpdir(), "cm-st-"))),
	};
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

async function loadRepoSeenTour(page: Page) {
	// Seed the tour as already-seen so coachmarks (not the tour) are what shows.
	await page.evaluate(() =>
		localStorage.setItem("ai14all.onboarding.tourVersionSeen", "1"),
	);
	await page.reload();
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
	await nav.getByRole("button", { name: /main/i }).click();
}

test.beforeAll(() => {
	testRepo = createTestRepo();
});
test.afterAll(() => {
	testRepo?.cleanup();
});

test("coachmarks surface one at a time, and dismissal persists", async () => {
	const dirs = makeDirs();
	let app: ElectronApplication | undefined;
	try {
		app = await launch(dirs);
		const page = await app.firstWindow({ timeout: 60_000 });
		await loadRepoSeenTour(page);

		// The tour is suppressed (seen); exactly one coachmark shows at a time —
		// the leader, `plugins` ("Built-in power tools"). The others stay hidden so
		// their cards never stack and overlap in the top chrome.
		await expect(page.locator('[data-testid="coachmark"]').first()).toBeVisible(
			{ timeout: 15_000 },
		);
		await expect(page.locator('[data-testid="coachmark"]')).toHaveCount(1);
		await expect(page.getByText("Built-in power tools")).toBeVisible();

		// Dismissing the leader promotes the next coachmark (`telemetry`); the
		// dismissed one does not linger, and there is still only one on screen.
		await page.locator('[data-testid="coachmark-dismiss"]').click();
		await expect(page.getByText("Token & cost usage")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText("Built-in power tools")).toHaveCount(0);
		await expect(page.locator('[data-testid="coachmark"]')).toHaveCount(1);

		// The dismissal persists across a reload: the sequence resumes at the
		// second coachmark rather than restarting at the dismissed leader.
		await page.reload();
		const nav = page.getByRole("navigation", { name: "Worktree sessions" });
		await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
			timeout: 15_000,
		});
		await nav.getByRole("button", { name: /main/i }).click();
		await expect(page.getByText("Token & cost usage")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText("Built-in power tools")).toHaveCount(0);
		await expect(page.locator('[data-testid="coachmark"]')).toHaveCount(1);
	} finally {
		await closeApp(app);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});

test("coachmarks are suppressed while the tour is active", async () => {
	const dirs = makeDirs();
	let app: ElectronApplication | undefined;
	try {
		app = await launch(dirs);
		const page = await app.firstWindow({ timeout: 60_000 });
		// Fresh profile: the tour shows, so no coachmarks may show.
		await page.getByRole("button", { name: "Browse" }).click();
		await page.getByRole("button", { name: "Load" }).click();
		await expect(page.locator('[data-testid="tour-overlay"]')).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.locator('[data-testid="coachmark"]')).toHaveCount(0);
	} finally {
		await closeApp(app);
		rmSync(dirs.userDataDir, { recursive: true, force: true });
		rmSync(dirs.stateDir, { recursive: true, force: true });
	}
});
