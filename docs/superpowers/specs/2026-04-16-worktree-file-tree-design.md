# Worktree File Tree — Design

**Date:** 2026-04-16
**Status:** Approved for implementation planning
**Supersedes:** scoped `FileList` component (`src/features/viewer/FileList.tsx`)

## 1. Goal

Replace the current scoped file list (showing only files in directories where git changes exist) with a lightweight, virtualized tree of the **entire** worktree, respecting `.gitignore`, with search and per-worktree expand state.

## 2. Non-goals

- Filesystem watching / real-time updates
- Keyboard navigation (arrow keys, type-ahead) — can be added later
- Reveal-in-tree from the Changes list
- Drag/drop, rename, create, delete operations on tree items
- Preserving expand state across app restarts

## 3. Requirements

1. Show all files tracked by git plus all untracked, non-ignored files in the active worktree.
2. Load file **list** eagerly; load file **content** only on selection (existing `files.read` IPC handles this).
3. Respect `.gitignore` at all levels (repo root, nested, `.git/info/exclude`, global).
4. Initial state: root expanded, all other folders collapsed.
5. Expand state persists per-worktree, in-memory only; resets on app restart.
6. Refresh triggers: pane focus (`reviewMode` flips to `"files"`), worktree change, root context menu → "Refresh".
7. Visual indicator next to files that appear in `gitSummary.changedFiles` (status M/A/D/R/U).
8. Search input at the top of the tree: case-insensitive substring match against the **full relative path**; matched files shown with ancestor folders auto-expanded (overlay; real expand state not mutated). Non-matching branches hidden.
9. Search state is local to the Files pane: cleared on worktree switch and when leaving the pane.
10. Tree rendering is virtualized; must remain responsive on repos with thousands of files.
11. Explicit root node at the top of the tree, labeled with the worktree name; the "Refresh" action lives on its context menu.

## 4. Architecture

### 4.1 Data layer

New IPC endpoint (additive):

```
files:listTracked(worktreePath: string) => Promise<string[]>
```

- Implemented in `services/files/file-service.ts` as `listTrackedFiles(worktreePath)`.
- Shells out to git:
  ```
  git ls-files --cached --others --exclude-standard -z
  ```
  with `cwd = worktreePath`. `-z` uses `\0` separators for robustness against unusual filenames.
- Parses stdout by splitting on `\0`, drops empty entries.
- On non-git path / missing `git` executable, rejects with a descriptive error. The tree UI surfaces this as a non-fatal "Unable to load files" state.

The existing `listScopedFiles` handler remains in place for this change; it is removed in a follow-up cleanup once nothing else depends on it.

### 4.2 Tree model

- Rename `buildScopedFileTree` → `buildFileTree` (algorithm unchanged; input is any list of `/`-separated relative paths).
- Rename exported node type `ScopedFileTreeNode` → `FileTreeNode`. Shape unchanged.

### 4.3 Flattening for virtualization

Compute a flat, ordered array of visible rows from `(tree, expandedPaths, searchState)`:

```ts
type VisibleRow =
  | { kind: "dir"; path: string; name: string; depth: number; expanded: boolean; hasChildren: boolean }
  | { kind: "file"; path: string; name: string; depth: number; gitStatus?: "M" | "A" | "D" | "R" | "U" };
```

- When search is empty: include a dir row always; recurse into its children only if `expandedPaths` contains its path.
- When search is non-empty:
  - `matchedFiles` = files whose full relative path contains the lowercased term.
  - `requiredDirs` = the set of all ancestor dirs of every matched file.
  - Include a dir row only if its path is in `requiredDirs`; treat all such dirs as expanded (overlay — `expandedPaths` is not mutated).
  - Include a file row only if its path is in `matchedFiles`.
- Git status is looked up from a `Map<path, status>` built once per render from `changedFiles`.

### 4.4 Component boundaries

```
WorktreeTree                    (src/features/viewer/WorktreeTree.tsx — new)
├── TreeToolbar                 (search input, small leading icon; optional inline refresh)
├── VirtualizedRows             (uses @tanstack/react-virtual)
│   └── TreeRow                 (renders dir or file; indentation = depth * token)
│       └── RootRow is a TreeRow with a Radix ContextMenu → "Refresh"
└── Empty / Loading / Error panes
```

- Row height is fixed (single text line + padding) so `@tanstack/react-virtual` can use `estimateSize` cheaply.
- `VirtualizedRows` receives the flat rows + a stable `getKey` based on `row.kind + row.path`.
- `TreeRow` for markdown files keeps the existing "Preview" context menu item; non-markdown file rows have no context menu (v1).

### 4.5 Props

```ts
type WorktreeTreeProps = {
  worktreePath: string;          // absolute
  worktreeName: string;          // displayed on the explicit root row
  selectedFile: string | null;
  onSelect: (relativePath: string) => void;
  changedFiles: GitChangedFile[]; // from gitSummary, used for status indicators
  gitSummaryError?: boolean;
  gitSummaryMessage?: string | null;
};
```

### 4.6 Internal state

- `files: string[]` — most recent result from `files.listTracked`.
- `loading: boolean`, `error: string | null`.
- `expandedPaths: Set<string>` — seeded with just the root path on first successful load for a worktree.
- `searchTerm: string` — debounced ~120ms before being applied to filtering.

Expand state per worktree is held in a `Map<worktreePath, Set<string>>` owned by a **module-level singleton** in `src/features/viewer/worktree-tree-expand-store.ts`. Using a module singleton (instead of `useRef`) is required because `WorktreeTree` unmounts when the user leaves the Files pane; we want expand state to survive that unmount for the app lifetime. On unmount the store is not touched; it is naturally reset on app restart because the module re-initializes.

The store exposes a tiny API:
```ts
export const worktreeTreeExpandStore = {
  get(worktreePath: string): Set<string> | undefined;
  set(worktreePath: string, paths: Set<string>): void;
};
```

On mount, `WorktreeTree` seeds `expandedPaths` from the store (or, if absent, creates a new `Set` containing only the root path). On every change it writes back.

### 4.7 Refresh lifecycle

- **Mount / `reviewMode` becomes `"files"`:** fetch `files.listTracked(worktreePath)`.
- **`worktreePath` changes:** fetch; load expand set for the new worktree (or seed).
- **Root context menu → "Refresh":** fetch; leave expand set untouched.

### 4.8 App.tsx wiring changes

- Remove the `scopeRoots` `useMemo` (currently around `src/app/App.tsx:956`).
- Replace `<FileList worktreePath scopeRoots selectedFile onSelect gitSummaryError gitSummaryMessage />` with
  `<WorktreeTree worktreePath worktreeName={activeWorktree.name} selectedFile onSelect changedFiles={changes} gitSummaryError gitSummaryMessage />`.
- Delete `src/features/viewer/FileList.tsx` and `src/features/viewer/build-scoped-file-tree.ts` (the latter moves to `build-file-tree.ts`). Migrate its tests.

## 5. Dependency

Add `@tanstack/react-virtual` (single dependency, ~3 KB gzipped).

## 6. Error & edge handling

- `git ls-files` fails (not a repo, git not installed): show "Unable to load files" with the error message; keep search input disabled.
- Empty result: show "No files in this worktree."
- Search with no matches: show "No files match '<term>'."
- File selected then removed on refresh: do nothing automatic here — the existing `FileViewer` already renders a read error for missing paths.
- Invalid worktree path (escape attempts): main process already resolves paths inside the service; `listTrackedFiles` operates only via `cwd` so path escape is a non-issue for listing.

## 7. Testing

### 7.1 Unit

- `services/files/file-service.test.ts`
  - Mock `execFile` to assert command shape (`git`, `ls-files`, `--cached`, `--others`, `--exclude-standard`, `-z`) and `cwd`.
  - Verify NUL-separated parsing (including filenames with spaces / unicode).
  - Verify error propagation for non-repo and missing-git cases.
- `src/features/viewer/build-file-tree.test.ts` (renamed from `build-scoped-file-tree.test.ts`)
  - Keep existing assertions; add a case with a path that has > 5 segments to confirm deep nesting.
- `src/features/viewer/WorktreeTree.test.tsx` (new)
  - Renders empty / loading / error / loaded states.
  - Initial expand set contains only the root.
  - Clicking a dir toggles expand; clicking a file fires `onSelect`.
  - Search filter: hides non-matching branches, auto-expands ancestors, does not mutate persisted expand set after clearing.
  - Git status indicator appears for matching `changedFiles` entries.
  - Root context menu → "Refresh" triggers a reload (mock `files.listTracked`).
  - Virtualization layer stubbed (mock `@tanstack/react-virtual` or override to render all rows) so DOM assertions are straightforward.

### 7.2 E2E

Add `tests/e2e/cumulative-flow.phase-8.test.ts` (or extend the latest phase) covering: open worktree → tree shows the root node → expand a folder → search reveals a deep file → click file → content loads in viewer.

## 8. Rollout / follow-ups

- Phase 1 (this spec): ship `WorktreeTree` and delete `FileList`.
- Phase 2 (follow-up, not in this spec):
  - Remove `files:listScoped` IPC + `listScopedFiles` service method (no remaining consumers).
  - Consider keyboard navigation and reveal-in-tree from Changes list.
  - Consider persisting expand state across restarts if users ask.

## 9. Risks

- **Very large monorepos** (> 50k tracked files): even with virtualization, the flattened-row computation is O(n) per render. Mitigation: memoize the flat-row computation on `(files, expandedPaths, searchTerm, changedFilesMap)`. If this proves slow in practice, a follow-up can switch to incremental flattening.
- **`git ls-files` latency** on cold caches of huge repos can be a few hundred ms. Acceptable for v1; revisit with a watcher if it becomes a complaint.
- **Filename edge cases** (newline in filename): `-z` flag handles this correctly by using NUL separators.
