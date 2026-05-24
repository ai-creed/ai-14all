import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let persistedStateDir: string;
let persistedStatePath: string;
let userDataDir: string;

function readShellLog(): string {
	const logDir = join(userDataDir, "diagnostics", "shell-events");
	const files = readdirSync(logDir).sort();
	if (files.length === 0) return "";
	return readFileSync(join(logDir, files[files.length - 1]!), "utf8");
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-resilience-")),
	);
	persistedStatePath = join(persistedStateDir, "workspace-state.json");
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-user-data-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_WORKSPACE_STATE_PATH: persistedStatePath,
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}, 60_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo.cleanup();
	}
}, 90_000);

test.describe.serial("Terminal session resilience", () => {
	test.describe.configure({ timeout: 120_000 });

	test("terminal survives renderer reload and remains interactive", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await expect(
			page
				.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
				.first(),
		).toBeVisible({ timeout: 10_000 });

		const marker = `echo RESILIENCE_MARKER_${Date.now()}`;
		const textarea = page.locator(".xterm-helper-textarea");
		await textarea.waitFor({ state: "attached" });
		await textarea.focus();
		await page.keyboard.type(marker);
		await page.keyboard.press("Enter");

		await expect(
			page.locator(".xterm-accessibility-tree").first(),
		).toContainText("RESILIENCE_MARKER", { timeout: 10_000 });

		await page.reload();

		await expect(
			page.getByRole("button", { name: "Restore previous workspace" }),
		).toHaveCount(0);
		await expect(
			page
				.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
				.first(),
		).toBeVisible({ timeout: 15_000 });

		const postReloadMarker = `echo POST_RELOAD_${Date.now()}`;
		const textareaAfter = page.locator(".xterm-helper-textarea");
		await textareaAfter.waitFor({ state: "attached" });
		await textareaAfter.focus();
		await page.keyboard.type(postReloadMarker);
		await page.keyboard.press("Enter");

		await expect(
			page.locator(".xterm-accessibility-tree").first(),
		).toContainText("POST_RELOAD", { timeout: 10_000 });

		await expect
			.poll(() => readShellLog(), { timeout: 5_000 })
			.toContain('"event":"renderer-reconnect-adopt"');
		await expect
			.poll(() => readShellLog(), { timeout: 5_000 })
			.toContain('"event":"terminal-binding-changed"');
	});
});
