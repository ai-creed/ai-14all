import {
	test,
	expect,
	_electron as electron,
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
let persistedStatePath: string;

function worktreeNav() {
	return page.getByRole("navigation", { name: "Worktree sessions" });
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-chip-bar-")));
	persistedStatePath = join(stateDir, "workspace-state.json");

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
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(testRepo.repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	await expect(
		worktreeNav().getByRole("button", { name: /main/i }),
	).toBeVisible({ timeout: 15_000 });

	// Select the session so the chip bar is rendered
	await worktreeNav().getByRole("button", { name: /main/i }).click();
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

test.describe("Session chip bar", () => {
	test("chip bar is visible after session loads", async () => {
		await expect(page.getByRole("region", { name: "Session" })).toBeVisible();
	});

	test("chip bar shows worktree label as session title when no custom title", async () => {
		await expect(page.getByRole("region", { name: "Session" })).toContainText(
			"main",
		);
	});

	test("rename via chip bar focuses rail rename input", async () => {
		await page.getByRole("button", { name: /rename session/i }).click();
		await expect(
			page.getByRole("textbox", { name: /rename session/i }),
		).toBeVisible();
		await page.keyboard.press("Escape");
	});

	test("note sheet opens and closes from chip bar Note button", async () => {
		await page.getByRole("button", { name: /open note/i }).click();
		await expect(
			page.getByRole("dialog", { name: /session note/i }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", { name: /session note/i }),
		).not.toBeVisible();
	});

	test("note typed in sheet persists after close and reopen", async () => {
		await page.getByRole("button", { name: /open note/i }).click();
		await page
			.getByRole("textbox", { name: /session note/i })
			.fill("e2e note text");
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: /open note/i }).click();
		await expect(
			page.getByRole("textbox", { name: /session note/i }),
		).toHaveValue("e2e note text");
		// cleanup
		await page.getByRole("textbox", { name: /session note/i }).fill("");
		await page.keyboard.press("Escape");
	});

	test("note sheet previews markdown and returns to editing", async () => {
		await page.getByRole("button", { name: /open note/i }).click();
		await page
			.getByRole("textbox", { name: /session note/i })
			.fill("## E2E Finding\n\n- Rendered item");

		await page.getByRole("button", { name: "Preview" }).click();

		await expect(
			page.getByRole("region", { name: /session note preview/i }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "E2E Finding", level: 2 }),
		).toBeVisible();
		await expect(page.getByText("Rendered item")).toBeVisible();
		await expect(
			page.getByRole("textbox", { name: /session note/i }),
		).not.toBeVisible();

		await page.getByRole("button", { name: "Edit" }).click();

		await expect(
			page.getByRole("textbox", { name: /session note/i }),
		).toHaveValue("## E2E Finding\n\n- Rendered item");
		await page.getByRole("textbox", { name: /session note/i }).fill("");
		await page.keyboard.press("Escape");
	});

	test("note indicator appears after typing in sheet", async () => {
		await page.getByRole("button", { name: /open note/i }).click();
		await page
			.getByRole("textbox", { name: /session note/i })
			.fill("indicator test");
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("button", { name: /open note/i }),
		).toHaveAttribute("data-indicator", "true");
		// cleanup
		await page.getByRole("button", { name: /open note/i }).click();
		await page.getByRole("textbox", { name: /session note/i }).fill("");
		await page.keyboard.press("Escape");
	});

	test("note indicator disappears after clearing note", async () => {
		await page.getByRole("button", { name: /open note/i }).click();
		await page.getByRole("textbox", { name: /session note/i }).fill("");
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("button", { name: /open note/i }),
		).toHaveAttribute("data-indicator", "false");
	});

	test("note sheet opens via keyboard shortcut when terminal is not focused", async () => {
		await page.getByRole("button", { name: /open note/i }).focus();
		const isMac = process.platform === "darwin";
		await page.keyboard.press(isMac ? "Meta+;" : "Control+;");
		await expect(
			page.getByRole("dialog", { name: /session note/i }),
		).toBeVisible();
		await page.keyboard.press("Escape");
	});

	test("Commands button opens the command palette", async () => {
		await page.getByRole("button", { name: /open command palette/i }).click();
		await expect(page.getByTestId("command-palette")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("command-palette")).toHaveCount(0);
	});

	test("help button opens the keyboard shortcuts dialog", async () => {
		await worktreeNav()
			.getByRole("button", { name: /keyboard shortcuts/i })
			.click();
		await expect(page.getByTestId("shortcuts-help")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
	});

	test("dirty chip and review expansion — manual smoke only", async () => {
		test.skip(
			true,
			"Requires dirty worktree setup — cover in manual smoke pass.",
		);
	});
});
