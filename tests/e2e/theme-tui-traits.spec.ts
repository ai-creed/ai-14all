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
 * Asserts the three TUI traits ported to light/dark/warm
 * (docs/superpowers/specs/2026-06-23-tui-traits-to-all-themes-design.md):
 * square corners, Nerd Font icons, solid pane separators. Runs against the
 * #/ui-gallery route. Unlike ui-gallery.screenshots.spec.ts this IS an
 * assertion suite. Skips when the gallery route is absent.
 */
const PALETTES = ["dark", "light", "warm", "tui"] as const;

let app: ElectronApplication;
let page: Page;
let testRepo: TestRepo;
let galleryAvailable = false;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-traits-")));
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
	if (galleryAvailable) await expect(gallery).toBeVisible({ timeout: 10_000 });
});

test.afterAll(async () => {
	await closeApp(app);
	testRepo?.cleanup();
});

async function switchTheme(palette: (typeof PALETTES)[number]) {
	await page.getByTestId(`gallery-theme-${palette}`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", palette);
	await page.waitForTimeout(150);
}

for (const palette of ["light", "dark", "warm"] as const) {
	test(`${palette}: rounded-md primitives have 0px radius`, async () => {
		test.skip(!galleryAvailable, "#/ui-gallery route not present");
		await switchTheme(palette);
		const radius = await page
			.getByRole("button", { name: "Default", exact: true })
			.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
		expect(radius).toBe("0px");
	});
}

for (const palette of ["light", "dark", "warm"] as const) {
	test(`${palette}: <Icon> renders the Nerd Font glyph, hides the fallback`, async () => {
		test.skip(!galleryAvailable, "#/ui-gallery route not present");
		await switchTheme(palette);
		// The dialog close button is <Icon name="close" lucide={X}> (dialog.tsx).
		await page.getByTestId("gallery-open-dialog").click();
		const dialog = page.getByTestId("gallery-dialog-content");
		await expect(dialog).toBeVisible();

		const glyph = await dialog.locator(".app-nf").first().evaluate((el) => ({
			display: getComputedStyle(el).display,
			before: getComputedStyle(el, "::before").content,
		}));
		expect(glyph.display).toBe("inline-block");
		expect(glyph.before).not.toBe("none");
		expect(glyph.before).not.toBe('""');

		// The Lucide SVG fallback for the same icon is hidden.
		const svgDisplay = await dialog
			.locator("svg")
			.first()
			.evaluate((el) => getComputedStyle(el).display);
		expect(svgDisplay).toBe("none");

		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
	});
}

const SOLID_PANE_BORDERS = {
	light: {
		"--pane-border-sessions": "#1e78dc",
		"--pane-border-session-info": "#b4781e",
		"--pane-border-terminal": "#1ea064",
		"--pane-border-review": "#c83c50",
	},
	dark: {
		"--pane-border-sessions": "#4fb3ff",
		"--pane-border-session-info": "#f6a94a",
		"--pane-border-terminal": "#43d39e",
		"--pane-border-review": "#f36b8a",
	},
	warm: {
		"--pane-border-sessions": "#6cbcb8",
		"--pane-border-session-info": "#e49e50",
		"--pane-border-terminal": "#e28c60",
		"--pane-border-review": "#dc7a6e",
	},
} as const;

for (const palette of ["light", "dark", "warm"] as const) {
	test(`${palette}: pane-border tokens are solid (no alpha)`, async () => {
		test.skip(!galleryAvailable, "#/ui-gallery route not present");
		await switchTheme(palette);
		const tokens = await page.evaluate((names) => {
			const cs = getComputedStyle(document.documentElement);
			return Object.fromEntries(
				names.map((n) => [n, cs.getPropertyValue(n).trim()]),
			);
		}, Object.keys(SOLID_PANE_BORDERS[palette]));
		for (const [name, expected] of Object.entries(SOLID_PANE_BORDERS[palette])) {
			expect(tokens[name]).toBe(expected);
			expect(tokens[name]).not.toContain("rgba");
		}
	});
}
