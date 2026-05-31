import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Locator,
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
let persistedStateDir: string;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-phase4-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_WORKSPACE_STATE_PATH: join(
				persistedStateDir,
				"workspace-state.json",
			),
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(persistedStateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Cumulative flow — Phase 4", () => {
	test("shows git context, opens a changed-file diff, and opens a nearby file", async () => {
		await page.locator("#repo-path").fill(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();

		await page
			.getByRole("navigation", { name: "Sessions" })
			.getByRole("button", { name: /feature-a/i })
			.click();

		// Chip bar replaces the top band — verify session context is visible
		await expect(page.getByRole("region", { name: "Session" })).toBeVisible();
		// Wait for the git summary to finish loading — the dirty "changed" chip
		// appears in the review chipbar once the async readSummary call resolves.
		// This also stabilises the layout so the xterm resize cycle has completed
		// before we click list items.
		await expect(
			page.getByTestId("review-chipbar").getByText(/\d+ changed/i),
		).toBeVisible({ timeout: 10_000 });

		// Slice D: the review overlay is closed on fresh sessions; open it via the
		// chipbar "Open review" button before interacting with Files/Changes/Commits tabs.
		await page
			.getByTestId("review-chipbar")
			.getByRole("button", { name: "Open review" })
			.click();
		await expect(page.getByTestId("review-expanded-portal")).toBeVisible();

		// Phase 6: wait for the default shell tab to appear before interacting
		// with the review panel. We match any tab in the terminal tablist rather
		// than the exact title "shell 1" because the xterm title changes to the
		// shell's CWD almost immediately after the shell starts.
		await expect(
			page
				.locator(".shell-terminal-slot:not(.shell-terminal-slot--empty)")
				.first(),
		).toBeVisible({ timeout: 10_000 });

		// Interactions are scoped to the review rail and gated on readiness rather
		// than forced. `force:true` was previously used on the theory that the
		// adjacent xterm pane kept the a11y tree in flux — but force DISABLES
		// Playwright's auto-scroll and clicks transitional UI, which is what
		// actually flaked here: clicking a changed-file row before the async git
		// list rendered, or a target pushed below the fold by xterm layout.
		// Scoping to `review-rail` (a stable panel separate from the xterm) plus
		// explicit visibility/selection gates lets normal actionability +
		// auto-retry absorb any residual churn.
		const rail = page.getByTestId("review-rail");
		const clickWhenReady = async (locator: Locator) => {
			await expect(locator).toBeVisible();
			await locator.click();
		};

		const changesTab = rail.getByRole("tab", { name: "Changes" });
		await clickWhenReady(changesTab);
		await expect(changesTab).toHaveAttribute("aria-selected", "true");
		await clickWhenReady(rail.getByRole("button", { name: /src\/index\.ts/ }));
		await expect(page.getByText("Diff vs HEAD")).toBeVisible();

		const filesTab = rail.getByRole("tab", { name: "Files" });
		await clickWhenReady(filesTab);
		await expect(filesTab).toHaveAttribute("aria-selected", "true");
		await clickWhenReady(
			rail.getByRole("button", { name: "src", exact: true }),
		);
		await clickWhenReady(rail.getByRole("button", { name: "new-file.ts" }));
		await expect(
			page.locator(".shell-viewer__title").getByText("src/new-file.ts", {
				exact: true,
			}),
		).toBeVisible();
	});
});
