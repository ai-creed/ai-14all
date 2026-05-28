# Review chrome redesign — inline editor

Date: 2026-05-28
Project: ai-14all
Status: Draft for review

## Problem

The review chrome forces a context switch every time you want to edit a file. Files mode shows a read-only `FileViewer`; editing requires invoking `EditorModal`, a full-screen overlay that hides the surrounding context (tree, queue panel, diffs in adjacent modes). Combined with the read-only-then-edit handoff, this adds two friction steps to a common task. The tree also hides gitignored files unconditionally, so `.env*` and gitignored documentation are unreachable without leaving the app.

## Goals

- Eliminate the modal edit. Files-mode pane is always-editable in place when the file is whitelisted; read-only otherwise.
- Surface gitignored files on demand without flooding the tree with `node_modules` and similar.
- Preserve every existing safety: whitelist, mtime conflict detection, dirty-state confirmation, save-conflict resolution.

## Non-goals

- Changes / Commits diff viewers stay read-only.
- No multi-file tabs or split view. Single editor pane, one file at a time.
- Removing the editable-files whitelist. Non-whitelisted files remain read-only.
- Restructuring `ReviewQueuePanel`, inline review comments, or `ReviewExpandedPortal` positioning.
- ⌘P `FilesOverlay` stays; only its callbacks collapse (view + edit → open).

## Design

### Pane shape

Selected option C from the visual brainstorm: bare editor when clean, sticky bar when dirty.

- The pane shows Monaco only. No persistent toolbar. The file path lives in the existing review header / breadcrumb path.
- When the buffer differs from the loaded `pristineContent`, an `EditorDirtyBar` slides in at the bottom of the pane. It shows: dirty dot, "Unsaved changes", `⌘S` hint, **Save**, **Discard**.
- The bar unmounts on clean (after save or discard).

### Components

New, under `src/features/viewer/components/`:

- `InlineEditor.tsx`
  - Props: `workspaceId`, `worktreeId`, `relativePath`, `resolvedTheme`, `onSaved?()` (so `ReviewArea` can `bumpRefreshKey` on save, matching today's `EditorModal` behavior), `onDirtyChange?(dirty: boolean)` (pushes the dirty bit to main via `app.setEditorDirty(...)`; consumer also subscribes for any UI mirroring).
  - Owns: loaded `pristineContent`, `pristineMtimeMs`, current buffer (via Monaco model), `dirty` boolean derived from buffer vs pristine.
  - Mounts Monaco with `readOnly = !isEditable(basename(relativePath))`.
  - Keys on `workspaceId|worktreeId|relativePath` so file switch remounts cleanly.
  - Exposes imperative handle `{ requestSwitch(): Promise<"proceed" | "cancel"> }` for parent gating.
- `EditorDirtyBar.tsx`
  - Props: `onSave()`, `onDiscard()`. Pure presentational.
  - Hidden by default; rendered by `InlineEditor` only when `dirty === true`.

Deleted:

- `src/features/viewer/components/FileViewer.tsx` (read-only viewer, superseded).
- `src/features/viewer/components/EditorModal.tsx` (overlay editor, removed entirely).

Modified:

- `src/app/components/ReviewArea.tsx`
  - Files-mode body becomes `<InlineEditor ... ref={inlineEditorRef} />`. Tree click runs through the dirty gate (see Data flow).
  - Removes `editorTarget`, `setEditorTarget`, `openEditorForFile`, `openEditorError` props and all references.
- `src/app/App.tsx`
  - Drops the lifted `editorTarget` state and `openEditorForFile` helper.
  - Adds a listener for the new `app:requestClose` IPC and renders `ConfirmCloseDialog` driven by it (see Data flow → app/window close).
- `electron/main/windows.ts`
  - Adds a `window.on("close", handler)` that prevents the default close when any editor is dirty, sends `app:requestClose` to the renderer, and destroys the window on `app:confirmClose({ proceed: true })`. A 5 s safety timeout treats no-reply as proceed.
- `electron/main/ipc.ts`
  - Registers the new IPC channels `app:setEditorDirty` (renderer → main) and `app:confirmClose` (renderer → main).
  - Adds an outbound `app:requestClose` send from the close handler to the renderer.
- `electron/preload/index.ts`
  - Exposes `app.setEditorDirty(...)`, `app.confirmClose(...)`, and `app.onRequestClose(listener)`.
- `src/features/viewer/components/WorktreeTree.tsx`
  - Accepts `showIgnored: boolean` and `onToggleShowIgnored`.
  - Renders a "Show ignored" toggle in its header row.
  - Renders rows with `data-ignored="true"` and a dimmed style when `node.ignored`.
- `src/features/viewer/logic/build-file-tree.ts` and `flatten-tree-to-rows.ts`
  - Input row type gains `ignored: boolean`. Tree nodes and flattened rows propagate it (a directory is `ignored` iff every leaf under it is ignored — used only for visual dimming, optional).
- `src/features/files/FilesOverlay.tsx`
  - `onViewFile` and `onEditFile` collapse to `onOpenFile(path)`.
  - The footer hints become `↵ Open · Esc Close`. The ⌘↵ branch and `data-edit-available` testid attribute are removed.
- `services/files/file-service.ts`
  - `listTrackedFiles(worktreePath)` is replaced by `listWorktreeFiles(worktreePath, { includeIgnored: boolean })`.
  - Returns `{ path: string; ignored: boolean }[]`.
  - `includeIgnored: false` — `git ls-files --cached --others --exclude-standard -z`. All `ignored: false`.
  - `includeIgnored: true` — union with `git ls-files --others --ignored --exclude-standard -z`. Ignored entries get `ignored: true`. The constant denylist (next section) is applied regardless of flag.
- `shared/contracts/commands.ts`
  - `files:listTracked(workspaceId, worktreeId)` becomes `files:list(workspaceId, worktreeId, { includeIgnored: boolean })` with the new return type.
- `electron/preload/index.ts` and `electron/main/ipc.ts`
  - Wire the renamed IPC.
- `src/features/workspace/logic/workspace-state.ts`
  - New per-session field `treeShowIgnored: boolean` (default `false`).
  - New action `session/setTreeShowIgnored` with the obvious reducer entry.

New shared module:

- `shared/files/ignored-denylist.ts`
  - Exports `IGNORED_DENYLIST: readonly string[]` = `["node_modules", ".git", "dist", "build", ".next", ".cache", ".turbo", "target", ".venv", "venv", "__pycache__", ".gradle", ".idea", "vendor"]`.
  - Exports `isUnderDenylistedDir(path: string): boolean` — returns true iff any path segment equals one of the denylist names.
  - Used by `file-service` to filter results before returning, and re-exported for any future renderer-side sanity check.

### Data flow

Initial load (Files mode, file selected):

1. `selectedFilePath` changes → `InlineEditor` remounts on its file key.
2. Branch by whitelist (`isEditable(basename(relativePath))`):
   - **Editable**: call `files.openForEdit(workspaceId, worktreeId, relativePath)` → existing IPC `files:openForEdit` returns
     - `{ ok: true, content: string, mtimeMs: number }` on success, or
     - `{ ok: false, reason: "not-found" | "not-editable" | "binary" | "too-large" | "permission-denied" | "path-escape" | "read-failed" }` on failure.
     On `ok: true` → mount Monaco editable, set `pristineContent = content`, `pristineMtimeMs = mtimeMs`, `dirty = false`.
   - **Not editable**: call `files.read(workspaceId, worktreeId, relativePath)` → existing IPC `files:read` returns `FileReadResult` (`{ ok: true, view: { path, content, language } } | { ok: false, path, reason: { kind: "too-large" | "binary" | "not-found" | "read-failed", size? } }`). On `ok: true` → mount Monaco read-only with `view.content`. No `pristineMtimeMs` is needed because save is impossible.
3. Any `ok: false` (either branch) → render a guard message keyed off the failure `reason` (matches today's `FileViewer` failure rendering). No editor mounted.
4. The two-path split is deliberate: only `files.openForEdit` carries `mtimeMs`, and we only need `mtimeMs` for files we can save. Today's `EditorModal` uses exactly this IPC for the same reason; reusing it preserves mtime conflict detection without touching the contract.

Editing:

1. Monaco `onDidChangeModelContent` → `dirty = (currentValue !== pristineContent)`.
2. `EditorDirtyBar` mounts on `dirty === true`.
3. ⌘S is wired via Monaco's editor command `KeyMod.CtrlCmd | KeyCode.KeyS` calling `save()`.

Save:

1. Call `files.save(workspaceId, worktreeId, relativePath, content, expectedMtimeMs = pristineMtimeMs)`. This is the existing IPC `files:save` whose contract is:
   - `{ ok: true, mtimeMs: number }` on success.
   - `{ ok: false, reason: "mtime-conflict", currentMtimeMs: number }` when the file changed on disk since load.
   - `{ ok: false, reason: "not-found" | "not-editable" | "path-escape" | "permission-denied" | "disk-full" | "write-failed" }` for other failures.
2. `ok: true` → `pristineContent = content`, `pristineMtimeMs = mtimeMs`, `dirty = false`. Toast "Saved".
3. `reason === "mtime-conflict"` → open existing `SaveConflictDialog` carrying `currentMtimeMs`. Outcomes:
   - **Overwrite**: re-call `files.save` with `expectedMtimeMs = currentMtimeMs` (from the conflict response). On success, advance pristine state.
   - **Reload**: re-call `files.openForEdit` to fetch fresh `content` + `mtimeMs`, replace buffer (losing local edits), reset pristine state, `dirty = false`.
   - **Keep mine**: close dialog; buffer stays dirty for further edits.
4. Other `ok: false` → toast with `reason`. Buffer stays dirty.

Revert / Discard:

- If `|currentValue.length - pristineContent.length| > 50` (a rough "non-trivial edit" guard), open a `window.confirm("Discard unsaved changes?")` before resetting. Otherwise reset directly.
- Reset sets Monaco value to `pristineContent`, `dirty = false`.

Dirty switch — in-renderer flows (tree click, ⌘P pick, worktree switch):

1. `ReviewArea` holds `inlineEditorRef`. Tree `onSelect` becomes async.
2. If `inlineEditorRef.current?.requestSwitch()` returns `"cancel"` → no dispatch, tree's selection visually snaps back via the controlled `selectedFile` prop (no change to state).
3. `requestSwitch` internally:
   - `dirty === false` → resolves `"proceed"` immediately.
   - `dirty === true` → opens existing `ConfirmCloseDialog` with three choices.
     - Save → runs the save flow; resolves `"proceed"` on success, `"cancel"` on failure.
     - Discard → resets buffer; resolves `"proceed"`.
     - Cancel → resolves `"cancel"`.
4. Worktree switch (changing `activeWorktreeId`) is gated by the same async `requestSwitch` because it happens entirely in the renderer.

Dirty switch — app/window close (cannot be async in `beforeunload`):

`beforeunload` runs synchronously and cannot await a React dialog. The app-close gate is therefore implemented across main and renderer:

1. **Dirty-state sync (renderer → main)**: `InlineEditor` calls a new fire-and-forget IPC `app:setEditorDirty({ workspaceId, worktreeId, relativePath, dirty })` on every dirty-state transition. Main keeps a single in-memory `Map<string, true>` keyed by `${workspaceId}|${worktreeId}|${relativePath}`; the map is updated synchronously on receipt.
2. **Main `window.on("close")` handler** (added in `electron/main/windows.ts`):
   - If the dirty map is empty → allow close (default).
   - Otherwise → `event.preventDefault()`, mark a `pendingClose` flag, and send `app:requestClose` to the renderer (`webContents.send`).
3. **Renderer close handler**: a new App-level listener on `app:requestClose` opens `ConfirmCloseDialog` with Save / Discard / Cancel.
   - **Save**: iterate dirty buffers, run the save flow for each. On all success → send `app:confirmClose({ proceed: true })`. On any failure → toast + send `{ proceed: false }`.
   - **Discard**: clear dirty flags (do not write) → `{ proceed: true }`.
   - **Cancel**: `{ proceed: false }`.
4. **Main on `app:confirmClose`**: if `proceed === true` → call `mainWindow.destroy()` (bypasses the prevented close); if `false` → clear `pendingClose`, leave window open.
5. The existing `beforeunload` cleanup listener in `App.tsx` stays as-is; it only handles renderer-side teardown, not user-facing confirmation. Renderer-side `requestSwitch` is **not** invoked from `beforeunload`.

Failure modes:
- If the renderer never replies (e.g. crash) within 5 seconds of `app:requestClose`, main treats it as `{ proceed: true }` and destroys the window, to avoid leaving a non-closable app.
- If the dirty map gets out of sync (e.g. renderer crash mid-edit), the worst case is a needless close confirmation; the user can Discard.

"Show ignored" toggle:

1. Header toggle dispatches `session/setTreeShowIgnored`.
2. `WorktreeTree` re-fetches via `files.list({ includeIgnored: <new value> })`.
3. Service applies `IGNORED_DENYLIST` filtering on every call regardless of the flag — so `node_modules`, `.git`, etc. are never returned.
4. Rows with `ignored: true` render with `[data-ignored="true"]` styling (CSS dims color).

### Error handling

- `files.openForEdit` or `files.read` `ok: false` → guard message keyed off `reason`; no editor mount, no dirty bar.
- `files.save` `reason === "mtime-conflict"` → `SaveConflictDialog` (see Save flow).
- Other `files.save` `ok: false` → toast with `reason`; buffer stays dirty.
- Non-whitelisted file → loaded via `files.read`; Monaco `readOnly: true`; the dirty bar can never appear; ⌘S is a no-op.
- ⌘P picks a non-whitelisted file → still opens; editor is read-only.
- Renderer crash during dirty edits → main's 5 s safety timeout on `app:requestClose` lets the window close instead of hanging.

### Testing strategy

Unit:

- `shared/files/ignored-denylist.test.ts` — `node_modules/foo` matched; `node_modules_legit/foo` not matched; root `node_modules` matched; nested `packages/x/node_modules/y` matched; case sensitivity matches the filesystem we target (case-sensitive comparison; matches macOS APFS default-case-insensitive only when basenames already align — leave case-insensitive matching out of scope).
- `services/files/file-service.test.ts` — `listWorktreeFiles({ includeIgnored: false })` returns tracked + untracked-not-ignored, all `ignored: false`; `{ includeIgnored: true }` adds gitignored entries with `ignored: true`; denylist prefixes never appear in either response. Use the existing temp-git-repo fixture.
- `src/features/viewer/logic/build-file-tree.test.ts` — extend to verify `ignored` propagates from leaves to display rows.
- `src/features/viewer/components/InlineEditor.test.tsx`
  - Whitelisted path → uses `files.openForEdit`; editor mounts with returned `content`, editable.
  - Non-whitelisted path → uses `files.read`; editor mounts read-only with `view.content`.
  - Failure reasons from either IPC (`too-large` / `binary` / `not-found` / `permission-denied` / `path-escape` / `read-failed` / `not-editable`) render the matching guard message.
  - ⌘S calls `files.save` with `expectedMtimeMs` equal to the `mtimeMs` returned by the original `files.openForEdit`. On `ok: true` clears dirty and advances `pristineMtimeMs`.
  - `files.save` returning `reason: "mtime-conflict"` opens `SaveConflictDialog`; Overwrite re-calls `files.save` with `currentMtimeMs`; Reload re-calls `files.openForEdit` and replaces the buffer.
  - Dirty transitions push `app.setEditorDirty({ ..., dirty })` to main (mocked at the preload boundary).
- `src/features/viewer/components/EditorDirtyBar.test.tsx` — not rendered when clean; renders Save / Discard when dirty; Discard prompts confirm when buffer delta exceeds 50 chars; both buttons call the right handlers.
- `src/features/files/FilesOverlay.test.tsx` — update existing tests for the collapsed `onOpenFile` callback, removed ⌘↵ branch, and new footer hints.
- `src/features/workspace/logic/workspace-state.test.ts` — `session/setTreeShowIgnored` persists per-worktree.
- `electron/main/windows.test.ts` (new) — when no editor is dirty, the `close` handler does not call `event.preventDefault()`; when the dirty map is non-empty, it prevents the default and `webContents.send("app:requestClose", ...)` is invoked; on `app:confirmClose({ proceed: true })` the window is destroyed; on `{ proceed: false }` it is not; the 5 s safety timeout destroys the window when the renderer never responds. Use fake timers + mocked `BrowserWindow`/`webContents`.
- `tests/unit/app/close-gate.test.tsx` (new) — App listens for `app:requestClose`, opens `ConfirmCloseDialog`, and dispatches `app:confirmClose` with `proceed: true` on Save (all saves succeed), `proceed: true` on Discard, `proceed: false` on Cancel; on save failure for any buffer, it surfaces a toast and sends `proceed: false`.

Integration (Vitest + React Testing Library):

- `tests/unit/components/ReviewArea-files-mode.test.tsx`
  - Selecting a file in tree mounts `InlineEditor`.
  - Typing flips dirty bar visible; ⌘S saves and hides bar.
  - Selecting a different file while dirty opens `ConfirmCloseDialog`; Save proceeds; Cancel keeps current file selected.
- Tree "Show ignored" off → `.env` absent; on → `.env` present, dimmed; `node_modules/foo.js` absent in both states.

E2E (Playwright):

- New spec `tests/e2e/files-mode-inline-edit.spec.ts`:
  1. Open worktree, switch to Files mode, pick a `.md` file → editor visible, no dirty bar.
  2. Type → dirty bar appears with Save and Discard.
  3. Click Save → bar disappears; reload worktree → content persisted.
  4. Type again → click another file in tree → `ConfirmCloseDialog` appears → click Save → switch completes.
  5. Toggle "Show ignored" → `.env` appears and is dimmed; `node_modules/` never appears.

Manual smoke:

- Non-whitelisted file (e.g. `.png`) → guard message, no editor.
- Large file (over the existing size guard) → too-large guard.
- Worktree switch with dirty buffer → in-renderer `requestSwitch` dialog gates the switch.
- App quit (⌘Q / window close) with dirty buffer → main prevents close, `ConfirmCloseDialog` appears; Save persists then closes; Discard closes; Cancel keeps app open.
- Force-kill renderer mid-edit → main's 5 s safety timeout closes the window cleanly.

## Migration

- The IPC channel rename (`files:listTracked` → `files:list`) is a renderer + main coordinated change. No on-disk schema.
- `treeShowIgnored` is an additive session-state field; default `false` so existing sessions behave as today.
- No data migration required.

## Risks and open questions

- **Show-ignored performance**: `git ls-files -o --ignored --exclude-standard` can be large in repos with many ignored files even after the denylist. If a repo has a few thousand gitignored entries outside denylisted dirs, the tree will render them all. Mitigation: the toggle is off by default; if real-world usage is slow, a follow-up can add a depth cap or lazy expansion. Not addressed in this redesign.
- **Discard guard threshold**: 50 chars is arbitrary. May need tuning after manual use; trivial to change.
- **Read-only feedback on non-whitelisted files**: users may expect to edit any file. Today's whitelist already enforces this; the redesign does not change the gate. Consider a small inline indicator (`read-only` chip) on read-only mount — included in `InlineEditor` scope.
