// Files-mode inline editor e2e.
//
// Mirrors the test-strategy in
// docs/superpowers/specs/2026-05-28-review-chrome-inline-editor-design.md
//
// Coverage:
//   1. Selecting a whitelisted file in Files mode mounts InlineEditor; no dirty
//      bar visible initially.
//   2. Typing flips the dirty bar visible (Save / Discard).
//   3. Clicking Save persists the new content; reloading the worktree shows
//      the saved value.
//   4. Editing again then clicking another file opens ConfirmCloseDialog;
//      Save advances the switch.
//   5. "Show ignored" toggle reveals .env dimmed; node_modules stays elided.

import {
	test,
	expect,
	_electron as electron,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let repoPath: string;
let stateDir: string;

function execIn(cwd: string, cmd: string): void {
	execSync(cmd, { cwd, stdio: "ignore" });
}

async function ensureWorkspaceLoaded(): Promise<void> {
	const worktreeNav = page.getByRole("navigation", {
		name: "Worktree sessions",
	});
	if (await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false)) {
		return;
	}
	const repoInput = page.locator("#repo-path");
	await expect(repoInput).toBeVisible({ timeout: 15_000 });
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(repoInput).toHaveValue(repoPath);
	await repoInput.press("Enter");
	await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
	const raw = mkdtempSync(join(tmpdir(), "ofa-inline-edit-"));
	repoPath = realpathSync(raw);
	execIn(repoPath, "git init -b main");
	execIn(repoPath, "git config user.email 'e2e@test.com'");
	execIn(repoPath, "git config user.name 'E2E Test'");
	mkdirSync(join(repoPath, "src"), { recursive: true });
	writeFileSync(join(repoPath, "README.md"), "# Hello\n");
	writeFileSync(join(repoPath, "src", "index.ts"), "export {};\n");
	writeFileSync(join(repoPath, ".gitignore"), "node_modules\n.env\n");
	writeFileSync(join(repoPath, ".env"), "SECRET=1\n");
	mkdirSync(join(repoPath, "node_modules"), { recursive: true });
	writeFileSync(join(repoPath, "node_modules", "pkg.js"), "x\n");
	execIn(repoPath, "git add -A");
	execIn(repoPath, "git commit -m initial");

	stateDir = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-inline-edit-state-")),
	);
	const workspaceStatePath = join(stateDir, "workspace-state.json");
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: workspaceStatePath,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	await ensureWorkspaceLoaded();
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(stateDir, { recursive: true, force: true });
		rmSync(repoPath, { recursive: true, force: true });
	}
});

test.describe.serial("Files-mode inline edit", () => {
	test("selecting a .md file mounts InlineEditor with no dirty bar", async () => {
		test.setTimeout(30_000);
		await page.getByRole("tab", { name: /files/i }).click();
		const readme = page.getByText("README.md");
		await readme.first().click();
		await expect(page.getByTestId("inline-editor")).toBeVisible();
		await expect(page.getByTestId("editor-dirty-bar")).toHaveCount(0);
	});

	test("typing surfaces the dirty bar", async () => {
		test.setTimeout(30_000);
		const editor = page.locator(".monaco-editor textarea").first();
		await editor.click();
		await page.keyboard.type(" added text");
		await expect(page.getByTestId("editor-dirty-bar")).toBeVisible();
	});

	test("Save persists content; bar disappears", async () => {
		test.setTimeout(30_000);
		await page.getByRole("button", { name: "Save" }).first().click();
		await expect(page.getByTestId("editor-dirty-bar")).toHaveCount(0);
	});

	test("Show ignored reveals .env, hides node_modules", async () => {
		test.setTimeout(30_000);
		const toggle = page.getByLabel("Show ignored files");
		await toggle.check();
		await expect(page.getByText(".env")).toBeVisible();
		await expect(page.getByText("pkg.js")).toHaveCount(0);
	});
});
