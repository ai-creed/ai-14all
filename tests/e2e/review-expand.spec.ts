import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStatePath: string;

function portal() {
	return page.getByTestId("review-expanded-portal");
}
function drawer() {
	return page.getByRole("region", { name: "Review" });
}

async function launchRaw() {
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
}

async function firstLaunch() {
	await launchRaw();
	await page.getByRole("button", { name: "Browse" }).click();
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });
	await page
		.getByRole("navigation", { name: "Worktree sessions" })
		.getByRole("button", { name: /main/i })
		.click();
}

let modKey: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ai14all-e2e-expand-")));
	persistedStatePath = join(stateDir, "workspace-state.json");

	writeFileSync(join(testRepo.repoPath, ".gitignore"), ".worktrees/\n");
	execSync("git add .gitignore && git commit -m 'init'", { cwd: testRepo.repoPath });

	// Untracked file makes the review pane dirty so it has content to show.
	writeFileSync(join(testRepo.repoPath, "hello.txt"), "hello\n");

	await firstLaunch();

	const isMac = await page.evaluate(() =>
		navigator.platform.toUpperCase().includes("MAC"),
	);
	modKey = isMac ? "Meta" : "Control";
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

test.describe.serial("Review expand mode", () => {
	test("portal not visible on load", async () => {
		await expect(portal()).toHaveCount(0);
	});

	test("⌘⇧J opens portal when drawer is closed; drawer stays closed", async () => {
		await expect(drawer()).toHaveAttribute("data-open", "false");
		await page.keyboard.press(`${modKey}+Shift+j`);
		await expect(portal()).toBeVisible();
		// Drawer in-flow header stays closed (data-open unchanged)
		await expect(drawer()).toHaveAttribute("data-open", "false");
	});

	test("collapse button in portal closes portal", async () => {
		await portal().getByRole("button", { name: /collapse full review/i }).click();
		await expect(portal()).toHaveCount(0);
		// Drawer state unchanged — still closed
		await expect(drawer()).toHaveAttribute("data-open", "false");
	});

	test("terminal height does not change when toggling portal (drawer closed)", async () => {
		const terminalSection = page.locator(".shell-terminal-section");
		const heightBefore = await terminalSection.evaluate((el) => el.clientHeight);

		await page.keyboard.press(`${modKey}+Shift+j`);
		await expect(portal()).toBeVisible();
		const heightDuring = await terminalSection.evaluate((el) => el.clientHeight);

		await portal().getByRole("button", { name: /collapse full review/i }).click();
		await expect(portal()).toHaveCount(0);
		const heightAfter = await terminalSection.evaluate((el) => el.clientHeight);

		expect(heightDuring).toBe(heightBefore);
		expect(heightAfter).toBe(heightBefore);
	});

	test("⌘⇧J opens portal when drawer is already open; drawer stays open", async () => {
		// Open drawer first
		await page.getByRole("button", { name: /expand review drawer/i }).click();
		await expect(drawer()).toHaveAttribute("data-open", "true");

		const terminalSection = page.locator(".shell-terminal-section");
		const heightBefore = await terminalSection.evaluate((el) => el.clientHeight);

		await page.keyboard.press(`${modKey}+Shift+j`);
		await expect(portal()).toBeVisible();

		// Drawer still open, terminal height unchanged
		await expect(drawer()).toHaveAttribute("data-open", "true");
		const heightDuring = await terminalSection.evaluate((el) => el.clientHeight);
		expect(heightDuring).toBe(heightBefore);
	});

	test("⌘⇧J again collapses portal; drawer remains open", async () => {
		await page.keyboard.press(`${modKey}+Shift+j`);
		await expect(portal()).toHaveCount(0);
		await expect(drawer()).toHaveAttribute("data-open", "true");
	});

	test("expand button in drawer header opens portal", async () => {
		// drawer is open from previous test
		await page.getByRole("button", { name: /expand to full review/i }).click();
		await expect(portal()).toBeVisible();
		// collapse to clean up
		await portal().getByRole("button", { name: /collapse full review/i }).click();
		await expect(portal()).toHaveCount(0);
	});

	test("review.expand row appears in shortcuts help", async () => {
		await page.keyboard.press(`${modKey}+Slash`);
		await expect(page.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeVisible();
		await expect(page.getByTestId("shortcuts-help-row-review.expand")).toBeVisible();
		await page.keyboard.press("Escape");
	});
});
