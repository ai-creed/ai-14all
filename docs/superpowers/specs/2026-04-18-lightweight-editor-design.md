# Lightweight Editor — Design Spec

**Date:** 2026-04-18
**Status:** Approved (brainstorm) — revised after code review

## Overview

Add a modal-based lightweight editor for quick, minor edits of agent-authored files and small configuration files, without launching a real IDE. Triggered by an "Edit" context menu item on the worktree tree or `Cmd+E` when a whitelisted file is selected. The editor opens in a centered modal, mirroring the pattern established by `MarkdownPreviewModal`. Explicit save only (`Cmd+S` or Save button); no auto-save.

On-disk conflicts with concurrent writers (e.g. agents, other tools) are detected on a **best-effort basis** via `mtime` precondition at save time. See Conflict Detection Limits.

**Goals:** fast-path editing for small tweaks; zero new runtime dependencies; composable with existing preview/tree patterns.

**Non-goals:** multi-file tabs, project-wide find/replace, syntax-aware refactors, Git integration, live file-watching (deferred to a future version).

## Relation to AD-010

The "read-only embedded code viewer" decision in `docs/shared/architecture_decisions.md` (AD-010) is amended, not overturned, for this spec:

- The inline viewer (Monaco inside the viewer panel) remains read-only.
- Editing is an **explicit opt-in modal**, never an inline action.
- Scope is held to the whitelist below plus single-buffer, explicit-save semantics — no IDE features (tabs, project-wide find/replace, refactors, live file-watching, Git integration).
- `high_level_plan.md` and the Phase 4 spec are updated to reflect that only **full** editable IDE workflows remain deferred.

## Trigger & Interaction

**Worktree tree:**
- Right-clicking a file node shows an "Edit" item **only when the file is editable** (see Whitelist).
- Selecting a file and pressing `Cmd+E` is equivalent; the shortcut is a no-op when the selected file is not editable.

**Editor modal:**
- Opens centered over the app, captures focus and pointer events (worktree/session switches are unreachable while open).
- Dismissed by: Close button, `Esc`, backdrop click — all route through the same close path.
- Close with a clean buffer closes immediately; close with a dirty buffer shows a confirm dialog (Save / Discard / Cancel).

**Save:**
- Save button in the modal footer (bottom-right) and `Cmd+S` shortcut.
- Both enabled only when `dirty === true` (buffer differs from last-loaded content).
- While a save is in-flight, additional save presses are ignored.

## Whitelist

A file is "editable" when its basename or extension matches the whitelist. The same predicate gates:
- visibility of the "Edit" context menu item,
- the `Cmd+E` shortcut handler,
- the `file:openForEdit` IPC handler (defense-in-depth).

**By exact basename:** `.gitignore`, `.gitattributes`, `.editorconfig`, `.prettierrc`, `.prettierignore`, `.eslintignore`, `.npmrc`, `.nvmrc`, `.dockerignore`, `Dockerfile`, `Makefile`, `LICENSE`, `README`.

**By extension:** `.md`, `.txt`, `.json`, `.yml`, `.yaml`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss`, `.html`, `.sh`, `.py`, `.toml`, `.env`, `.ini`, `.conf`, `.xml`, `.lock`.

Match basename first, then extension (case-sensitive for basenames, case-insensitive for extensions).

## Components

### `src/features/viewer/EditorModal.tsx`
Modal shell hosting `@monaco-editor/react`. Props: `worktreePath`, `relativePath`, `initialContent`, `initialMtimeMs`, `onClose`. Owns local state: `content`, `dirty`, `saving`, `conflict`. Built on the existing `@radix-ui/react-dialog` primitive — the same primitive used by `MarkdownPreviewModal` and other modals in the app. No new runtime dependencies are added.

Monaco configuration:
- language resolved by extension (or `plaintext` for basename-matched config files with no extension hint),
- line numbers on,
- find widget (`Cmd+F`) enabled,
- minimap off, command palette off, replace off, suggestions off.

### `src/features/viewer/ConfirmCloseDialog.tsx`
A `@radix-ui/react-dialog` dialog with Save / Discard / Cancel. Invoked from `EditorModal` when close is requested with a dirty buffer.

### `src/features/viewer/SaveConflictDialog.tsx`
Shown when `file:save` returns `{ok: false, reason: 'mtime-conflict'}`. Offers Reload / Overwrite / Cancel. Reload with a dirty buffer re-prompts for confirmation.

### `shared/editor/editableFiles.ts`
Pure helper: `isEditable(basename: string): boolean`. Single source of truth for the whitelist, imported by renderer (menu/shortcut gating) and main (IPC guard).

### `services/files/file-service.ts`
Extended with `openForEdit` and `saveFile` methods. Both reuse the existing worktree-escape rejection already used by `readFile` (`services/files/file-service.ts:123`). This keeps all file IPC relative to a trusted `worktreePath`.

### `electron/ipc/fileEdit.ts`
Two handlers registered on the file IPC bridge:
- `file:openForEdit({worktreePath, relativePath})` → `{ok, content, mtimeMs}` or `{ok: false, reason}`.
- `file:save({worktreePath, relativePath, content, expectedMtimeMs})` → `{ok, mtimeMs}` or `{ok: false, reason, currentMtimeMs?}`.

Schemas defined in `shared/contracts/commands.ts` with Zod (mirroring `ReadFileSchema`: `{worktreePath, relativePath}`). Validated on both sides.

### Modified files
- `src/features/viewer/WorktreeTree.tsx` — add "Edit" context menu item gated by `isEditable`; expose `onEditFile` callback.
- `src/app/App.tsx` — own editor modal open state and loaded buffer; wire `onEditFile` from the tree and `Cmd+E` global shortcut.
- `electron/preload/*` — expose `openForEdit` and `save` on the existing file bridge.

No shared code is extracted from `MarkdownPreviewModal` in v1; the pattern is referenced, not refactored.

## Data Flow

### Open
1. User triggers "Edit" (menu or `Cmd+E`); renderer asserts `isEditable(basename(relativePath))`.
2. Renderer calls `window.api.file.openForEdit({worktreePath, relativePath})`.
3. Main resolves the absolute path against `worktreePath` and rejects if it escapes the worktree (reusing `file-service.ts:123` logic).
4. Main re-checks `isEditable`; if false → reject.
5. Main runs a binary sniff (null byte in first 8 KB); if hit → reject.
6. Main `stat(path)`; if size > 1 MB → reject.
7. Main reads UTF-8 content, returns `{ok: true, content, mtimeMs}`.
8. Renderer stores `{worktreePath, relativePath, originalContent: content, content, mtimeMs, dirty: false}` and mounts `EditorModal`.

### Edit
- Monaco `onChange` updates `content`; `dirty` becomes `content !== originalContent`.
- Save affordances enable/disable strictly on `dirty`.

### Save
1. User presses `Cmd+S` or clicks Save; `saving` flag set, concurrent presses ignored.
2. Renderer calls `window.api.file.save({worktreePath, relativePath, content, expectedMtimeMs: mtimeMs})`.
3. Main resolves path, rejects escape, re-checks `isEditable`.
4. Main `stat(path)`:
   - Missing → `{ok: false, reason: 'not-found'}`.
   - `mtimeMs !== expectedMtimeMs` → `{ok: false, reason: 'mtime-conflict', currentMtimeMs}`.
5. Otherwise main writes UTF-8, re-stats, returns `{ok: true, mtimeMs}`.
6. On success: `originalContent = content`, `dirty = false`, `mtimeMs` updated, toast "Saved".
7. On conflict: `SaveConflictDialog` shown. Reload → re-run Open (with dirty-buffer re-confirm). Overwrite → re-save with `expectedMtimeMs = currentMtimeMs`. Cancel → dismiss, buffer stays dirty.

### Close
- Clean → close immediately.
- Dirty → `ConfirmCloseDialog`:
  - Save → attempts save; on success closes; on failure stays open with error toast.
  - Discard → close without save.
  - Cancel → dismiss, stay open.

## Conflict Detection Limits (Honest Bound)

Mtime precondition is a **best-effort** check, not a guarantee. A TOCTOU window exists between the pre-save `stat` and the subsequent write: a concurrent writer landing a change inside that window is not detected and will be silently overwritten (last-writer-wins). Node's `fs` API does not expose portable file locking, so this is inherent to the chosen mechanism.

This is acceptable for v1 because:
- The window is small (microseconds to low milliseconds).
- The target use cases (minor edits of config files and agent-authored files) are not hot-write paths.
- The v1 UX intent is "show a dialog when we detect a conflict," not "prevent all conflicts."

Stronger guarantees (e.g. sidecar lockfile, `fs.watch`-based live detection, post-write verify) are explicitly deferred. See Future Work.

## Error Handling

**Open errors (surfaced as toasts; modal does not open):**
- `ENOENT` / stat failure → "File not found".
- Path escape attempt → "Invalid file path" (should not occur from normal UI).
- Whitelist bypass attempt → "File type not editable".
- Binary sniff hit → "Binary file not editable".
- Size > 1 MB → "File too large for quick editor".
- `EACCES` on read → "Permission denied".

**Save errors (surfaced as toasts; buffer stays dirty):**
- `mtime-conflict` → conflict dialog (see Data Flow).
- `ENOENT` (deleted mid-edit) → "File no longer exists"; "Save as copy" is deferred.
- `EACCES` / `EROFS` → "Cannot write: <reason>".
- `ENOSPC` → "Disk full".

**Runtime:**
- Concurrent writes from agents are not detected live in v1; the mtime precondition catches them at save time within the best-effort bound above.
- Worktree removed/renamed while modal is open → `worktreePath` becomes stale; next save surfaces as path escape or `ENOENT`.
- Monaco bundle load failure → modal body renders an inline error message; Close still works.

**Always:**
- All IPC results validated against Zod schemas at the renderer boundary; schema mismatch surfaces an error toast and closes the modal.
- All errors are logged via the existing logger; never swallowed.

## Testing

Follows TDD per project convention: failing tests first, then implementation.

**Unit (Vitest):**
- `shared/editor/editableFiles.test.ts` — extension hits, basename hits, unknown miss, case sensitivity, dotfile edge cases (`.env`, `.gitignore`), binary extensions miss.
- `EditorModal.test.tsx` (React Testing Library):
  - opens with content and is not dirty;
  - typing sets `dirty`, Save enables;
  - `Cmd+S` when clean is a no-op;
  - `Cmd+S` when dirty calls save IPC exactly once; a second press while pending is ignored;
  - save success clears `dirty`, updates `mtimeMs`, surfaces "Saved" toast;
  - save `mtime-conflict` renders `SaveConflictDialog`; Reload, Overwrite, Cancel each wired;
  - close clean dismisses immediately;
  - close dirty renders `ConfirmCloseDialog`; Save, Discard, Cancel each wired;
  - `Esc` routes through the same close path.
- `services/files/file-service.test.ts` — `openForEdit` happy path, path-escape reject, whitelist reject, binary reject, size reject, `ENOENT`; `saveFile` happy path, mtime mismatch returns `currentMtimeMs`, path-escape reject, `ENOENT` / `EACCES` mapped.

**E2E (Playwright, extends the cumulative flow suite per `docs/superpowers/specs/2026-04-03-cumulative-phase-e2e-coverage-design.md`):**

New file `tests/e2e/cumulative-flow.phase-9.test.ts` follows the existing `cumulative-flow.phase-N` naming and continues the cumulative product flow, asserting earlier phase behavior still holds:
- Open a whitelisted file via "Edit" context menu → modal appears with content.
- Type, save via `Cmd+S`, reopen → content persisted on disk.
- Non-whitelisted file → "Edit" item hidden.
- `Cmd+E` with a non-whitelisted selection → no-op.
- Close with a dirty buffer → `ConfirmCloseDialog` appears.
- Mtime conflict: write the file externally between open and save → `SaveConflictDialog` appears.

`launchApp` timeout and retries follow the current phase-6/7/8 convention.

## Future Work (explicitly out of scope for v1)

- **Live conflict detection** via `fs.watch` on the open path, with a non-blocking banner inside the modal when the file changes on disk.
- **Stronger write contract** (sidecar lockfile, post-write verify, or atomic rename with lease semantics) to close the TOCTOU window.
- **"Save as copy"** path when the original file is deleted mid-edit.
- **Multi-file tabs** or recent-file dropdown.
- **Integration with Preview** for `.md` files (one-click toggle between Edit and Preview in the same modal).
