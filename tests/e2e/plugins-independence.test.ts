import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let repo: TestRepo;
let userDataDir: string;

test.beforeAll(async () => {
	repo = createTestRepo();
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-indep-ud-")));
	// No whisper binary, no config.toml, no state root: the no-stub world.
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.locator("#repo-path").fill(repo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
}, 90_000);

test.afterAll(async () => {
	await closeApp(app);
	rmSync(userDataDir, { recursive: true, force: true });
	repo.cleanup();
});

test("no-stub world: worktree sidebar shows no plugin or workflow traces", async () => {
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav).toBeVisible();
	// When no peer (ai-whisper) is installed/enabled, nothing plugin- or
	// workflow-related may leak into the sidebar. These structural assertions
	// guard that invariant directly.
	//
	// (A full-sidebar pixel screenshot previously backed this up but was dropped:
	// it captures the sidebar at the full Electron window height, which is not
	// pinned in e2e, so the baseline rendered ~1284px locally vs ~910px on CI.
	// A deterministic, fixed-size pixel guard is the proper follow-up.)
	await expect(nav.locator(".workflow-row")).toHaveCount(0);
	await expect(nav.locator("[data-plugin-id]")).toHaveCount(0);
	await expect(nav.getByText(/whisper|collab|plugin/i)).toHaveCount(0);
});
