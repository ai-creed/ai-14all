/**
 * E2E tests for Files-mode viewer previews (Task 15).
 *
 * Coverage:
 *   - Selecting a .md file defaults to the rendered markdown preview
 *     (.shell-md-preview, a GFM table renders, no Monaco mounted).
 *   - The [Preview │ Source] header toggle switches into the in-place editor;
 *     typing marks it dirty; switching back to Preview while dirty routes
 *     through InlineEditor's requestSwitch() dirty-guard (ConfirmCloseDialog);
 *     Cancel keeps Source active.
 *   - Selecting an image renders read-only via ImagePreview
 *     (img.shell-image-preview__img with a data: URI), no Monaco.
 *
 * Mirrors the launch/seed conventions in files-mode-inline-edit.spec.ts and
 * review-comments.test.ts: electron.launch → Browse/Load → feature-a worktree
 * → ensureReviewOverlayOpen → Files tab.
 */

import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";
import { ensureReviewOverlayOpen } from "./helpers/review-overlay";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let stateDir: string;

// Smallest valid PNG (1x1 black pixel) — real magic bytes + IHDR/IDAT/IEND
// chunks so <img onError> does not fire in Chromium. Widely used as a minimal
// test fixture PNG.
const MIN_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const README_WITH_TABLE = `# Preview Test

A GFM table for markdown-preview e2e coverage:

| Name | Kind |
| --- | --- |
| README.md | markdown |
| logo.png | image |

- first bullet
- second bullet

\`\`\`js
const answer = 42;
\`\`\`
`;

test.beforeAll(async () => {
	testRepo = createTestRepo();
	// Seed a GFM-table README and a real (decodable) PNG into the feature-a
	// worktree. Both filenames already exist in create-test-repo's default
	// fixture (README.md is checked out from the initial commit; logo.png is
	// a fake-bytes placeholder for an unrelated whitelist test) — this repo
	// instance is private to this spec file, so overwriting them here does
	// not affect any other suite.
	writeFileSync(join(testRepo.worktreePath, "README.md"), README_WITH_TABLE);
	writeFileSync(
		join(testRepo.worktreePath, "logo.png"),
		Buffer.from(MIN_PNG_BASE64, "base64"),
	);

	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-viewer-previews-")));
	const workspaceStatePath = join(stateDir, "workspace-state.json");
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: workspaceStatePath,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await page.waitForFunction(() => "ai14all" in window, null, {
		timeout: 30_000,
	});
	page.setDefaultTimeout(60_000);
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test.describe.serial("Files-mode viewer previews", () => {
	test("loads the repo and navigates to Files tab on feature-a", async () => {
		test.setTimeout(60_000);
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
		await page.getByRole("button", { name: "Load" }).click();
		const featureA = page
			.getByRole("navigation", { name: "Worktree sessions" })
			.getByRole("button", { name: "feature-a", exact: true });
		await expect(featureA).toBeVisible({ timeout: 15_000 });
		await featureA.click();
		await ensureReviewOverlayOpen(page);
		await page.getByRole("tab", { name: "Files" }).click({ force: true });
		const readmeRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^README\.md/ });
		await expect(readmeRow).toBeVisible({ timeout: 15_000 });
	});

	test("selecting README.md defaults to a rendered markdown preview with a GFM table, no Monaco", async () => {
		test.setTimeout(30_000);
		const readmeRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^README\.md/ });
		await readmeRow.click();

		const preview = page.locator(".shell-md-preview");
		await expect(preview).toBeVisible({ timeout: 10_000 });
		await expect(preview.locator("table")).toBeVisible({ timeout: 10_000 });
		await expect(page.locator(".monaco-editor")).toHaveCount(0);
	});

	test("markdown preview typography and themed code blocks (readability spec)", async () => {
		test.setTimeout(30_000);
		// Reuse the already-open preview from the seeded README (same navigation
		// as the default-preview test: Files tab → README.md row).
		const body = page.locator(".shell-md-body");
		await expect(body).toBeVisible();

		// D18: prose uses the reading font; code keeps the terminal font.
		await page.evaluate(() => document.fonts.ready);
		const bodyFont = await body.evaluate(
			(el) => getComputedStyle(el).fontFamily,
		);
		expect(bodyFont).toContain("Hanken Grotesk Variable");
		const codeFont = await page
			.locator(".shell-md-body pre code")
			.first()
			.evaluate((el) => getComputedStyle(el).fontFamily);
		expect(codeFont).not.toContain("Hanken Grotesk Variable");

		// D6: heading hierarchy restored (h1 renders larger than body text).
		const h1Size = await page
			.locator(".shell-md-body h1")
			.first()
			.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		const bodySize = await body.evaluate((el) =>
			parseFloat(getComputedStyle(el).fontSize),
		);
		expect(h1Size).toBeGreaterThan(bodySize);

		// D8: list markers restored.
		const listStyle = await page
			.locator(".shell-md-body ul")
			.first()
			.evaluate((el) => getComputedStyle(el).listStyleType);
		expect(listStyle).toBe("disc");

		// D14: the vendored github-dark box (#0d1117) is gone. The <pre> owns the
		// visual box (spec D14), so assert the box element itself — and the inner
		// code.hljs must be transparent so no second box can reappear inside it.
		const preBg = await page
			.locator(".shell-md-body pre")
			.first()
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(preBg).not.toBe("rgb(13, 17, 23)");
		const codeBg = await page
			.locator(".shell-md-body pre code")
			.first()
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(codeBg).toBe("rgba(0, 0, 0, 0)"); // computed "transparent"

		// D16/T5: token indirection — keyword color changes with the theme.
		// use-theme.ts applies an explicit data-theme at boot from the
		// persisted/system theme, so force "dark" (matches no tokens.css
		// override block → :root dark tokens apply) for a deterministic
		// baseline instead of trusting the ambient boot theme, then restore
		// the boot attribute afterwards — removeAttribute would leave a state
		// React's theme effect (keyed on an unchanged mode) never re-applies.
		const keyword = page.locator(".shell-md-body .hljs-keyword").first();
		await expect(keyword).toBeVisible();
		const bootTheme = await page.evaluate(() =>
			document.documentElement.getAttribute("data-theme"),
		);
		await page.evaluate(() =>
			document.documentElement.setAttribute("data-theme", "dark"),
		);
		const darkColor = await keyword.evaluate(
			(el) => getComputedStyle(el).color,
		);
		await page.evaluate(() =>
			document.documentElement.setAttribute("data-theme", "light"),
		);
		const lightColor = await keyword.evaluate(
			(el) => getComputedStyle(el).color,
		);
		await page.evaluate((theme) => {
			if (theme === null) {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.setAttribute("data-theme", theme);
			}
		}, bootTheme);
		expect(lightColor).not.toBe(darkColor);
	});

	test("clicking Source mounts Monaco", async () => {
		test.setTimeout(30_000);
		await page.getByRole("button", { name: "Source" }).click();
		await expect(page.locator(".monaco-editor")).toHaveCount(1, {
			timeout: 10_000,
		});
		await expect(page.getByTestId("inline-editor")).toBeVisible();
	});

	test("typing marks dirty; switching to Preview opens the dirty-guard dialog; Cancel keeps Source", async () => {
		test.setTimeout(30_000);
		// Click the editor body (not the IME-proxy textarea) — the view-lines
		// region focuses the real input without colliding with Monaco's
		// pointer-intercepting overlays.
		const editorBody = page.locator(".monaco-editor .view-lines").first();
		await editorBody.click();
		await page.keyboard.press("Meta+End");
		await page.keyboard.type("!");
		await expect(page.getByTestId("editor-dirty-bar")).toBeVisible({
			timeout: 5_000,
		});

		await page.getByRole("button", { name: "Preview" }).click();
		await expect(
			page.getByRole("heading", { name: /unsaved changes/i }),
		).toBeVisible({ timeout: 5_000 });

		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page.getByRole("heading", { name: /unsaved changes/i }),
		).toHaveCount(0, { timeout: 5_000 });

		// Cancel must keep Source active — Monaco (and the dirty bar) still shown.
		await expect(page.locator(".monaco-editor")).toHaveCount(1);
		await expect(page.getByTestId("editor-dirty-bar")).toBeVisible();
		await expect(page.getByRole("button", { name: "Source" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// Clean up: discard the typed edit so README.md is no longer dirty.
		// Otherwise the next test's file-tree click (a different file) would
		// hit the SAME requestSwitch dirty-guard this test just exercised, via
		// FilesPane's requestFileSwitch — an unrelated dialog the next test
		// doesn't handle.
		await page
			.getByTestId("editor-dirty-bar")
			.getByRole("button", { name: /discard/i })
			.click();
		await expect(page.getByTestId("editor-dirty-bar")).toHaveCount(0, {
			timeout: 5_000,
		});
	});

	test("selecting logo.png renders the image preview with a data:image/png src, no Monaco", async () => {
		test.setTimeout(30_000);
		const logoRow = page
			.locator(".shell-list__item--tree")
			.filter({ hasText: /^logo\.png/ });
		await logoRow.click();

		const img = page.locator("img.shell-image-preview__img");
		await expect(img).toBeVisible({ timeout: 10_000 });
		await expect(img).toHaveAttribute("src", /^data:image\/png/);
		await expect(page.locator(".monaco-editor")).toHaveCount(0);
	});
});
