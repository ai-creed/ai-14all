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

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;
let userDataDir: string;

async function clickFontMenu(id: string): Promise<void> {
	await app!.evaluate(({ Menu }, itemId) => {
		Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click();
	}, id);
}

// The persisted store moved from localStorage to settings.json (persistent
// settings v1 — use-terminal-font-size writes through settings.write, and
// localStorage is only consulted by the one-time first-run migration). Read
// the canonical store the same way the app does.
function storedFontSize(): Promise<string | null> {
	return page.evaluate(() =>
		window.ai14all.settings
			.read()
			.then((s) => String(s.settings.terminalFontSize)),
	);
}

// Reads the value the LIVE xterm instance applied (data-terminal-font-size is
// set from term.options.fontSize in TerminalPane, not from the React prop).
function liveTerminalFontSize(): Promise<string | null> {
	return page
		.locator('.shell-terminal-pane[aria-hidden="false"]')
		.first()
		.getAttribute("data-terminal-font-size");
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-font-")));
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-font-ud-")));

	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });

	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();

	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav.getByRole("button", { name: /main/i })).toBeVisible({
		timeout: 15_000,
	});
	await nav.getByRole("button", { name: /main/i }).click();
	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test("font-size menu changes the live terminal, clamps, resets, and persists", async () => {
	await clickFontMenu("terminal-font-reset");
	await expect.poll(storedFontSize, { timeout: 5_000 }).toBe("13");
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("13");

	await clickFontMenu("terminal-font-increase");
	await expect.poll(storedFontSize, { timeout: 5_000 }).toBe("14");
	// The live xterm instance applied the change — not just localStorage.
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("14");

	for (let i = 0; i < 20; i++) await clickFontMenu("terminal-font-increase");
	await expect.poll(storedFontSize, { timeout: 5_000 }).toBe("20"); // clamp max
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("20");

	for (let i = 0; i < 20; i++) await clickFontMenu("terminal-font-decrease");
	await expect.poll(storedFontSize, { timeout: 5_000 }).toBe("10"); // clamp min
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("10");

	await clickFontMenu("terminal-font-reset");
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("13");

	// Set to 16 and confirm both storage and the live terminal survive a reload.
	for (let i = 0; i < 3; i++) await clickFontMenu("terminal-font-increase");
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("16");
	await page.reload();
	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });
	await expect.poll(storedFontSize, { timeout: 5_000 }).toBe("16");
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("16");
});
