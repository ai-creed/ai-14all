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

test("no-stub world: worktree sidebar is pixel-identical and trace-free", async () => {
	const nav = page.getByRole("navigation", { name: "Worktree sessions" });
	await expect(nav).toBeVisible();
	// Structural no-trace assertions:
	await expect(nav.locator(".workflow-row")).toHaveCount(0);
	await expect(nav.locator("[data-plugin-id]")).toHaveCount(0);
	await expect(nav.getByText(/whisper|collab|plugin/i)).toHaveCount(0);
	// Pixel invariance: baseline recorded on the pre-renderer-change build,
	// guarded for every later task. Animations disabled so the snapshot is
	// stable regardless of any in-flight transitions. The workspace name and
	// per-session process list echo the randomized temp-repo path/dir name
	// (a fresh mkdtemp per run), so they are masked — every other pixel,
	// including the spot where a plugin/workflow row would land, is guarded.
	await expect(nav).toHaveScreenshot("worktree-sidebar-no-plugins.png", {
		animations: "disabled",
		mask: [
			nav.locator(".shell-sidebar__workspace-name"),
			nav.locator(".shell-sidebar__processes"),
			// Session titles default to the worktree dir (`ofa-e2e-<rand>` /
			// `feature-a`), so the active row's <strong> title echoes the random
			// temp name too.
			nav.locator(".shell-sidebar__item strong"),
		],
	});
});
