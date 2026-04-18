# Lightweight Editor — Design Spec

**Date:** 2026-04-18
**Status:** Approved (brainstorm)

## Overview

Add a modal-based lightweight editor for quick, minor edits of agent-authored files and small configuration files, without launching a real IDE. Triggered by a "Edit" context menu item on the worktree tree or `Cmd+E` when a whitelisted file is selected. The editor opens in a centered modal, mirroring the pattern established by `MarkdownPreviewModal`. Explicit save only (`Cmd+S` or Save button); no auto-save. On-disk conflicts with concurrent writers (e.g. agents, other tools) are detected via `mtime` precondition at save time.

**Goals:** fast-path editing for small tweaks; zero new runtime dependencies; composable with existing preview/tree patterns.

**Non-goals:** multi-file tabs, project-wide find/replace, syntax-aware refactors, Git integration, live file-watching (deferred to v2).

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
Modal shell hosting `@monaco-editor/react`. Props: `path`, `initialContent`, `initialMtimeMs`, `onClose`. Owns local state: `content`, `dirty`, `saving`, `conflict`. Renders Monaco with:
- language resolved by extension (or `plaintext` for basename-matched config files with no extension hint),
- line numbers on,
- find widget (`Cmd+F`) enabled,
- minimap off, command palette off, replace off, suggestions off.

### `src/features/viewer/ConfirmCloseDialog.tsx`
Radix `AlertDialog` with Save / Discard / Cancel. Invoked from `EditorModal` when close is requested with a dirty buffer.

### `src/features/viewer/SaveConflictDialog.tsx`
Shown when `file:save` returns `{ok: false, reason: 'mtime-conflict'}`. Offers Reload / Overwrite / Cancel. Reload with a dirty buffer re-prompts for confirmation.

### `shared/editor/editableFiles.ts`
Pure helper: `isEditable(basename: string): boolean`. Single source of truth for the whitelist, imported by renderer (menu/shortcut gating) and main (IPC guard).

### `electron/ipc/fileEdit.ts`
Two handlers registered on the file IPC bridge:
- `file:openForEdit(path)` → `{ok, content, mtimeMs}` or `{ok: false, reason}`.
- `file:save({path, content, expectedMtimeMs})` → `{ok, mtimeMs}` or `{ok: false, reason, currentMtimeMs?}`.

Schemas defined in `shared/ipc/` with Zod, validated on both sides.

### Modified files
- `src/features/viewer/WorktreeTree.tsx` — add "Edit" context menu item gated by `isEditable`; expose `onEditFile` callback.
- `src/app/App.tsx` — own editor modal open state and loaded buffer; wire `onEditFile` from the tree and `Cmd+E` global shortcut.
- `electron/preload/*` — expose `openForEdit` and `save` on the existing file bridge.

No shared code is extracted from `MarkdownPreviewModal` in v1; the pattern is referenced, not refactored.

## Data Flow

### Open
1. User triggers "Edit" (menu or `Cmd+E`); renderer asserts `isEditable(basename(path))`.
2. Renderer calls `window.api.file.openForEdit(path)`.
3. Main re-checks `isEditable`; if false → reject.
4. Main runs a binary sniff (null byte in first 8 KB); if hit → reject.
5. Main `stat(path)`; if size > 1 MB → reject.
6. Main reads UTF-8 content, returns `{ok: true, content, mtimeMs}`.
7. Renderer stores `{path, originalContent: content, content, mtimeMs, dirty: false}` and mounts `EditorModal`.

### Edit
- Monaco `onChange` updates `content`; `dirty` becomes `content !== originalContent`.
- Save affordances enable/disable strictly on `dirty`.

### Save
1. User presses `Cmd+S` or clicks Save; `saving` flag set, concurrent presses ignored.
2. Renderer calls `window.api.file.save({path, content, expectedMtimeMs: mtimeMs})`.
3. Main `stat(path)`:
   - Missing → `{ok: false, reason: 'not-found'}`.
   - `mtimeMs !== expectedMtimeMs` → `{ok: false, reason: 'mtime-conflict', currentMtimeMs}`.
4. Otherwise main writes UTF-8, fsyncs, re-stats, returns `{ok: true, mtimeMs}`.
5. On success: `originalContent = content`, `dirty = false`, `mtimeMs` updated, toast "Saved".
6. On conflict: `SaveConflictDialog` shown. Reload → re-run Open (with dirty-buffer re-confirm). Overwrite → re-save with `expectedMtimeMs = currentMtimeMs`. Cancel → dismiss, buffer stays dirty.

### Close
- Clean → close immediately.
- Dirty → `ConfirmCloseDialog`:
  - Save → attempts save; on success closes; on failure stays open with error toast.
  - Discard → close without save.
  - Cancel → dismiss, stay open.

## Error Handling

**Open errors (surfaced as toasts; modal does not open):**
- `ENOENT` / stat failure → "File not found".
- Whitelist bypass attempt → "File type not editable".
- Binary sniff hit → "Binary file not editable".
- Size > 1 MB → "File too large for quick editor".
- `EACCES` on read → "Permission denied".

**Save errors (surfaced as toasts; buffer stays dirty):**
- `mtime-conflict` → conflict dialog (see Data Flow).
- `ENOENT` (deleted mid-edit) → "File no longer exists"; "Save as copy" is deferred to a later version.
- `EACCES` / `EROFS` → "Cannot write: <reason>".
- `ENOSPC` → "Disk full".

**Runtime:**
- Concurrent writes from agents are **not detected live in v1**; mtime precondition catches them at save time. Live detection via `fs.watch` is deferred to v2 (see Future Work).
- Worktree removed/renamed while modal is open → path becomes stale; next save surfaces as `ENOENT` per above.
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
- `electron/ipc/fileEdit.test.ts` — openForEdit happy path, whitelist reject, binary reject, size reject, `ENOENT`; save happy path, mtime mismatch returns `currentMtimeMs`, `ENOENT` / `EACCES` mapped.

**E2E (Playwright, new `tests/e2e/phase-9-editor.spec.ts`):**
- Open a whitelisted file via "Edit" context menu → modal appears with content.
- Type, save via `Cmd+S`, reopen → content persisted on disk.
- Non-whitelisted file → "Edit" item hidden.
- `Cmd+E` with a non-whitelisted selection → no-op.
- Close with a dirty buffer → `ConfirmCloseDialog` appears.
- Mtime conflict: write the file externally between open and save → `SaveConflictDialog` appears.

E2E phase structure mirrors `phase-8`, with `launchApp` timeout tuned consistently with recent phases.

## Future Work (explicitly out of scope for v1)

- **Live conflict detection** via `fs.watch` on the open path, with a non-blocking banner inside the modal when the file changes on disk (Q3 option D).
- **"Save as copy"** path when the original file is deleted mid-edit.
- **Multi-file tabs** or recent-file dropdown.
- **Integration with Preview** for `.md` files (one-click toggle between Edit and Preview in the same modal).
