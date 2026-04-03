import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";

let app: ElectronApplication;
let page: Page;
let testRepo: TestRepo;

test.beforeAll(async () => {
  testRepo = createTestRepo();
  app = await electron.launch({ args: ["out/main/index.js"] });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  try {
    if (app) await app.close();
  } finally {
    testRepo?.cleanup();
  }
});

test.describe.serial("Phase 2 session-first workflow", () => {
  test("loads the repository and shows the session shell", async () => {
    await page.locator("#repo-path").fill(testRepo.repoPath);
    await page.locator('button:has-text("Load")').click();

    await expect(page.locator('button:has-text("main")')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=Active branch")).toBeVisible();
  });

  test("opens multiple terminal tabs for the selected worktree", async () => {
    await page.locator('button:has-text("main")').click();
    await page.locator('button[aria-label="New terminal"]').click();
    await page.locator('button[aria-label="New terminal"]').click();

    await expect(page.locator('button:has-text("shell 1")')).toBeVisible();
    await expect(page.locator('button:has-text("shell 2")')).toBeVisible();
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 10_000 });
  });

  test("switches worktrees and restores the per-session note", async () => {
    await page.getByLabel("Session note").fill("Main session note");
    await page.locator('button:has-text("feature-a")').click();
    await page.getByLabel("Session note").fill("Feature note");
    await page.locator('button:has-text("main")').click();

    await expect(page.getByLabel("Session note")).toHaveValue(
      "Main session note",
    );
  });

  test("shows changed files and opens a unified diff", async () => {
    await page.locator('button:has-text("feature-a")').click();
    await page.locator('button:has-text("Changes")').click();

    // Wait for the changes list to populate, then click the changed file
    const changedFileButton = page.getByRole("button", { name: /src\/index\.ts/ });
    await changedFileButton.click();

    await expect(page.locator(".monaco-editor")).toBeVisible({
      timeout: 15_000,
    });
    // Verify the diff content contains a diff header
    await expect(page.locator("text=diff --git")).toBeVisible();
  });
});
