# Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright e2e tests and Vitest + Testing Library component tests to cover the Phase 0 validation matrix.

**Architecture:** Playwright launches the real Electron app against a temporary git fixture repo to validate the full stack. Component tests use `vi.mock` to replace `src/lib/desktop-client` at the module level, isolating React components from Electron/IPC. Monaco Editor is also mocked since jsdom cannot host it.

**Tech Stack:** @playwright/test, Vitest, @testing-library/react, @testing-library/jest-dom, jsdom

---

## File Structure

```
playwright.config.ts                                # NEW — Playwright config at project root
tests/
  setup.ts                                          # NEW — jest-dom matchers for Vitest
  e2e/
    fixtures/
      create-test-repo.ts                           # NEW — temp git repo with worktrees
    app-flow.test.ts                                # NEW — 10 e2e test cases
  unit/
    services/                                       # MOVED from tests/services/
      worktrees/
        parse-worktree-porcelain.test.ts            # MOVED — import paths updated
        worktree-service.test.ts                    # MOVED — import paths updated
      files/
        file-service.test.ts                        # MOVED — import paths updated
    components/                                     # NEW
      RepositoryInput.test.tsx                      # NEW
      WorktreeList.test.tsx                         # NEW
      FileList.test.tsx                             # NEW
      FileViewer.test.tsx                           # NEW
```

**Modified files:**
- `vitest.config.ts` — add `include`, `setupFiles`, exclude e2e directory
- `package.json` — add `@playwright/test` dev dep, add `test:e2e` and `test:all` scripts

---

### Task 1: Reorganize Test Directories and Update Vitest Config

**Files:**
- Move: `tests/services/` → `tests/unit/services/`
- Modify: `tests/unit/services/worktrees/parse-worktree-porcelain.test.ts` (import path)
- Modify: `tests/unit/services/worktrees/worktree-service.test.ts` (import path)
- Modify: `tests/unit/services/files/file-service.test.ts` (import path)
- Create: `tests/setup.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Move tests/services to tests/unit/services**

```bash
mkdir -p tests/unit
mv tests/services tests/unit/services
```

- [ ] **Step 2: Update import paths in parse-worktree-porcelain.test.ts**

In `tests/unit/services/worktrees/parse-worktree-porcelain.test.ts`, change:

```ts
// OLD
import { parseWorktreePorcelain } from "../../../services/worktrees/parse-worktree-porcelain.js";
// NEW
import { parseWorktreePorcelain } from "../../../../services/worktrees/parse-worktree-porcelain.js";
```

- [ ] **Step 3: Update import paths in worktree-service.test.ts**

In `tests/unit/services/worktrees/worktree-service.test.ts`, change:

```ts
// OLD
import { WorktreeService } from "../../../services/worktrees/worktree-service.js";
// NEW
import { WorktreeService } from "../../../../services/worktrees/worktree-service.js";
```

- [ ] **Step 4: Update import paths in file-service.test.ts**

In `tests/unit/services/files/file-service.test.ts`, change:

```ts
// OLD
import { FileService } from "../../../services/files/file-service.js";
// NEW
import { FileService } from "../../../../services/files/file-service.js";
```

- [ ] **Step 5: Create tests/setup.ts**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Update vitest.config.ts**

Replace the full file content:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
});
```

- [ ] **Step 7: Run tests to verify nothing is broken**

Run: `pnpm test`

Expected: All 11 existing tests pass (3 parser, 4 worktree service, 4 file service).

- [ ] **Step 8: Commit**

```bash
git add tests/unit tests/setup.ts vitest.config.ts
git rm -r --cached tests/services 2>/dev/null || true
git commit -m "refactor: reorganize tests under tests/unit and add jest-dom setup"
```

---

### Task 2: Install Playwright and Create Configuration

**Files:**
- Modify: `package.json` (add dep + scripts)
- Create: `playwright.config.ts`

- [ ] **Step 1: Install @playwright/test**

```bash
pnpm add -D @playwright/test
```

- [ ] **Step 2: Add test:e2e and test:all scripts to package.json**

In `package.json`, add to the `"scripts"` block:

```json
"test:e2e": "electron-vite build && playwright test",
"test:all": "pnpm test && pnpm test:e2e"
```

- [ ] **Step 3: Create playwright.config.ts at project root**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
});
```

- [ ] **Step 4: Verify Playwright is installed**

Run: `npx playwright --version`

Expected: Prints Playwright version without errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts
git commit -m "chore: install playwright and add e2e test configuration"
```

---

### Task 3: Create E2E Test Fixture Helper

**Files:**
- Create: `tests/e2e/fixtures/create-test-repo.ts`

- [ ] **Step 1: Create the fixture helper**

Create `tests/e2e/fixtures/create-test-repo.ts`:

```ts
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export type TestRepo = {
  repoPath: string;
  worktreePath: string;
  cleanup: () => void;
};

/**
 * Creates a temporary git repository with:
 * - An initial commit containing src/index.ts and README.md
 * - One linked worktree on a "feature-a" branch
 *
 * Uses realpathSync so paths match macOS resolved symlinks (e.g. /private/var).
 */
export function createTestRepo(): TestRepo {
  const raw = mkdtempSync(join(tmpdir(), "ofa-e2e-"));
  const repoPath = realpathSync(raw);

  // Initialize repo
  execSync("git init", { cwd: repoPath, stdio: "ignore" });
  execSync("git config user.email 'e2e@test.com'", {
    cwd: repoPath,
    stdio: "ignore",
  });
  execSync("git config user.name 'E2E Test'", {
    cwd: repoPath,
    stdio: "ignore",
  });

  // Create source files
  mkdirSync(join(repoPath, "src"), { recursive: true });
  writeFileSync(
    join(repoPath, "src", "index.ts"),
    'export const hello = "world";\n',
  );
  writeFileSync(join(repoPath, "README.md"), "# Test Repo\n");

  // Initial commit
  execSync("git add -A", { cwd: repoPath, stdio: "ignore" });
  execSync('git commit -m "initial commit"', {
    cwd: repoPath,
    stdio: "ignore",
  });

  // Create linked worktree on feature-a branch
  execSync("git branch feature-a", { cwd: repoPath, stdio: "ignore" });
  const worktreeDir = join(repoPath, ".worktrees", "feature-a");
  mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
  execSync(`git worktree add "${worktreeDir}" feature-a`, {
    cwd: repoPath,
    stdio: "ignore",
  });
  const worktreePath = realpathSync(worktreeDir);

  return {
    repoPath,
    worktreePath,
    cleanup: () => {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: repoPath,
          stdio: "ignore",
        });
      } catch {
        // worktree may already be removed
      }
      rmSync(repoPath, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/fixtures/create-test-repo.ts
git commit -m "feat: add e2e test fixture helper for temp git repos"
```

---

### Task 4: Write E2E App-Flow Tests

**Files:**
- Create: `tests/e2e/app-flow.test.ts`

**Prerequisites:** The app must build successfully with `electron-vite build` before these tests can run. Verify by running `pnpm build` first.

**Note on terminal text assertions:** xterm.js v5 renders to canvas. The `toContainText` assertion relies on xterm's accessibility live region (`aria-live="assertive"`) to expose text to Playwright. If terminal text assertions fail, the fix is to add `screenReaderMode: true` to the Terminal options in `src/features/terminals/TerminalPane.tsx`.

- [ ] **Step 1: Create tests/e2e/app-flow.test.ts**

```ts
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
    await page.fill("#repo-path", testRepo.repoPath);
    await page.click('button:has-text("Load")');

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
    // Click the xterm area to focus it
    await page.locator(".xterm").first().click();

    // Type pwd command
    await page.keyboard.type("pwd\n");

    // Wait for output containing the repo path
    // xterm exposes text via its accessibility live region
    await expect(page.locator(".xterm").first()).toContainText(
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
    await expect(page.locator("text=exited")).toBeVisible({ timeout: 10_000 });

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
```

- [ ] **Step 2: Build the app**

Run: `pnpm build`

Expected: Build completes without errors, `out/` directory contains main/preload/renderer.

- [ ] **Step 3: Run e2e tests**

Run: `npx playwright test`

Expected: All 10 tests pass. If terminal text assertions (test 5) fail due to canvas rendering, add `screenReaderMode: true` to the Terminal constructor options in `src/features/terminals/TerminalPane.tsx:28`:

```ts
const term = new Terminal({ cursorBlink: true, scrollback: 1000, screenReaderMode: true });
```

Then rebuild (`pnpm build`) and re-run.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/app-flow.test.ts
git commit -m "test: add playwright e2e tests for phase 0 validation matrix"
```

---

### Task 5: Write RepositoryInput Component Test

**Files:**
- Create: `tests/unit/components/RepositoryInput.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/unit/components/RepositoryInput.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Repository } from "../../../shared/models/repository";
import type { Worktree } from "../../../shared/models/worktree";

vi.mock("../../../src/lib/desktop-client", () => ({
  repository: {
    setRoot: vi.fn(),
    listWorktrees: vi.fn(),
  },
}));

import { RepositoryInput } from "../../../src/features/repository/RepositoryInput";
import { repository } from "../../../src/lib/desktop-client";

const mockSetRoot = vi.mocked(repository.setRoot);
const mockListWorktrees = vi.mocked(repository.listWorktrees);

const fakeRepo: Repository = { id: "r1", name: "test-repo", rootPath: "/test" };
const fakeWorktrees: Worktree[] = [
  {
    id: "/test",
    repositoryId: "r1",
    branchName: "main",
    path: "/test",
    label: "main",
    isMain: true,
  },
];

describe("RepositoryInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders input and submit button", () => {
    render(<RepositoryInput onLoad={vi.fn()} />);

    expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();
  });

  it("calls setRoot then listWorktrees on submit", async () => {
    mockSetRoot.mockResolvedValueOnce(fakeRepo);
    mockListWorktrees.mockResolvedValueOnce(fakeWorktrees);
    const onLoad = vi.fn();

    render(<RepositoryInput onLoad={onLoad} />);

    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "/test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    await waitFor(() => {
      expect(mockSetRoot).toHaveBeenCalledWith("/test");
      expect(mockListWorktrees).toHaveBeenCalled();
      expect(onLoad).toHaveBeenCalledWith(fakeRepo, fakeWorktrees);
    });
  });

  it("shows error text when setRoot rejects", async () => {
    mockSetRoot.mockRejectedValueOnce(new Error("Not a git repository"));

    render(<RepositoryInput onLoad={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "/bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    await waitFor(() => {
      expect(screen.getByText("Error: Not a git repository")).toBeInTheDocument();
    });
  });

  it("shows loading state during submission", async () => {
    // Mock that never resolves — keeps component in loading state
    mockSetRoot.mockReturnValue(new Promise(() => {}));

    render(<RepositoryInput onLoad={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Repository path"), {
      target: { value: "/test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Loading…" }),
      ).toBeDisabled();
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- tests/unit/components/RepositoryInput.test.tsx`

Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/RepositoryInput.test.tsx
git commit -m "test: add RepositoryInput component tests"
```

---

### Task 6: Write WorktreeList Component Test

**Files:**
- Create: `tests/unit/components/WorktreeList.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/unit/components/WorktreeList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorktreeList } from "../../../src/features/worktrees/WorktreeList";
import type { Worktree } from "../../../shared/models/worktree";

const worktrees: Worktree[] = [
  {
    id: "/repo/main",
    repositoryId: "r1",
    branchName: "main",
    path: "/repo/main",
    label: "main",
    isMain: true,
  },
  {
    id: "/repo/.worktrees/feature-a",
    repositoryId: "r1",
    branchName: "feature-a",
    path: "/repo/.worktrees/feature-a",
    label: "feature-a",
    isMain: false,
  },
];

describe("WorktreeList", () => {
  it("renders worktree labels, branch names, and paths", () => {
    render(
      <WorktreeList
        worktrees={worktrees}
        selectedWorktreeId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Branch: main")).toBeInTheDocument();
    expect(screen.getByText("/repo/main")).toBeInTheDocument();

    expect(screen.getByText("feature-a")).toBeInTheDocument();
    expect(screen.getByText("Branch: feature-a")).toBeInTheDocument();
    expect(screen.getByText("/repo/.worktrees/feature-a")).toBeInTheDocument();
  });

  it("highlights the selected worktree", () => {
    const { container } = render(
      <WorktreeList
        worktrees={worktrees}
        selectedWorktreeId="/repo/main"
        onSelect={vi.fn()}
      />,
    );

    const items = container.querySelectorAll("li");
    // Selected item has a visible border (1px solid #666)
    expect(items[0].style.border).toBe("1px solid #666");
    // Non-selected item has transparent border
    expect(items[1].style.border).toBe("1px solid transparent");
  });

  it("calls onSelect when a worktree is clicked", () => {
    const onSelect = vi.fn();
    render(
      <WorktreeList
        worktrees={worktrees}
        selectedWorktreeId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText("feature-a"));
    expect(onSelect).toHaveBeenCalledWith("/repo/.worktrees/feature-a");
  });

  it("renders empty message when no worktrees", () => {
    render(
      <WorktreeList
        worktrees={[]}
        selectedWorktreeId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("No worktrees found.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- tests/unit/components/WorktreeList.test.tsx`

Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/WorktreeList.test.tsx
git commit -m "test: add WorktreeList component tests"
```

---

### Task 7: Write FileList Component Test

**Files:**
- Create: `tests/unit/components/FileList.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/unit/components/FileList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
  files: {
    list: vi.fn(),
  },
}));

import { FileList } from "../../../src/features/viewer/FileList";
import { files } from "../../../src/lib/desktop-client";

const mockList = vi.mocked(files.list);

describe("FileList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders file paths from mock data", async () => {
    mockList.mockResolvedValueOnce(["src/index.ts", "README.md"]);
    const onSelect = vi.fn();

    render(
      <FileList
        worktreePath="/repo"
        selectedFile={null}
        onSelect={onSelect}
      />,
    );

    // Wait for async fetch to resolve
    expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("highlights the selected file", async () => {
    mockList.mockResolvedValueOnce(["src/index.ts", "README.md"]);

    const { container } = render(
      <FileList
        worktreePath="/repo"
        selectedFile="src/index.ts"
        onSelect={vi.fn()}
      />,
    );

    // Wait for file list to render
    await screen.findByText("src/index.ts");

    // Find the selected item's container div
    const selectedItem = screen.getByText("src/index.ts");
    expect(selectedItem.style.backgroundColor).toBe("rgb(0, 85, 204)");
    expect(selectedItem.style.color).toBe("rgb(255, 255, 255)");
  });

  it("calls onSelect when a file is clicked", async () => {
    mockList.mockResolvedValueOnce(["src/index.ts", "README.md"]);
    const onSelect = vi.fn();

    render(
      <FileList
        worktreePath="/repo"
        selectedFile={null}
        onSelect={onSelect}
      />,
    );

    const fileItem = await screen.findByText("README.md");
    fireEvent.click(fileItem);
    expect(onSelect).toHaveBeenCalledWith("README.md");
  });

  it("shows loading state", () => {
    // Mock that never resolves
    mockList.mockReturnValue(new Promise(() => {}));

    render(
      <FileList
        worktreePath="/repo"
        selectedFile={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading files…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- tests/unit/components/FileList.test.tsx`

Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/components/FileList.test.tsx
git commit -m "test: add FileList component tests"
```

---

### Task 8: Write FileViewer Component Test

**Files:**
- Create: `tests/unit/components/FileViewer.test.tsx`

- [ ] **Step 1: Write the test file**

Create `tests/unit/components/FileViewer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FileView } from "../../../shared/models/file-view";

vi.mock("../../../src/lib/desktop-client", () => ({
  files: {
    read: vi.fn(),
  },
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: {
    value: string;
    language: string;
    options?: { readOnly?: boolean };
  }) => (
    <div
      data-testid="monaco-editor"
      data-language={props.language}
      data-readonly={String(props.options?.readOnly ?? false)}
    >
      {props.value}
    </div>
  ),
}));

import { FileViewer } from "../../../src/features/viewer/FileViewer";
import { files } from "../../../src/lib/desktop-client";

const mockRead = vi.mocked(files.read);

const fakeFileView: FileView = {
  path: "src/index.ts",
  content: 'export const hello = "world";',
  language: "typescript",
};

describe("FileViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Monaco editor with file content and readOnly", async () => {
    mockRead.mockResolvedValueOnce(fakeFileView);

    render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

    // Wait for async fetch to resolve and editor to render
    const editor = await screen.findByTestId("monaco-editor");
    expect(editor).toHaveTextContent('export const hello = "world";');
    expect(editor).toHaveAttribute("data-language", "typescript");
    expect(editor).toHaveAttribute("data-readonly", "true");
  });

  it("shows file path header", async () => {
    mockRead.mockResolvedValueOnce(fakeFileView);

    render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

    expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
  });

  it("shows loading state while fetching", () => {
    mockRead.mockReturnValue(new Promise(() => {}));

    render(<FileViewer worktreePath="/repo" relativePath="src/index.ts" />);

    expect(screen.getByText("Loading src/index.ts…")).toBeInTheDocument();
  });

  it("shows error when fetch fails", async () => {
    mockRead.mockRejectedValueOnce(new Error("File not found"));

    render(<FileViewer worktreePath="/repo" relativePath="missing.ts" />);

    expect(await screen.findByText("Error: File not found")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- tests/unit/components/FileViewer.test.tsx`

Expected: All 4 tests pass.

- [ ] **Step 3: Run the full unit test suite**

Run: `pnpm test`

Expected: All tests pass — 11 existing service tests + 16 new component tests = 27 total.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/components/FileViewer.test.tsx
git commit -m "test: add FileViewer component tests with mocked Monaco editor"
```

---

## Summary

| Task | Tests Added | Cumulative |
|------|-------------|------------|
| 1. Reorganize + setup | 0 (verify 11 existing) | 11 |
| 2. Install Playwright | 0 | 11 |
| 3. E2E fixture | 0 | 11 |
| 4. E2E app-flow | 10 e2e tests | 11 + 10 e2e |
| 5. RepositoryInput | 4 | 15 + 10 e2e |
| 6. WorktreeList | 4 | 19 + 10 e2e |
| 7. FileList | 4 | 23 + 10 e2e |
| 8. FileViewer | 4 | 27 + 10 e2e |
