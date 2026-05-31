import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStatePath: string;

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-flush-")));
	persistedStatePath = join(stateDir, "workspace-state.json");

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	// On a clean E2E profile the onboarding wizard renders (its
	// "ai14all:onboarding-completed" localStorage flag is unset) and hides the
	// repository picker. Dismiss it via Skip when present so the picker shows.
	const skip = page.getByRole("button", { name: "Skip" });
	try {
		await skip.click({ timeout: 5_000 });
	} catch {
		// Wizard not shown (flag already set) — proceed to the picker.
	}
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		worktreeNav().getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });
	await worktreeNav().getByRole("button", { name: /main/i }).click();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		const stateDir = persistedStatePath.replace(/\/[^/]+$/, "");
		rmSync(stateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe("Flush edge-to-edge shell", () => {
	test("app bar spans the full window width", async () => {
		const { barW, winW } = await page.evaluate(() => {
			const bar = document.querySelector('[data-testid="app-bar"]');
			return {
				barW: bar ? Math.round(bar.getBoundingClientRect().width) : -1,
				winW: Math.round(window.innerWidth),
			};
		});
		expect(barW).toBe(winW);
	});

	test("the session strip + telemetry live inside the app bar", async () => {
		const hasSession = await page
			.locator('[data-testid="app-bar"]')
			.getByRole("region", { name: "Session" })
			.count();
		expect(hasSession).toBe(1);
	});

	test("no gaps between the major regions", async () => {
		const gaps = await page.evaluate(() => {
			const cs = (sel: string, prop: string) => {
				const el = document.querySelector(sel);
				return el ? getComputedStyle(el)[prop as keyof CSSStyleDeclaration] : "MISSING";
			};
			return {
				shellColGap: cs('[data-testid="shell-layout"]', "columnGap"),
				shellRowGap: cs('[data-testid="shell-layout"]', "rowGap"),
				shellPad: cs('[data-testid="shell-layout"]', "padding"),
				mainGap: cs('[data-testid="main-column"]', "rowGap"),
				termColGap: cs('[data-testid="terminal-grid"]', "columnGap"),
			};
		});
		expect(gaps.shellColGap).toBe("0px");
		expect(gaps.shellRowGap).toBe("0px");
		expect(gaps.shellPad).toBe("0px");
		expect(gaps.mainGap).toBe("0px");
		expect(gaps.termColGap).toBe("0px");
	});
});
