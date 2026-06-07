# Files Pane Symbol Search — Design

**Date:** 2026-06-06
**Status:** Approved (brainstorm), pending implementation plan
**Branch base:** `wip/code-nav-2026-05-30`
**Supersedes:** the standalone `SymbolPalette` (Cmd+T) modal

## Problem

The Cmd+T symbol palette (`src/features/code-nav/palette/SymbolPalette.tsx`) is
functionally complete but visually unstyled — its search input, result `<ul>`,
rows, kind glyphs, and status banners have **zero dedicated CSS**, inheriting
only the `AppDialog` shell. It is also a standalone modal disconnected from the
place a user actually navigates code: the **Files** tab of the Review overlay,
which already hosts a file tree + file-search box (`WorktreeTree`) beside the
open editor.

## Goal

Relocate symbol search into the **Files-tab pane** of the Review overlay as a
**Files | Symbols** mode switch, and redesign the symbol list to a polished,
VS Code "Go to Symbol"–style layout. Searching symbols then happens in the same
pane the user already uses to browse files, while a file is open for view/edit
beside it.

Chosen visual direction (validated via mockup, "Direction B"): **inline mode
toggle inside the search box + two-line symbol rows**.

## Constraints / known limits

- `DefinitionRowPayload` (`shared/contracts/commands.ts`) carries no explicit
  symbol-kind field: `{ id, qualified_name, bare_name, file, line, exported,
  is_default, is_declaration_only, col, end_line, end_col }`. Kind is therefore
  inferred only as **function vs method** via the existing
  `qualified_name.includes(".")` heuristic, plus the `exported` / `is_default`
  flags. A richer kind set (class / interface / variable) would require backend
  index changes and is **out of scope** for this polish pass.

## Layout (Direction B)

```
┌─ Files | Changes | Commits ───────────────┐   existing review-mode tabs
│  ┌─────────────────────────────────────┐  │
│  │ Search…                  [🗎] [❮❯]   │  │   shared: input + inline mode toggle
│  └─────────────────────────────────────┘  │
│  ‹ Show gitignored ›   (Files mode only)   │   sub-header, mode-specific
│  ‹ stale-index / unavailable banner ›      │   (Symbols mode only, when relevant)
│  ──────────────────────────────────────── │
│  body:  WorktreeTree   |   SymbolResults    │
└─────────────────────────────────────────────┘
```

Two-line symbol row:

```
ƒ  parseConfig                         fn
   src/features/code-nav/utils.ts:42
```

- Kind glyph (`ƒ` function / `◇` method) colored by kind.
- Symbol name with the matched query substring highlighted in `--accent`.
- Small kind tag (`fn` / `method`).
- Dimmed `path:line` on the second line.
- Selected-row highlight; hover highlight.

## Components

- **`FilesPane.tsx`** (new, `src/features/code-nav/palette/` or
  `src/app/components/`) — owns the shared search input + inline `Files/Symbols`
  toggle and the shared query string; renders one of two bodies by sub-mode.
- **`WorktreeTree.tsx`** (refactor) — lift its internal search `<input>` and
  debounce out; accept `searchTerm` as a prop. The "Show gitignored" toggle
  stays but renders under the shared input, in Files mode only.
- **`SymbolResults.tsx`** (new) — virtualized two-line symbol list
  (`@tanstack/react-virtual`, matching `WorktreeTree` / `FilesOverlay`). Carries
  over the availability + stale-index banners and the Refresh button from the
  old palette so no functionality is lost.

## State & data flow

- New per-session field **`filesPaneMode: "files" | "symbols"`**, mirroring
  `reviewMode` **end-to-end through the same four files** so it actually
  persists (runtime state alone is not enough):
  1. **Runtime type** — add `filesPaneMode: "files" | "symbols"` to
     `WorktreeSession` in `shared/models/worktree-session.ts:10` (alongside
     `reviewMode`, line 15). Optionally hoist a `FilesPaneMode` type next to
     the exported `ReviewMode`.
  2. **Reducer / init / restore** — in
     `src/features/workspace/logic/workspace-state.ts`: default `"files"` at
     session init (~line 229), a `session/setFilesPaneMode` reducer
     (~line 1190, alongside `session/setReviewMode`), and hydrate it in
     `restorePersistedSession` (~line 395, which is the **restore** path —
     *not* the snapshot writer) defaulting to `"files"` when absent so
     pre-feature snapshots migrate cleanly.
  3. **Snapshot serialization** — add `filesPaneMode: session.filesPaneMode`
     to the per-session object built by `buildWorkspaceSnapshot`
     (`src/features/workspace/logic/workspace-persistence.ts:88`, beside
     `reviewMode: session.reviewMode`).
  4. **Persisted schema** — add
     `filesPaneMode: z.enum(["files", "symbols"]).optional().default("files")`
     to `PersistedWorktreeSessionSchema`
     (`shared/models/persisted-workspace-state.ts:25`). `.optional().default`
     keeps it backward-compatible with snapshots written before this feature.
- Symbol mode **reuses unchanged**: `use-symbol-search.ts`,
  `use-worktree-status.ts`, `unavailable-message.ts`. Only rendering is new.
- Navigation reuses `getNavRouter().navigate({ …, source: "palette" })`. The
  `NavRouter` `source` field is a closed union
  (`"definition" | "reference" | "link" | "palette" | "history"`,
  `nav-router.ts:5`); we keep `"palette"` rather than add a new variant, since
  it is the same navigation origin relocated.

## Cmd+T wiring

- Cmd+T handler (`App.tsx`, currently `setSymbolPaletteOpen(true)` ~line 329):
  `setReviewMode("files")` + dispatch `session/setFilesPaneMode` `"symbols"` +
  `setReviewOpen(true)` + focus the search input — reusing the
  `switchReviewMode` pattern at `App.tsx:1225`.
- **Delete** `SymbolPalette.tsx`, the `symbolPaletteOpen` state, and its mount
  (`App.tsx:1719`). Cmd+P / `FilesOverlay` is untouched. The three helper
  modules survive (consumed by `SymbolResults`).

## Edge cases (test coverage)

1. Worktree not cortex-indexed → unavailable banner in Symbols mode; no crash,
   no empty list rendered as "no matches".
2. Stale index (`dirtyAtIndex`) → refresh banner + working Refresh button
   (reuses `codeNavClient.refreshWorktree`).
3. Empty query / no matches → distinct empty states per mode
   ("Search symbols…" placeholder vs "No symbols match" result).
4. Toggling Files↔Symbols preserves the tree's expanded paths and does not
   refire `files.listWorktree`.
5. Cmd+T while overlay is open in Changes/Commits → switches to Files + Symbols
   and focuses the input.
6. Keyboard nav in Symbols mode (↑/↓ to move selection, Enter to navigate,
   Esc to close overlay) — parity with the old palette.
7. Matched-substring highlight is case-insensitive and handles no-match
   (renders plain name).
8. `filesPaneMode` persists round-trip: set Symbols, snapshot via
   `buildWorkspaceSnapshot`, re-hydrate through `PersistedWorktreeSessionSchema`
   + `restorePersistedSession`, and the session restores in Symbols mode. A
   pre-feature snapshot lacking the field hydrates to the `"files"` default
   without a Zod parse error.

## Scope

~11 files. The `filesPaneMode` persistence contract spans four files (see
State & data flow), all of which must change together or the field will not
round-trip:

1. `shared/models/worktree-session.ts` — runtime `WorktreeSession` type.
2. `src/features/workspace/logic/workspace-state.ts` — init default, reducer
   (`session/setFilesPaneMode`), and restore/hydration.
3. `src/features/workspace/logic/workspace-persistence.ts` — snapshot write in
   `buildWorkspaceSnapshot`.
4. `shared/models/persisted-workspace-state.ts` — `PersistedWorktreeSessionSchema`.

Plus the UI surface: `FilesPane` (new), `WorktreeTree` (refactor),
`SymbolResults` (new), `ReviewArea` (swap body), `App.tsx` (Cmd+T + remove
modal), `shell.css` (new pane chrome + two-line rows), and delete
`SymbolPalette.tsx`. Past the 3-file threshold → implementation proceeds via a
phased plan (writing-plans), not a single change.

## Out of scope

- Richer symbol kinds (class/interface/variable) — needs index changes.
- Changes to Cmd+P / `FilesOverlay`.
- Fuzzy ranking changes to symbol search (backend `searchSymbols` unchanged).
