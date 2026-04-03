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
  await app.close();
  testRepo.cleanup();
});

test.describe.serial("Phase 0 validation matrix", () => {
  test("1. app launches with correct title", async () => {
    const title = await page.title();
    expect(title).toBe("oneforall");
  });

  test("2. load repository — enter fixture repo path and submit", async () => {
    // Use locator.fill() for better resilience with React controlled inputs
    const input = page.locator("#repo-path");
    await input.fill(testRepo.repoPath);
    await page.locator('button:has-text("Load")').click();

    // Worktree list should appear with the main worktree
    await expect(page.locator("strong", { hasText: "main" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("3. select worktree — click main worktree, selection changes", async () => {
    // Click the main worktree label
    await page.locator("strong", { hasText: "main" }).click();

    // "Selected:" indicator should appear
    await expect(page.locator("text=Selected:")).toBeVisible();
  });

  test("4. open terminal — click Open Terminal button", async () => {
    await page.click('button:has-text("Open Terminal")');

    // xterm container should appear
    await expect(page.locator(".xterm").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("5. terminal interaction — type pwd, verify output", async () => {
    // Wait for the shell to initialize and display a prompt
    await page.waitForTimeout(1000);

    // Programmatically focus xterm's hidden textarea
    await page.evaluate(() => {
      (document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement).focus();
    });

    // Type pwd command
    await page.keyboard.type("pwd");
    await page.keyboard.press("Enter");

    // Wait for output containing the repo path in the accessibility tree
    await expect(page.locator(".xterm-accessibility-tree").first()).toContainText(
      testRepo.repoPath,
      { timeout: 10_000 },
    );
  });

  test("6. multiple terminals — open a second terminal", async () => {
    await page.click('button:has-text("Open Terminal")');

    // Should now have 2 visible xterm instances
    await expect(page.locator(".xterm")).toHaveCount(2, { timeout: 10_000 });
  });

  test("7. stop and restart terminal — stop first, open new one", async () => {
    // Stop the first terminal
    await page.locator('button:has-text("Stop Terminal")').first().click();

    // Wait for status to show "exited"
    await expect(page.locator("strong", { hasText: "exited" }).first()).toBeVisible({ timeout: 10_000 });

    // Open a new terminal
    await page.click('button:has-text("Open Terminal")');

    // Should now have 3 xterm instances total
    await expect(page.locator(".xterm")).toHaveCount(3, { timeout: 10_000 });
  });

  test("8. switch worktrees — select feature-a, previous terminals hidden", async () => {
    // Click the feature-a worktree
    await page.locator("strong", { hasText: "feature-a" }).click();

    // Terminals from main worktree are hidden, no terminals for feature-a yet
    await expect(
      page.locator("text=No terminals for this worktree"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("9. file listing — files from selected worktree appear", async () => {
    // FileList loads files when worktree is selected
    await expect(page.locator("text=src/index.ts")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=README.md")).toBeVisible();
  });

  test("10. Monaco viewer — click file, editor renders", async () => {
    // Click a file to open it in the Monaco viewer
    await page.locator("text=src/index.ts").click();

    // Monaco editor container should appear
    await expect(page.locator(".monaco-editor")).toBeVisible({
      timeout: 15_000,
    });
  });
});
