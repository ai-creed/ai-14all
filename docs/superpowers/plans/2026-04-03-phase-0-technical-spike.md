# Phase 0 Technical Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest end-to-end desktop slice that proves `oneforall` can load one repository, discover Git worktrees, run interactive PTY terminals inside a selected worktree, and open files read-only in Monaco.

**Architecture:** Use Electron as a thin shell with a narrow preload bridge. Keep React responsible only for rendering and local display state, keep durable product logic in `/services`, and define spike contracts in `/shared` so the renderer, preload, and main process stay separated even in the spike.

**Tech Stack:** TypeScript, Electron, electron-vite, React, Zod, node-pty, xterm.js, Monaco Editor, Vitest, Testing Library, pnpm

---

## Scope And Guardrails

- This plan implements only Phase 0 from [phase_0_plan.md](/Users/vuphan/Dev/oneforall/docs/shared/phase_0_plan.md).
- The spike must prove viability, not polish.
- Keep the renderer unprivileged from the first commit.
- Support one repository only.
- Keep Monaco read-only.
- Do not add persistence, restore, diff review, settings, command presets UX, or multi-repo support.
- Avoid Zustand in Phase 0. Simple React state is enough for the spike.

## Assumptions

- Package manager: `pnpm`
- Host platform for the spike: macOS first
- Runtime shell for PTY sessions: the user shell from `process.env.SHELL`, fallback `/bin/zsh`
- Test strategy: unit-test the deterministic logic, manually validate PTY and Electron end-to-end behavior

## Planned File Structure

```text
/.gitignore
/package.json
/tsconfig.json
/tsconfig.node.json
/vitest.config.ts
/index.html
/electron.vite.config.ts

/electron
  /main
    index.ts
    windows.ts
    ipc.ts
  /preload
    index.ts

/services
  /worktrees
    parse-worktree-porcelain.ts
    worktree-service.ts
  /terminals
    terminal-service.ts
  /files
    file-service.ts

/shared
  /contracts
    commands.ts
    events.ts
  /models
    repository.ts
    worktree.ts
    terminal-session.ts
    file-view.ts

/src
  main.tsx
  /app
    App.tsx
  /lib
    desktop-client.ts
  /types
    global.d.ts
  /features
    /repository
      RepositoryInput.tsx
    /worktrees
      WorktreeList.tsx
    /terminals
      TerminalPane.tsx
      useTerminalSession.ts
    /viewer
      FileViewer.tsx
      FileList.tsx

/tests
  /services
    /worktrees
      parse-worktree-porcelain.test.ts
      worktree-service.test.ts
    /files
      file-service.test.ts
```

## Validation Gates

Phase 0 is done only if all of these work on a real repository with multiple worktrees:

1. `pnpm dev` opens the Electron app with the React renderer loaded.
2. The renderer can set one repository root through the preload bridge.
3. The app can list worktrees from `git worktree list --porcelain`.
4. The user can select a worktree and open an interactive shell in that directory.
5. Terminal input, output, resize, and stop all work.
6. A second terminal session can be opened without breaking the first.
7. The app can list a small set of files from the selected worktree.
8. Monaco can open one selected file read-only while terminals remain usable.

## Task 1: Bootstrap The Electron + React Spike

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `electron/main/index.ts`
- Create: `electron/main/windows.ts`
- Create: `electron/preload/index.ts`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`

- [ ] **Step 1: Initialize the git repository and create `.gitignore`**

Run:

```bash
git init
```

Create `.gitignore`:

```text
node_modules/
out/
dist/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 2: Initialize the package manifest and scripts**

Use these dependencies and scripts:

```json
{
  "name": "oneforall",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run --passWithNoTests"
  }
}
```

Run:

```bash
pnpm add react react-dom zod node-pty xterm @xterm/addon-fit monaco-editor @monaco-editor/react
pnpm add -D electron electron-vite typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @types/node @types/react @types/react-dom
```

Expected:
- install completes without peer dependency failures
- `pnpm dev` is now available

- [ ] **Step 3: Create the Vite and TypeScript baseline**

Set up:
- `tsconfig.json` for renderer/shared source
- `tsconfig.node.json` for Electron/main/service files
- `electron.vite.config.ts` with one renderer config using React and default entries for `electron/main/index.ts` and `electron/preload/index.ts`
- `vitest.config.ts` using `jsdom`

Expected:
- `pnpm typecheck` runs, even if the app still renders only a smoke screen

- [ ] **Step 4: Create a minimal main window and preload**

Add:

```ts
// electron/main/windows.ts
export function createMainWindow() {
  return new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.js", import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
}
```

```ts
// electron/main/index.ts
app.whenReady().then(() => {
  const mainWindow = createMainWindow();
  registerIpcHandlers(mainWindow);
});
```

Import `fileURLToPath` from `node:url`. Do not use `__dirname` in the Electron main process because this project uses ESM (`"type": "module"`).

```ts
// electron/preload/index.ts
contextBridge.exposeInMainWorld("oneforall", {});
```

Expected:
- `pnpm dev` opens one Electron window
- the renderer loads a minimal React page

- [ ] **Step 5: Add a basic renderer smoke screen**

Render:

```tsx
export function App() {
  return <main><h1>oneforall Phase 0</h1></main>;
}
```

Expected:
- the Electron window shows the Phase 0 heading

- [ ] **Step 6: Verify the bootstrap**

Run:

```bash
pnpm typecheck
pnpm test
pnpm dev
```

Expected:
- `typecheck` passes
- `test` passes, including the no-test case because the script uses `--passWithNoTests`
- Electron launches successfully

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json pnpm-lock.yaml tsconfig.json tsconfig.node.json vitest.config.ts index.html electron.vite.config.ts electron src
git commit -m "chore: bootstrap phase 0 electron spike"
```

## Task 2: Lock In The Spike Models And IPC Contract

**Files:**
- Create: `shared/models/repository.ts`
- Create: `shared/models/worktree.ts`
- Create: `shared/models/terminal-session.ts`
- Create: `shared/models/file-view.ts`
- Create: `shared/contracts/commands.ts`
- Create: `shared/contracts/events.ts`
- Modify: `electron/preload/index.ts`
- Create: `electron/main/ipc.ts`
- Create: `src/lib/desktop-client.ts`
- Create: `src/types/global.d.ts`

- [ ] **Step 1: Define the minimal shared models**

Add these shapes:

```ts
export type Repository = {
  id: string;
  name: string;
  rootPath: string;
};

export type Worktree = {
  id: string;
  repositoryId: string;
  branchName: string;
  path: string;
  label: string;
  isMain: boolean;
};

export type TerminalSession = {
  id: string;
  worktreeId: string;
  cwd: string;
  status: "idle" | "running" | "exited" | "error";
  exitCode: number | null;
};

export type FileView = {
  path: string;
  content: string;
  language: string;
};
```

- [ ] **Step 2: Define explicit command and event contracts**

Create typed command payloads for:
- `setRepositoryRoot`
- `listWorktrees`
- `createTerminalSession`
- `sendTerminalInput`
- `resizeTerminalSession`
- `stopTerminalSession`
- `listFiles`
- `readFile`

Create event payloads for:
- `terminal/output`
- `terminal/exit`
- `terminal/state`
- `terminal/error`

Use `zod` schemas next to the payload types so main-process handlers can validate renderer input.

- [ ] **Step 3: Expose a narrow preload bridge**

Expose one API surface only:

```ts
type OneForAllDesktopApi = {
  repository: {
    setRoot(path: string): Promise<Repository>;
    listWorktrees(): Promise<Worktree[]>;
  };
  terminals: {
    create(worktreeId: string, cwd: string): Promise<TerminalSession>;
    sendInput(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stop(sessionId: string): Promise<void>;
    onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
    onState(listener: (event: TerminalStateEvent) => void): () => void;
  };
  files: {
    list(worktreePath: string): Promise<string[]>;
    read(worktreePath: string, relativePath: string): Promise<FileView>;
  };
};
```

The preload should not expose raw `ipcRenderer`.
Export `OneForAllDesktopApi` from `shared/contracts/commands.ts`, and export `TerminalOutputEvent`, `TerminalExitEvent`, and `TerminalStateEvent` from `shared/contracts/events.ts` so the preload and renderer type references compile cleanly.

- [ ] **Step 4: Declare the global window type**

`src/types/global.d.ts` should augment the `Window` interface so TypeScript recognizes the preload bridge:

```ts
import type { OneForAllDesktopApi } from "../../shared/contracts/commands";

declare global {
  interface Window {
    oneforall: OneForAllDesktopApi;
  }
}
```

Add `export {};` at the end of the file so TypeScript treats it as a module.

- [ ] **Step 5: Create one renderer-side client wrapper**

`src/lib/desktop-client.ts` should export a typed wrapper around `window.oneforall` so React components never call `window` directly.

- [ ] **Step 6: Verify the contract layer**

Run:

```bash
pnpm typecheck
```

Expected:
- all shared model and contract imports resolve on both renderer and Electron sides

- [ ] **Step 7: Commit**

```bash
git add shared electron/preload/index.ts electron/main/ipc.ts src/lib/desktop-client.ts src/types/global.d.ts
git commit -m "feat: add shared spike contracts and desktop bridge"
```

## Task 3: Implement Repository Validation And Worktree Discovery

**Files:**
- Create: `services/worktrees/parse-worktree-porcelain.ts`
- Create: `services/worktrees/worktree-service.ts`
- Create: `tests/services/worktrees/parse-worktree-porcelain.test.ts`
- Create: `tests/services/worktrees/worktree-service.test.ts`
- Modify: `electron/main/ipc.ts`

- [ ] **Step 1: Write the parser test first**

Add a deterministic parser test for `git worktree list --porcelain`:

```ts
it("parses main and linked worktrees", () => {
  const input = [
    "worktree /repo/main",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/feature-a",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/feature-a",
    ""
  ].join("\n");

  expect(parseWorktreePorcelain(input, "repo-1")).toEqual([
    {
      id: "/repo/main",
      repositoryId: "repo-1",
      branchName: "main",
      path: "/repo/main",
      label: "main",
      isMain: true
    },
    {
      id: "/repo/.worktrees/feature-a",
      repositoryId: "repo-1",
      branchName: "feature-a",
      path: "/repo/.worktrees/feature-a",
      label: "feature-a",
      isMain: false
    }
  ]);
});
```

- [ ] **Step 2: Run the parser test and confirm failure**

Run:

```bash
pnpm vitest run tests/services/worktrees/parse-worktree-porcelain.test.ts
```

Expected:
- FAIL because `parseWorktreePorcelain` does not exist yet

- [ ] **Step 3: Implement the porcelain parser**

Implement `parseWorktreePorcelain(input, repositoryId)` in `services/worktrees/parse-worktree-porcelain.ts`.

Rules:
- split blank-line-separated records
- extract `worktree`, `branch`, and fallback labels
- normalize `refs/heads/<name>` to `<name>`
- mark the first record or the repository root worktree as `isMain`

- [ ] **Step 4: Re-run the parser test**

Run:

```bash
pnpm vitest run tests/services/worktrees/parse-worktree-porcelain.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Add service-level tests for repository validation**

Write `tests/services/worktrees/worktree-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { WorktreeService } from "../../../services/worktrees/worktree-service";

describe("WorktreeService", () => {
  let service: WorktreeService;

  beforeEach(() => {
    service = new WorktreeService();
  });

  describe("setRepositoryRoot", () => {
    it("rejects a path that does not exist", async () => {
      await expect(
        service.setRepositoryRoot("/nonexistent/path/abc123")
      ).rejects.toThrow();
    });

    it("rejects a directory that is not a git repo", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
      try {
        await expect(service.setRepositoryRoot(tmpDir)).rejects.toThrow();
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("accepts a valid git repository and returns a Repository", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
      try {
        execSync("git init", { cwd: tmpDir, stdio: "ignore" });
        execSync("git config user.email 'phase0@example.com'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git config user.name 'Phase 0 Test'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git commit --allow-empty -m 'init'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        const repo = await service.setRepositoryRoot(tmpDir);
        expect(repo.rootPath).toBe(tmpDir);
        expect(repo.name).toBeTruthy();
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe("listWorktrees", () => {
    it("returns at least the main worktree for a valid repo", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ofa-test-"));
      try {
        execSync("git init", { cwd: tmpDir, stdio: "ignore" });
        execSync("git config user.email 'phase0@example.com'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git config user.name 'Phase 0 Test'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        execSync("git commit --allow-empty -m 'init'", {
          cwd: tmpDir,
          stdio: "ignore",
        });
        const repo = await service.setRepositoryRoot(tmpDir);
        const worktrees = await service.listWorktrees(repo);
        expect(worktrees.length).toBeGreaterThanOrEqual(1);
        expect(worktrees[0].isMain).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
```

- [ ] **Step 6: Implement `worktree-service.ts`**

Service responsibilities:
- `setRepositoryRoot(rootPath: string): Promise<Repository>`
- `listWorktrees(repository: Repository): Promise<Worktree[]>`

Implementation notes:
- use `fs.stat` to verify the path exists
- use `git rev-parse --show-toplevel` to confirm the repo root
- use `git worktree list --porcelain`
- keep all child-process calls inside this service

- [ ] **Step 7: Wire IPC handlers for repository/worktree commands**

`electron/main/ipc.ts` should:
- validate incoming payloads with `zod`
- call `worktree-service`
- return typed results

- [ ] **Step 8: Verify the service layer**

Run:

```bash
pnpm vitest run tests/services/worktrees/parse-worktree-porcelain.test.ts tests/services/worktrees/worktree-service.test.ts
pnpm typecheck
```

Expected:
- tests pass
- typecheck passes

- [ ] **Step 9: Commit**

```bash
git add services/worktrees tests/services/worktrees electron/main/ipc.ts
git commit -m "feat: add repository validation and worktree discovery"
```

## Task 4: Build The Minimal Worktree Selection UI

**Files:**
- Create: `src/features/repository/RepositoryInput.tsx`
- Create: `src/features/worktrees/WorktreeList.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Create a repository root input**

`RepositoryInput.tsx` should include:
- one text input for a local path
- one submit button
- loading and error text

The component should call `desktopClient.repository.setRoot(path)` and then `desktopClient.repository.listWorktrees()`.

- [ ] **Step 2: Create a simple worktree list**

`WorktreeList.tsx` should render:
- worktree label
- branch name
- full path
- selected state

Keep it plain. A single-column list is enough.

- [ ] **Step 3: Wire the app state in `App.tsx`**

Track only:
- `repository`
- `worktrees`
- `selectedWorktreeId`
- `error`
- `loading`

No global store in Phase 0.

- [ ] **Step 4: Verify the repository → worktree flow**

Manual check in `pnpm dev`:
1. paste a real repository path
2. load it
3. confirm the worktree list renders
4. click a worktree and confirm selection state changes

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/features/repository/RepositoryInput.tsx src/features/worktrees/WorktreeList.tsx
git commit -m "feat: add repository input and worktree selection ui"
```

## Task 5: Implement The PTY Terminal Service

**Files:**
- Create: `services/terminals/terminal-service.ts`
- Modify: `electron/main/ipc.ts`
- Modify: `shared/contracts/events.ts`
- Modify: `shared/contracts/commands.ts`

- [ ] **Step 1: Define the session lifecycle rules**

Use these states:
- `idle`
- `running`
- `exited`
- `error`

The service owns:
- session id generation
- PTY creation
- output forwarding
- resize handling
- stop/cleanup

- [ ] **Step 2: Implement the terminal session registry**

`terminal-service.ts` should keep an internal `Map<string, ActiveTerminalSession>`.

Each active session should track:
- `meta: TerminalSession`
- `pty: IPty`

- [ ] **Step 3: Implement create/send/resize/stop**

Use this behavior:

```ts
create(worktreeId: string, cwd: string): TerminalSession
sendInput(sessionId: string, data: string): void
resize(sessionId: string, cols: number, rows: number): void
stop(sessionId: string): void
```

Implementation notes:
- default shell: `process.env.SHELL ?? "/bin/zsh"`
- default size: `80x24`
- emit structured events through callbacks registered by `electron/main/ipc.ts`
- update session state before broadcasting lifecycle events

- [ ] **Step 4: Wire terminal IPC handlers and event fan-out**

`electron/main/ipc.ts` should:
- handle terminal commands with payload validation
- forward output/exit/state events to the focused renderer window through `webContents.send`

Use explicit channels only:
- `terminal/output`
- `terminal/exit`
- `terminal/state`
- `terminal/error`

- [ ] **Step 5: Commit**

```bash
git add services/terminals shared/contracts electron/main/ipc.ts
git commit -m "feat: add pty-backed terminal service"
```

## Task 6: Render Interactive Terminals With xterm.js

**Files:**
- Create: `src/features/terminals/TerminalPane.tsx`
- Create: `src/features/terminals/useTerminalSession.ts`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Create the terminal session hook**

`useTerminalSession.ts` should:
- create a session for the selected worktree
- subscribe to output/exit/state events
- expose `create`, `stop`, and connection state

- [ ] **Step 2: Render one xterm instance**

`TerminalPane.tsx` should:
- mount `xterm`
- install the fit addon
- write incoming output to the terminal
- send keystrokes back through `desktopClient.terminals.sendInput`
- resize on mount and container resize

- [ ] **Step 3: Add minimal session controls**

Add only:
- `Open Terminal`
- `Stop Terminal`
- session status label

Do not build tab polish yet.

- [ ] **Step 4: Prove that a second terminal can coexist**

Extend the app to keep a small local array of terminal sessions keyed by worktree id (e.g. `Record<string, TerminalSession[]>`).

The UI can be plain:
- one button to add terminal
- one vertical stack of terminal panes

When the user switches worktrees:
- hide terminal panes for the previous worktree (do not destroy the xterm instances — keep them mounted but hidden so output continues to buffer)
- show terminal panes for the newly selected worktree
- PTY sessions keep running in the background regardless of which worktree is selected

Expected:
- opening a second session does not break the first session
- switching to another worktree and back preserves terminal output

- [ ] **Step 5: Verify the interactive terminal loop**

Manual check in `pnpm dev`:
1. select a worktree
2. open terminal A, run `pwd` — confirm cwd matches the worktree path
3. run `echo hello` — confirm output appears
4. open terminal B, run `echo second` — confirm terminal A is unaffected
5. resize the window — confirm both terminals resize correctly
6. stop terminal A
7. open a new terminal C in the same worktree — confirm it starts cleanly (this validates restart behavior)

- [ ] **Step 6: Commit**

```bash
git add src/features/terminals src/app/App.tsx
git commit -m "feat: render interactive worktree terminals"
```

## Task 7: Add File Listing And Read-Only Monaco Viewing

**Files:**
- Create: `services/files/file-service.ts`
- Create: `tests/services/files/file-service.test.ts`
- Modify: `electron/main/ipc.ts`
- Create: `src/features/viewer/FileList.tsx`
- Create: `src/features/viewer/FileViewer.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Write the file service tests first**

Write `tests/services/files/file-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileService } from "../../../services/files/file-service";

describe("FileService", () => {
  let service: FileService;
  let worktreeDir: string;

  beforeEach(() => {
    service = new FileService();
    worktreeDir = mkdtempSync(join(tmpdir(), "ofa-file-test-"));
    mkdirSync(join(worktreeDir, "src"), { recursive: true });
    writeFileSync(join(worktreeDir, "src", "index.ts"), "console.log('hello');");
  });

  afterEach(() => {
    rmSync(worktreeDir, { recursive: true });
  });

  describe("readFile", () => {
    it("returns content for a valid text file", async () => {
      const result = await service.readFile(worktreeDir, "src/index.ts");
      expect(result.content).toBe("console.log('hello');");
      expect(result.path).toBe("src/index.ts");
      expect(result.language).toBe("typescript");
    });

    it("rejects when the path is a directory", async () => {
      await expect(service.readFile(worktreeDir, "src")).rejects.toThrow();
    });

    it("rejects when the path escapes the worktree", async () => {
      await expect(
        service.readFile(worktreeDir, "../../etc/passwd")
      ).rejects.toThrow();
    });
  });

  describe("listFiles", () => {
    it("returns relative paths for files in the worktree", async () => {
      const files = await service.listFiles(worktreeDir);
      expect(files).toContain("src/index.ts");
    });
  });
});
```

- [ ] **Step 2: Implement the file service**

`file-service.ts` should expose:

```ts
listFiles(worktreePath: string): Promise<string[]>
readFile(worktreePath: string, relativePath: string): Promise<FileView>
```

Implementation notes:
- use a recursive `fs.readdir` walk with `{ withFileTypes: true }`
- skip `node_modules`, `.git`, `dist`, and `out` directories
- cap the spike file list at 200 entries
- return repo-relative paths to the renderer
- resolve the absolute file path in the service, not the renderer
- reject any path escape outside the selected worktree (use `path.resolve` and check the result starts with the worktree path)

- [ ] **Step 3: Wire the file IPC handlers**

Add:
- `files.list(worktreePath)`
- `files.read(worktreePath, relativePath)`

Keep file reads read-only.

- [ ] **Step 4: Build a simple file list UI**

`FileList.tsx` should:
- request files for the selected worktree
- show a small scrollable list of relative paths
- let the user pick one file

- [ ] **Step 5: Build the read-only Monaco viewer**

`FileViewer.tsx` should:
- request the selected file content
- render it with `@monaco-editor/react`
- keep `options={{ readOnly: true }}`

No save action, no editing commands, no diff mode.

- [ ] **Step 6: Verify terminal + viewer coexistence**

Manual check in `pnpm dev`:
1. open a worktree terminal
2. run a simple command
3. select a file from the file list
4. confirm Monaco loads the file
5. return to the terminal and continue typing

Expected:
- renderer stays responsive
- Monaco does not block terminal interaction

- [ ] **Step 7: Commit**

```bash
git add services/files tests/services/files electron/main/ipc.ts src/features/viewer src/app/App.tsx
git commit -m "feat: add read-only file viewing with monaco"
```

## Task 8: End-To-End Validation And Spike Closeout

**Files:**
- Create: `docs/shared/phase_0_validation.md`
- Modify: `docs/shared/phase_0_plan.md`

- [ ] **Step 1: Run the automated checks**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected:
- all current tests pass
- no TypeScript errors

- [ ] **Step 2: Run the manual validation matrix on a real repository**

Verify these cases:
1. launch app in development mode
2. load one repository path
3. list multiple worktrees
4. select worktree A and open terminal A1
5. run `pwd` and confirm the cwd
6. open terminal A2 and confirm it still works
7. stop terminal A1, then open a new terminal in worktree A — confirm it starts cleanly (restart)
8. switch to worktree B and open terminal B1
9. open a file from worktree B in Monaco
10. switch back to worktree A without renderer errors

- [ ] **Step 3: Record the spike result**

Create `docs/shared/phase_0_validation.md` with:
- environment used
- commands run
- pass/fail against each validation gate
- issues to carry into Phase 1
- shortcuts to discard before Phase 1

- [ ] **Step 4: Update the Phase 0 plan status**

In `docs/shared/phase_0_plan.md`, add a short completion note at the top or bottom:
- implementation date
- whether the spike passed
- links to validation notes

- [ ] **Step 5: Commit**

```bash
git add docs/shared/phase_0_validation.md docs/shared/phase_0_plan.md
git commit -m "docs: record phase 0 spike validation results"
```

## Implementation Order

Follow this order exactly:

1. Task 1: bootstrap
2. Task 2: shared contracts + bridge
3. Task 3: repository validation + worktrees
4. Task 4: worktree UI
5. Task 5: PTY backend
6. Task 6: terminal renderer
7. Task 7: file listing + Monaco
8. Task 8: validation + closeout

This order keeps the highest-risk system seams moving forward without spending time on Phase 1 architecture or UI polish too early.

## Risks To Watch During Execution

- `node-pty` native build friction on the local machine
- Electron preload misconfiguration causing the renderer bridge to fail silently
- PTY cleanup bugs when switching worktrees or opening multiple terminals
- Large file lists slowing the renderer if `fs` walk output is not capped
- Monaco bundle size affecting startup more than expected

## Explicit Non-Goals

- persistence
- restore behavior
- command presets
- Git diff review
- settings
- multi-repo UX
- editable code viewer
- final layout polish
- production packaging
