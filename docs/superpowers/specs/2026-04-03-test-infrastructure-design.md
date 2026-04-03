# Test Infrastructure Design

## Purpose

Add comprehensive test coverage to the Phase 0 spike. The spike was built with service-layer TDD only. React components and the full Electron app flow have zero test coverage. This spec adds both.

## Test Organization

```
tests/
  e2e/                              # Playwright — real Electron app
    fixtures/
      create-test-repo.ts           # Creates temp git repo with worktrees and files
    app-flow.test.ts                # Full validation matrix
    playwright.config.ts            # Playwright config (or at project root)
  unit/
    services/                       # Already exists (11 tests)
      worktrees/
        parse-worktree-porcelain.test.ts
        worktree-service.test.ts
      files/
        file-service.test.ts
    components/                     # NEW
      RepositoryInput.test.tsx
      WorktreeList.test.tsx
      FileList.test.tsx
      FileViewer.test.tsx
```

## E2E Tests (Playwright)

### Setup

- Install `@playwright/test` as a dev dependency
- Build the app with `electron-vite build` before running e2e tests
- Launch with `_electron.launch({ args: ['out/main/index.js'] })`
- Get the window via `app.firstWindow()`

### Fixture Repo

A `createTestRepo()` helper creates a temporary git repository with:
- An initial commit
- 2-3 source files (e.g., `src/index.ts`, `README.md`)
- One linked worktree on a feature branch
- Returns `{ repoPath, cleanup }` — cleanup removes the temp directory

Called in `beforeAll`, cleaned up in `afterAll`.

### Test Cases

One test file `app-flow.test.ts` covering the Phase 0 validation matrix:

1. **App launches** — window opens, title is correct
2. **Load repository** — enter fixture repo path, submit, worktree list appears
3. **Select worktree** — click a worktree, selection state changes
4. **Open terminal** — click "Open Terminal", terminal pane appears
5. **Terminal interaction** — type `pwd`, verify output contains the worktree path
6. **Multiple terminals** — open a second terminal, both exist
7. **Stop and restart terminal** — stop terminal, open new one, verify it works
8. **Switch worktrees** — select different worktree, terminals for previous worktree hidden
9. **File listing** — file list shows files from the selected worktree
10. **Monaco viewer** — click a file, Monaco editor renders with file content

### Timeouts and Waits

- Use Playwright's built-in `waitForSelector` / `locator.waitFor()` for UI state changes
- Terminal output requires waiting for PTY response — use `expect(locator).toContainText()` with Playwright's auto-retry
- App launch timeout: 30s
- Individual test timeout: 30s

## Component Tests (Vitest + Testing Library)

### Mocking Strategy

Mock the desktop client at the module level using `vi.mock`:

```ts
vi.mock("../../lib/desktop-client", () => ({
  repository: {
    setRoot: vi.fn(),
    listWorktrees: vi.fn(),
  },
  // ...
}));
```

Components import from `src/lib/desktop-client`. Mocking that module means components render without needing Electron or IPC.

### Test Cases

**RepositoryInput.test.tsx:**
- Renders input and submit button
- Calls `repository.setRoot` then `repository.listWorktrees` on submit
- Shows error text when setRoot rejects
- Shows loading state during submission

**WorktreeList.test.tsx:**
- Renders worktree labels, branch names, and paths
- Highlights the selected worktree
- Calls onSelect when a worktree is clicked

**FileList.test.tsx:**
- Renders file paths from mock data
- Highlights the selected file
- Calls onSelect when a file is clicked

**FileViewer.test.tsx:**
- Renders Monaco editor with file content (mock `@monaco-editor/react`)
- Sets readOnly option

### Monaco Mocking

`@monaco-editor/react` renders a real Monaco instance which requires a browser environment that jsdom cannot fully provide. Mock it:

```ts
vi.mock("@monaco-editor/react", () => ({
  default: (props: { value: string; language: string }) => (
    <div data-testid="monaco-editor" data-language={props.language}>
      {props.value}
    </div>
  ),
}));
```

## Scripts

```json
{
  "test": "vitest run --passWithNoTests",
  "test:e2e": "electron-vite build && playwright test",
  "test:all": "pnpm test && pnpm test:e2e"
}
```

## What This Does NOT Cover

- Terminal attention signaling tests (not built yet)
- Persistence/restore tests (not built yet)
- Performance benchmarks
- Visual regression testing
- CI pipeline setup
