import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

/**
 * Pixel-diff guardrail for the shell.css modularization (spec
 * docs/superpowers/specs/2026-07-19-shell-css-modularization-design.md §6.1)
 * and standing theme-drift guard afterwards. Unlike the *.screenshots.spec.ts
 * capture suites, this suite ASSERTS via toHaveScreenshot. Regenerate
 * baselines ONLY when a rendering change is intended:
 *
 *   pnpm test:e2e -- css-refactor.visual --update-snapshots
 */
const PALETTES = ["dark", "light", "warm", "tui"] as const;
const SURFACES = ["main", "dialog", "dropdown", "context"] as const;
type Surface = (typeof SURFACES)[number];

/**
 * Best-effort escape hatch (spec D6 / §6.1). If a single (palette, surface)
 * pair proves irreducibly flaky (fails twice in a row for reasons unrelated
 * to a CSS change), add its "palette/surface" key here — IN THE SAME COMMIT
 * as BOTH of:
 *  1) a commit-body note "manually verified: <surface> across
 *     dark/light/warm/tui" written only after actually cycling all four
 *     themes over that surface in the running app, and
 *  2) a green run of the owning feature's behavioral e2e filter.
 * One test asserts exactly one surface, so an entry skips only that pair.
 * The expected steady state is an empty set.
 */
const SKIPPED_SURFACES = new Set<string>([]);

test.describe.serial("ui gallery surfaces", () => {
	let app: ElectronApplication;
	let page: Page;
	let testRepo: TestRepo;
	let galleryAvailable = false;

	test.beforeAll(async () => {
		testRepo = createTestRepo();
		const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-cssvis-")));
		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
		await page.evaluate(() => {
			window.location.hash = "#/ui-gallery";
			window.location.reload();
		});
		const gallery = page.getByTestId("ui-gallery");
		for (let i = 0; i < 20 && (await gallery.count()) === 0; i++) {
			await page.waitForTimeout(500);
		}
		galleryAvailable = (await gallery.count()) > 0;
		if (galleryAvailable) {
			await expect(gallery).toBeVisible({ timeout: 10_000 });
		}
	});

	test.afterAll(async () => {
		await closeApp(app);
		testRepo?.cleanup();
	});

	const openSurface: Record<Surface, () => Promise<void>> = {
		main: async () => {},
		dialog: async () => {
			await page.getByTestId("gallery-open-dialog").click();
			await expect(page.getByTestId("gallery-dialog-content")).toBeVisible();
		},
		dropdown: async () => {
			await page.getByTestId("gallery-open-dropdown").click();
			await expect(page.getByTestId("gallery-dropdown-content")).toBeVisible();
		},
		context: async () => {
			await page
				.getByTestId("gallery-context-target")
				.click({ button: "right" });
			await expect(page.getByTestId("gallery-context-content")).toBeVisible();
		},
	};

	const closeSurface: Record<Surface, () => Promise<void>> = {
		main: async () => {},
		dialog: async () => {
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("gallery-dialog-content")).toHaveCount(0);
		},
		dropdown: async () => {
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("gallery-dropdown-content")).toHaveCount(
				0,
			);
		},
		context: async () => {
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("gallery-context-content")).toHaveCount(
				0,
			);
		},
	};

	for (const palette of PALETTES) {
		for (const surface of SURFACES) {
			test(`gallery — ${palette} — ${surface}`, async () => {
				test.skip(!galleryAvailable, "#/ui-gallery route not present");
				test.skip(
					SKIPPED_SURFACES.has(`${palette}/${surface}`),
					"skipped per best-effort policy — manual all-theme fallback documented in the skipping commit",
				);
				await page.getByTestId(`gallery-theme-${palette}`).click();
				await expect(page.locator("html")).toHaveAttribute(
					"data-theme",
					palette,
				);
				await page.waitForTimeout(200);

				await openSurface[surface]();
				await expect(page).toHaveScreenshot(
					`gallery-${palette}-${surface}.png`,
					surface === "main" ? { fullPage: true } : {},
				);
				await closeSurface[surface]();
			});
		}
	}
});

test.describe.serial("workspace sidebar surface", () => {
	let app: ElectronApplication;
	let page: Page;
	let testRepo: TestRepo;

	test.beforeAll(async () => {
		testRepo = createTestRepo();
		const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-cssvis-ws-")));
		app = await electron.launch({
			args: ["out/main/index.js"],
			env: {
				...process.env,
				AI14ALL_E2E: "1",
				AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
				AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
			},
		});
		page = await app.firstWindow({ timeout: 60_000 });
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		const sidebar = page.getByRole("navigation", {
			name: "Worktree sessions",
		});
		await expect(sidebar).toBeVisible({ timeout: 30_000 });
		await expect(sidebar.locator(".shell-sidebar__item").first()).toBeVisible({
			timeout: 15_000,
		});
	});

	test.afterAll(async () => {
		await closeApp(app);
		testRepo?.cleanup();
	});

	for (const palette of PALETTES) {
		test(`sidebar — ${palette}`, async () => {
			test.skip(
				SKIPPED_SURFACES.has(`sidebar/${palette}`),
				"skipped per best-effort policy — manual all-theme fallback documented in the skipping commit",
			);
			await page.evaluate(
				(t) => document.documentElement.setAttribute("data-theme", t),
				palette,
			);
			await expect(page.locator("html")).toHaveAttribute(
				"data-theme",
				palette,
			);
			await page.waitForTimeout(200);
			const sidebar = page.getByRole("navigation", {
				name: "Worktree sessions",
			});
			// createTestRepo() names the repo after its mkdtemp() suffix, which is
			// random per process — that string renders verbatim as the workspace
			// header (.shell-sidebar__workspace-name) and the main worktree's bold
			// title (first .shell-sidebar__item-head strong), so it differs from
			// the baseline on every run that isn't the exact process that recorded
			// it. Masked here (not a CSS concern) so the rest of the sidebar surface
			// — the actual regression target — still gets full pixel coverage.
			await expect(sidebar).toHaveScreenshot(`sidebar-${palette}.png`, {
				mask: [
					sidebar.locator(".shell-sidebar__workspace-name"),
					sidebar.locator(".shell-sidebar__item-head strong").first(),
					// Every ".shell-sidebar__process" line reflects a REAL spawned
					// shell, not deterministic fixture data: the process LABEL gets
					// rewritten the moment the shell reports its own OSC title
					// (e.g. `vuphan@vpmac:/private/...`, replacing the initial
					// placeholder "shell 1"), the indicator dot flips idle → active
					// at the ACTIVE_WINDOW_MS (10s) quiet boundary, and the context
					// text is either a live output preview or the ticking
					// "quiet Ns"/"quiet Nm" clock (sidebar-shell-summary.ts +
					// use-ticking-now.ts's setInterval). All three race real wall
					// clock time depending on when the screenshot lands relative to
					// process spawn — not a CSS concern. `.shell-sidebar__process`
					// is shared by the process row, the below-title session-status
					// line, AND the ready-tier inline status span, so this one
					// selector masks every live process/status line in the nav
					// without touching the static row chrome (border, background,
					// title) that this suite actually guards.
					sidebar.locator(".shell-sidebar__process"),
				],
			});
		});
	}
});
