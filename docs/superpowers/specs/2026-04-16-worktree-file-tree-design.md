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
7. Visual indicator next to files that appear in `gitSummary.changedFiles` (reuses the shared `GitChangeStatus` values: `M`, `A`, `D`, `R`, `??`).
8. Search input at the top of the tree: case-insensitive substring match against the **full relative path**; matched files shown with ancestor folders auto-expanded (overlay; real expand state not mutated). Non-matching branches hidden.
9. Search state is local to the Files pane: cleared on worktree switch and when leaving the pane.
10. Tree rendering is virtualized; must remain responsive on repos with thousands of files.
11. Explicit root node at the top of the tree, labeled with the worktree's `label`; the "Refresh" action lives on its context menu.
12. A git-summary failure must **not** block the tree. The tree still renders from `files.listTracked`; only the status badges are suppressed and an inline non-blocking warning is shown.
13. The data endpoint resolves identity server-side from `workspaceId + worktreeId` — the renderer never hands the main process a raw absolute worktree path for this feature.
14. Fetches are protected by a monotonic request-id guard: a late response from a superseded fetch (worktree switch, overlapping refresh) must never be applied to the UI.
15. The root row uses a single canonical sentinel path (`WORKTREE_TREE_ROOT_PATH === ""`) everywhere expand state, row keys, and search overlay logic reference it. The sentinel is never sent over IPC and never passed to `onSelect`.

## 4. Architecture

### 4.1 Data layer

New IPC endpoint (additive). **Takes a registered workspace + worktree identity, not a raw path**, so the renderer cannot point the endpoint at arbitrary repos on disk:

```
files:listTracked({ workspaceId: string; worktreeId: string }) => Promise<string[]>
```

- Zod schema in `shared/contracts/commands.ts` enforces both fields are non-empty strings.
- Preload bridge (`electron/preload/index.ts`) exposes
  `files.listTracked(workspaceId, worktreeId)` and the renderer client
  (`src/lib/desktop-client.ts`) forwards both fields.
- Main handler (`electron/main/ipc.ts`) resolves identity entirely server-side:
  1. `repository = workspaceRegistry.get(workspaceId)` — throws "Unknown workspace" if not registered.
  2. `worktrees = await worktreeService.listWorktrees(repository)` — find the worktree whose `id === worktreeId`; throw "Unknown worktree" if absent. (Optional micro-optimization: add a narrow `worktreeService.findWorktree(repository, worktreeId)` helper so we do not pay a full porcelain listing on every list; the initial implementation can simply reuse `listWorktrees`.)
  3. Pass `worktree.path` into `fileService.listTrackedFiles(worktree.path)`.
- `FileService.listTrackedFiles(absolutePath)` shells out to git:
  ```
  git ls-files --cached --others --exclude-standard -z
  ```
  with `cwd = absolutePath`, `-z` for NUL-separated output. Parses stdout by splitting on `\0`, drops empty entries.
- Error surface:
  - Unknown workspace / worktree → rejects with a 400-style error; UI shows "Unable to load files".
  - `git ls-files` fails (not a git working tree, binary missing, exec error) → rejects with a descriptive error; UI shows "Unable to load files" with the error message, tree is otherwise non-destructive.

Note: other existing file endpoints (`files:list`, `files:read`, `files:listScoped`, `git:listChanges`, etc.) still accept raw `worktreePath` arguments. Migrating them to identity-based arguments is tracked as a separate hardening effort; **this spec does not block on that migration** but it also does not extend the insecure pattern.

The existing `listScopedFiles` handler remains in place for this change; it is removed in a follow-up cleanup once nothing else depends on it.

### 4.2 Tree model

- Rename `buildScopedFileTree` → `buildFileTree` (algorithm unchanged; input is any list of `/`-separated relative paths).
- Rename exported node type `ScopedFileTreeNode` → `FileTreeNode`. Shape unchanged.

#### 4.2.1 Root sentinel

The explicit root row is **not** a file or directory returned by `git ls-files`; it is a synthetic wrapper. To participate in the same `expandedPaths`/`VisibleRow.path` space as every other entry it needs a canonical, unambiguous path value.

- **Sentinel value:** the empty string `""`.
  - Export as `export const WORKTREE_TREE_ROOT_PATH = "" as const;` from `src/features/viewer/build-file-tree.ts`.
- **Safe** because `git ls-files` never emits an empty path, and no real relative file path starts with a path separator in the format we operate on.
- **Used in exactly three places:**
  1. `VisibleRow.path` for the root row is `WORKTREE_TREE_ROOT_PATH`.
  2. `treeExpandedPaths` initialized with `[WORKTREE_TREE_ROOT_PATH]` the first time a worktree's tree loads successfully (requirement 4).
  3. Search-overlay logic considers the root sentinel as always expanded while search is active (ensures the root row + any matching descendants remain visible).
- Row keys for the virtualizer use `row.kind + ":" + row.path`, so the root's key is `"dir:"` — distinct from any other node's key.
- The sentinel is never passed to `onSelect` (the root row is a dir, not a file) and never sent in any IPC payload.

### 4.3 Flattening for virtualization

Compute a flat, ordered array of visible rows from `(tree, expandedPaths, searchState)`:

```ts
import type { GitChange, GitChangeStatus } from "../../../shared/models/git-change";

type VisibleRow =
  | { kind: "dir"; path: string; name: string; depth: number; expanded: boolean; hasChildren: boolean }
  | { kind: "file"; path: string; name: string; depth: number; gitStatus?: GitChangeStatus };
```

(`GitChangeStatus` is the existing shared union `"M" | "A" | "D" | "R" | "??"`; the tree reuses it verbatim rather than defining its own letters.)

- When search is empty: include a dir row always; recurse into its children only if `expandedPaths` contains its path.
- When search is non-empty:
  - `matchedFiles` = files whose full relative path contains the lowercased term.
  - `requiredDirs` = the set of all ancestor dirs of every matched file.
  - Include a dir row only if its path is in `requiredDirs`; treat all such dirs as expanded (overlay — `expandedPaths` is not mutated).
  - Include a file row only if its path is in `matchedFiles`.
- Git status is looked up from a `Map<path, GitChangeStatus>` built once per render from `changedFiles: GitChange[]`.

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
- `VirtualizedRows` receives the flat rows + a stable `getKey` based on `row.kind + ":" + row.path`.
- `TreeRow` for markdown files keeps the "Preview" context menu item; non-markdown file rows have no context menu (v1).

**Markdown preview wiring.** `MarkdownPreviewModal` still reads via `files.read(worktreePath, relativePath)` (see `src/features/viewer/MarkdownPreviewModal.tsx:40`). Migrating `files.read` to the identity-based contract is follow-up work (§8) and is **not** in this spec. To keep `WorktreeTree` free of the raw `worktreePath` dependency:

- `WorktreeTree` exposes an optional callback prop `onPreviewMarkdown?(relativePath)`. When a markdown file's context-menu "Preview" fires, the tree calls this callback and does nothing else.
- `App.tsx` owns the preview modal state (current preview path + open flag) and renders `<MarkdownPreviewModal worktreePath={activeWorktree.path} relativePath={…} open={…} onClose={…} />` as a sibling of `<WorktreeTree>`, exactly as it renders today alongside `FileList`. Closing the modal clears the path; switching worktrees clears the path.
- This keeps the raw `worktreePath` isolated to the one caller that still needs it, and lets `files.read` migrate later without touching the tree.

### 4.5 Props

```ts
import type { GitChange } from "../../../shared/models/git-change";

type WorktreeTreeProps = {
  workspaceId: string;            // passed to files.listTracked; never used for rendering
  worktreeId: string;             // identity key for data fetch + expand-state lookup
  worktreeLabel: string;          // display label for the explicit root row (from Worktree.label)
  selectedFile: string | null;
  onSelect: (relativePath: string) => void;
  onPreviewMarkdown?: (relativePath: string) => void;  // opens MarkdownPreviewModal in parent
  changedFiles: GitChange[];      // from gitSummary, used for status indicators
  gitSummaryError?: boolean;
  gitSummaryMessage?: string | null;
  expandedPaths: string[];        // from session state, see §4.6
  onExpandedPathsChange: (worktreeId: string, paths: string[]) => void;
};
```

(`Worktree` uses `label`, not `name`; the prop is named accordingly.)

### 4.6 Internal state

Component-local:
- `files: string[]` — most recent result from `files.listTracked`.
- `loading: boolean`, `error: string | null`.
- `searchTerm: string` — debounced ~120ms before being applied to filtering.

Expand state lives **in the session model** (`WorktreeSession.treeExpandedPaths: string[]`), not in a renderer-level module singleton. Rationale:

- `workspaceReducer` already reconciles sessions against the live worktree list (`workspace/reconcileWorktrees`), so a stale entry for a removed worktree is dropped automatically. A module singleton keyed on stable IDs would still need to hook into reconciliation — using the reducer is strictly simpler and already correct.
- Worktrees are created at deterministic `.worktrees/<name>` paths, so a removed-then-recreated worktree gets a new UUID but the same path. Keying off the **worktree UUID** (via session state) prevents carrying stale expand sets across that recreation.

Shape additions:

- `shared/models/worktree-session.ts` — add `treeExpandedPaths: string[]` to the in-memory `WorktreeSession` type.
- `shared/models/persisted-workspace-state.ts` — **do NOT add** `treeExpandedPaths` to `PersistedWorktreeSessionSchema`. This guarantees expand state is not written to disk and therefore resets on app restart, satisfying requirement 5. Add a short comment in the schema explaining the intentional omission.
- Default value when `createSession` is called: `treeExpandedPaths: []`. The root sentinel is added lazily by `WorktreeTree` the first time a load succeeds for a given `worktreeId` (dispatch `session/setTreeExpandedPaths` with `[WORKTREE_TREE_ROOT_PATH]` — i.e. `[""]`). This keeps the defaults generator ignorant of runtime concerns and means a freshly-reconciled session (existing or new) always starts with the root-only state, satisfying requirement 4.

New reducer action:

```ts
| { type: "session/setTreeExpandedPaths"; worktreeId: string; paths: string[] }
```

Simple, debounced writes: `WorktreeTree` holds its own `Set<string>` mirror for fast toggling, and dispatches the `string[]` form on each user toggle.

### 4.7 Refresh lifecycle

- **Mount / `reviewMode` becomes `"files"`:** fetch `files.listTracked(workspaceId, worktreeId)`.
- **`worktreeId` changes:** fetch; read `treeExpandedPaths` from the newly-active session.
- **Root context menu → "Refresh":** fetch; leave `treeExpandedPaths` untouched.

#### 4.7.1 Stale-request handling

Multiple fetch triggers can fire concurrently (fast worktree switch, focus + refresh race, etc.), and a slow in-flight response from an older fetch must **not** overwrite state belonging to a newer context. All fetches run through a generation guard:

```ts
const requestIdRef = useRef(0);

async function reload() {
  const myId = ++requestIdRef.current;
  const capturedWorktreeId = worktreeId;
  setLoading(true);
  setError(null);
  try {
    const list = await files.listTracked(workspaceId, worktreeId);
    if (requestIdRef.current !== myId) return;           // superseded fetch
    if (capturedWorktreeId !== worktreeId) return;       // worktree switched
    setFiles(list);
  } catch (err) {
    if (requestIdRef.current !== myId) return;
    if (capturedWorktreeId !== worktreeId) return;
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    if (requestIdRef.current === myId) setLoading(false);
  }
}
```

- Every fetch trigger calls `reload()` — no direct `setFiles`/`setError` from outside this function.
- Component unmount implicitly invalidates in-flight requests because `requestIdRef` is part of the unmounted instance; any late resolution no-ops on the now-unmounted component.
- Unit test: two sequential `reload()` calls where the first resolves after the second; assert only the second result is visible.

### 4.8 App.tsx wiring changes

- Remove the `scopeRoots` `useMemo` (currently around `src/app/App.tsx:956`).
- Lift preview state from `FileList` to `App`: `const [previewPath, setPreviewPath] = useState<string | null>(null);` in the same scope that renders the review pane; reset to `null` on `activeWorktree.id` change.
- Replace `<FileList worktreePath scopeRoots selectedFile onSelect gitSummaryError gitSummaryMessage />` with
  ```tsx
  <>
    <WorktreeTree
      workspaceId={activeWorkspaceId}
      worktreeId={activeWorktree.id}
      worktreeLabel={activeWorktree.label}
      selectedFile={activeSession.selectedFilePath}
      onSelect={(relativePath) => dispatch({ type: "session/selectFile", worktreeId: activeWorktree.id, relativePath })}
      onPreviewMarkdown={setPreviewPath}
      changedFiles={changes}
      gitSummaryError={gitSummaryError}
      gitSummaryMessage={gitSummaryMessage}
      expandedPaths={activeSession.treeExpandedPaths}
      onExpandedPathsChange={(worktreeId, paths) =>
        dispatch({ type: "session/setTreeExpandedPaths", worktreeId, paths })
      }
    />
    {previewPath !== null && (
      <MarkdownPreviewModal
        worktreePath={activeWorktree.path}
        relativePath={previewPath}
        open={true}
        onClose={() => setPreviewPath(null)}
      />
    )}
  </>
  ```
- Delete `src/features/viewer/FileList.tsx` and `src/features/viewer/build-scoped-file-tree.ts` (the latter moves to `build-file-tree.ts`). Migrate its tests. `MarkdownPreviewModal` is untouched.

## 5. Dependency

Add `@tanstack/react-virtual` (single dependency, ~3 KB gzipped).

## 6. Error & edge handling

- **`files.listTracked` fails** (unknown workspace/worktree, not a git working tree, git binary missing): show "Unable to load files" inline with the error message; disable the search input; root context menu's "Refresh" stays enabled so the user can retry.
- **Empty result:** show "No files in this worktree."
- **Search with no matches:** show "No files match '<term>'."
- **`gitSummaryError === true` (git summary load failed, independent of file list):** the tree **still renders normally** using `files.listTracked`. We explicitly **do not** hard-block the pane the way the old `FileList` does. Behavior when the summary is unavailable:
  - Git status indicators on file rows are suppressed (the `changedFiles` array is effectively empty).
  - A single inline warning banner above the tree explains why badges are missing — reuse the existing `gitSummaryMessage` copy if present, otherwise a short fallback.
  - Interaction is otherwise unchanged: expand/collapse, selection, search all work.
- **File selected then removed on refresh:** do nothing automatic — the existing `FileViewer` already renders a read error for missing paths.
- **Identity validation & path escape:** path escape is prevented structurally — the new handler never accepts a raw path from the renderer; it resolves `workspaceId + worktreeId` via the workspace registry and the worktree service, and only the resolved absolute path is handed to `listTrackedFiles`.

## 7. Testing

### 7.1 Unit

- `services/files/file-service.test.ts`
  - Mock `execFile` to assert command shape (`git`, `ls-files`, `--cached`, `--others`, `--exclude-standard`, `-z`) and `cwd`.
  - Verify NUL-separated parsing (including filenames with spaces / unicode).
  - Verify error propagation for non-repo and missing-git cases.
- `electron/main/ipc.test.ts` (or equivalent integration-ish test for the handler)
  - `files:listTracked` with an unknown `workspaceId` rejects with "Unknown workspace".
  - `files:listTracked` with a known workspace but unknown `worktreeId` rejects with "Unknown worktree".
  - Happy path resolves the worktree and calls `listTrackedFiles` with the correct absolute path.
- `src/features/viewer/build-file-tree.test.ts` (renamed from `build-scoped-file-tree.test.ts`)
  - Keep existing assertions; add a case with a path that has > 5 segments to confirm deep nesting.
- `src/features/workspace/workspace-state.test.ts`
  - `session/setTreeExpandedPaths` updates `treeExpandedPaths` on the target session and nowhere else.
  - `workspace/reconcileWorktrees` drops sessions (and their `treeExpandedPaths`) for removed worktrees, confirming natural cleanup.
  - Round-trip through `toSnapshot`/`applySnapshot` (or equivalent) does **not** preserve `treeExpandedPaths` — confirming restart resets expand state.
- `src/features/viewer/WorktreeTree.test.tsx` (new)
  - Renders empty / loading / error / loaded states.
  - On first successful load, dispatches `onExpandedPathsChange` with exactly `[WORKTREE_TREE_ROOT_PATH]` (`[""]`).
  - Row key for the root row is `"dir:"` (sentinel round-trip through virtualizer stub).
  - Clicking a dir toggles expand (dispatches `onExpandedPathsChange`); clicking a file fires `onSelect` and never fires with the root sentinel.
  - Search filter: hides non-matching branches, auto-expands ancestors, does not call `onExpandedPathsChange` while searching (overlay is local); the root row stays visible while search is active.
  - Git status indicator appears for matching `changedFiles` entries; disappears when `gitSummaryError` is true and `changedFiles` is empty.
  - `gitSummaryError === true` still renders the tree (assert row count > 0 for a non-empty `files` array); the old "Unable to load Git data" blocking state must **not** appear.
  - Root context menu → "Refresh" triggers a reload (mock `files.listTracked`).
  - **Stale-response guard:** two `reload()` calls where the first resolves after the second — assert only the second result is applied, `loading` ends `false`, and no duplicate state update happens for the superseded response.
  - **Worktree-switch guard:** `reload()` in flight, component re-renders with a different `worktreeId`; the in-flight response must not overwrite the post-switch state.
  - Virtualization layer stubbed (mock `@tanstack/react-virtual` or override to render all rows) so DOM assertions are straightforward.
- `src/features/viewer/build-file-tree.test.ts`
  - Export and value of `WORKTREE_TREE_ROOT_PATH` is `""` (locks the sentinel down).

### 7.2 E2E

Add `tests/e2e/cumulative-flow.phase-8.test.ts` (or extend the latest phase) covering: open worktree → tree shows the root node → expand a folder → search reveals a deep file → click file → content loads in viewer.

## 8. Rollout / follow-ups

- Phase 1 (this spec): ship `WorktreeTree` and delete `FileList`.
- Phase 2 (follow-up, not in this spec):
  - Remove `files:listScoped` IPC + `listScopedFiles` service method (no remaining consumers).
  - Migrate other renderer-trusts-path endpoints (`files:list`, `files:read`, `git:listChanges`, `git:readDiff`, etc.) to the same identity-based (`workspaceId + worktreeId`) pattern.
  - Consider keyboard navigation and reveal-in-tree from Changes list.
  - Consider persisting expand state across restarts if users ask.

## 9. Risks

- **Very large monorepos** (> 50k tracked files): even with virtualization, the flattened-row computation is O(n) per render. Mitigation: memoize the flat-row computation on `(files, expandedPaths, searchTerm, changedFilesMap)`. If this proves slow in practice, a follow-up can switch to incremental flattening.
- **`git ls-files` latency** on cold caches of huge repos can be a few hundred ms. Acceptable for v1; revisit with a watcher if it becomes a complaint.
- **Filename edge cases** (newline in filename): `-z` flag handles this correctly by using NUL separators.
