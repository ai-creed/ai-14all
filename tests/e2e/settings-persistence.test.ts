/**
 * E2E proof that settings written through the Settings dialog's backing API
 * (`window.ai14all.settings.write`) survive an app restart end-to-end: on
 * disk (settings.json under userData), in the synchronous boot value
 * (`settings.initial`), and in what the app actually renders (data-theme on
 * <html>, and the LIVE terminal font size the xterm instance applied).
 *
 * Harness copied from tests/e2e/session-attention.spec.ts (electron.launch,
 * env seams, closeApp). The live-font-size locator is copied from
 * tests/e2e/terminal-font-size.spec.ts, which reads `data-terminal-font-size`
 * off the visible `.shell-terminal-pane` — that attribute reflects
 * `term.options.fontSize` on the actual xterm instance, not just the stored
 * setting, so it is the durable "did the app really apply this" signal.
 */
import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;
let userDataDir: string;

const launch = () =>
	electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});

// Reads the value the LIVE xterm instance applied (data-terminal-font-size is
// set from term.options.fontSize in TerminalPane, not from the React prop) —
// same locator as terminal-font-size.spec.ts's liveTerminalFontSize() helper.
function liveTerminalFontSize(): Promise<string | null> {
	return page
		.locator('.shell-terminal-pane[aria-hidden="false"]')
		.first()
		.getAttribute("data-terminal-font-size");
}

test.beforeAll(() => {
	testRepo = createTestRepo();
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-settings-")));
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-settings-ud-")));
});
test.afterAll(async () => {
	if (app) await closeApp(app);
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(userDataDir, { recursive: true, force: true });
	testRepo.cleanup();
});

test("theme and terminal font size survive an app restart (spec §7 e2e #3)", async () => {
	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });

	// Load the workspace so a live terminal exists (boot sequence per
	// session-attention.spec.ts), and make the restart restore it without a
	// prompt so the second launch also has a live terminal.
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });

	await page.evaluate(() =>
		window.ai14all.settings.write({
			theme: "warm",
			terminalFontSize: 16,
			restorePreference: "alwaysRestore",
		}),
	);
	await expect(page.locator("html")).toHaveAttribute("data-theme", "warm");
	await expect.poll(liveTerminalFontSize, { timeout: 5_000 }).toBe("16");
	await closeApp(app);

	app = await launch();
	page = await app.firstWindow({ timeout: 60_000 });

	// Applied at boot from settings.initial — before any user interaction and
	// with no flash of defaults (data-theme is set by the useTheme lazy
	// initializer reading settings.initial synchronously).
	await expect(page.locator("html")).toHaveAttribute("data-theme", "warm");
	await expect(
		page
			.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
			.first(),
	).toBeVisible({ timeout: 15_000 });
	// Assert the LIVE applied font size, not just the stored value.
	await expect.poll(liveTerminalFontSize, { timeout: 30_000 }).toBe("16");

	const boot = await page.evaluate(() => ({
		theme: window.ai14all.settings.initial.theme,
		fontSize: window.ai14all.settings.initial.terminalFontSize,
	}));
	expect(boot).toEqual({ theme: "warm", fontSize: 16 });

	const onDisk = JSON.parse(
		readFileSync(join(userDataDir, "settings.json"), "utf8"),
	);
	expect(onDisk.theme).toBe("warm");
	expect(onDisk.terminalFontSize).toBe(16);
});
