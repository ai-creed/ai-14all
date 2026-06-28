# ai-14all — Review Pane UX Hardening / Redesign

**Date:** 2026-06-29
**Status:** Design — approved, pending implementation plan
**Branch:** `review-pane-ux-hardening`

## Summary

The review pane is a three-tab surface (Files / Changes / Commits) with a resizable
left rail, a center diff/editor viewer, and — today — a resizable right-hand comment
queue sidebar (`ReviewQueuePanel`) plus inline comment threads in the diff. Comments
therefore live in **two places** at once, and the pane gives a **weak sense of review
progress**.

This redesign keeps the tab structure and resizable panes the user is happy with, and
reshapes the comment + progress experience around a single principle: **one canonical
comment store, surfaced through three distinct projections.** It also hardens the
pane's empty/loading/error/large-data states and decomposes the 959-line
`ReviewArea.tsx` into focused units.

## Goals

- **Kill the comment split-brain.** Comments have one canonical data source; every UI
  view is a projection of it, so there is nothing to keep in sync.
- **Surface review progress.** At a glance: how many changed files reviewed, how many
  comments open vs addressed, what is left.
- **Harden edge cases.** Empty, loading, error, large diffs, many comments, stale data.
- **Visual polish.** Tighter hierarchy, consistent status color system, more diff width.
- **Reduce file size / improve boundaries.** Break `ReviewArea.tsx` into testable units.

## Non-goals

- Changing the Files / Changes / Commits tab structure (the user is happy with it).
- Removing resizable panes (left rail stays resizable).
- Reworking comment persistence (`review-comment-service` / `review-comment-store`).
- Files (browse/edit) mode gains no comment chrome — comments stay a review-mode concern
  (Changes + Commits only).

## Current state (as built)

- `src/app/components/ReviewArea.tsx` (959 lines) owns: tabs, the rail lists, the diff/
  editor viewer selection, the right comment sidebar, the inline-mounts bridge, draft
  state, the diff-editor registry, keyboard shortcuts, and command registration.
- Comments render **inline** (via `InlineMountsBridge` + `InlineCommentThread`) **and**
  in the right `ReviewQueuePanel` sidebar (grouped by file, with hide-addressed and
  clear-addressed actions).
- Layout grid columns: `reviewRailWidth | resize | viewer | resize | reviewSidebarWidth`,
  with the comment sidebar gated by `commentSidebarOpen`.
- Canonical comment state flows from `useReviewComments` (`reviewState.comments`).
- Existing keyboard nav: next/prev file, next/prev diff-in-file, next/prev thread, plus
  command-palette entries (`review.fileNext`, etc.).
- A review file-watcher exists and, per a prior decision, must only run while the review
  chrome is expanded (CPU saving when the user is not reviewing).

## Design

### Information architecture: one store, three projections

All comment views derive from the same canonical `reviewState.comments`, owned by
`review-comment-service` / `review-comment-store`. The invariant is **one source of truth
with one write path**, not read-only views: no projection keeps its own copy of comment
state, and every mutation — author, reply, resolve, toggle-addressed, clear-addressed —
routes through that single service. Projections differ only in *which* actions they expose,
never in where the data lives or where writes go. Because there is exactly one store and
one write path, the projections cannot drift, so there is no cross-view sync to get wrong.

1. **Inline threads (center diff)** — the *editing* surface and the only place that can
   author or reply. Exposed actions: author, reply, resolve. This is the richest
   interaction point, where the reviewer's eyes already are.
2. **Slim minimap (right rail, ~46px)** — the *navigation* surface for the current file.
   A vertical progress fill plus one dot per comment (amber = open, green = addressed).
   Hovering or clicking a dot pops a flyout preview (author, snippet). Exposed actions:
   Jump (navigation) and Resolve (toggle-addressed for that one comment). Replaces the old
   `ReviewQueuePanel` as the right surface.
3. **Rail overview (left rail)** — the *triage + progress* surface. The Changes/Commits
   file list shows per-file open-comment counts and a reviewed (✓) marker, with a
   progress header and a collapsible "All open comments" section (the old cross-file
   queue, relocated). Exposed actions: Jump (navigation), per-comment toggle-addressed, and
   clear-addressed (the bulk triage action inherited from the old queue). This preserves
   whole-branch triage without a separate panel.

All of these actions — including the minimap Resolve and the overview's toggle-addressed /
clear-addressed — are calls into `review-comment-service`. They are allowed mutations
precisely because they go through the single write path; relocating them out of the old
sidebar does not create a second state owner.

This applies to **Changes** and **Commits** modes. **Files** mode keeps no comment chrome.

### Components

The redesign decomposes `ReviewArea.tsx` so each unit has one clear job and can be
tested independently. `ReviewArea` becomes a thin layout/wiring shell.

| Unit | Responsibility | Built from |
|---|---|---|
| `ReviewRail` (left) | tabs + active list + progress header + "All open comments" collapsible | wraps existing `FilesPane` / `ChangesList` / `CommitList` |
| `DiffViewerPane` (center) | diff/editor selection + inline thread mounts | existing `InlineMountsBridge` + viewers, lifted out of `ReviewArea` |
| `CommentMinimap` (right) | progress fill + comment dots + hover/click flyout (Jump / Resolve) | **new** component, replaces `ReviewQueuePanel` |
| `useReviewedFiles` | per-file "viewed" state + progress selector | **new** hook + workspace-state slice |

### Data flow

- **Comments:** `review-comment-service` / `review-comment-store` are unchanged and remain
  canonical. Inline, minimap, and overview are projections of that store; whenever any of
  them mutates (resolve / toggle-addressed / clear-addressed) it calls the same service,
  and none holds a private copy. The service is the single write path.
- **Minimap dots:** derived from the current file's comments, mapping `startLine` to a
  scroll proportion. The flyout shows a preview and offers Jump (scrolls the inline
  thread into view and focuses it) and Resolve (toggles addressed).
- **Overview:** derived from all comments across files, grouped by file (reusing the old
  queue's grouping and hide-addressed logic, relocated into the rail). Its triage
  mutations (per-comment toggle-addressed and bulk clear-addressed) call
  `review-comment-service` directly — the same write path the inline threads use — so
  relocating them out of the old sidebar introduces no second source of truth.
- **`hideAddressed`:** a single filter applied uniformly to all three projections so the
  views never disagree about what is shown.

### Reviewed model

- `reviewedFiles` is keyed by `worktreeId + filePath + contentHash`. The explicit
  "Mark viewed" action (GitHub-style) sets the entry; when the file changes, its content
  hash differs and the entry no longer matches, so the file auto-reverts to unreviewed.
- Progress = `reviewed / total changed files`, driving the rail progress header and the
  minimap progress fill.
- New keyboard + command-palette actions: "Mark file viewed" and "Toggle overview".
- State lives in the workspace-state slice (session-scoped), consistent with existing
  per-session review state.

### Robustness (hardening)

- **Empty:** no changed files → friendly empty state; changes but no comments → minimap
  shows the progress fill only (no dots).
- **Loading:** rail-list and diff skeletons; the minimap stays hidden until the diff
  editor has mounted (dot positions require a measurable editor).
- **Large diff / many comments:** adjacent dots cluster into a `+N` marker whose flyout
  lists the clustered comments; the overview list is virtualized.
- **Stale data:** reviewed-reset rides the **existing** diff/git refresh path. No new
  always-on watcher is introduced; the review file-watcher remains bound to review-chrome
  expansion (CPU saving, per the prior decision).
- **Errors:** existing git-summary and diff-load error states are preserved.
- **Unsaved draft guard:** preserved (switching files/threads with a dirty draft still
  prompts).

### Visual polish

- Square corners and the dark-navy token palette (already validated in mockups).
- A consistent status color system: amber = open, green = addressed / reviewed.
- A uniform spacing scale, clearer active-file and focused-thread emphasis, and slimmer
  diff gutters to reclaim horizontal width for the diff.

### Migration / back-compat

- `ReviewQueuePanel` is removed as a resizable sidebar; its grouping, hide-addressed, and
  clear-addressed logic moves into the rail overview and the minimap flyout. These actions
  continue to write through `review-comment-service`, so no new state owner is introduced —
  the panel's *location* changes, not who owns comment state.
- `reviewSidebarWidth` is deprecated (the minimap is fixed-width). `reviewRailWidth`
  stays (the left rail remains resizable). `commentSidebarOpen` becomes the
  "overview expanded" toggle in the rail.
- The review-chip "open comments" jump (`pendingCommentJump`), thread/diff/file keyboard
  navigation, and command-palette entries are all preserved and extended.

## Testing

- **Unit:** reviewed-state reducer + content-hash reset; progress selector; minimap dot
  clustering; overview grouping + hide-addressed filtering.
- **Component:** minimap flyout interactions (hover, Jump, Resolve); mark-viewed toggle;
  overview jump-to-comment.
- **E2E:** extend `tests/e2e/review-comments.test.ts` — mark a file viewed and see
  progress advance; add an inline comment and see its dot + overview entry; resolve a
  comment from the flyout.

## Staged implementation phases

The spec is one cohesive design, but the plan slices it so each phase lands independently.
The ordering is deliberate: cross-file triage and bulk clear-addressed live in the
right-slot `ReviewQueuePanel` today, so the rail overview that absorbs that behavior is
built **before** the panel is removed. No phase ever lands with cross-file triage missing.

1. **State + data layer** — `useReviewedFiles` hook, workspace-state slice, content-hash
   reset, progress selector. Plus the `ReviewArea` decomposition (extract `DiffViewerPane`,
   thin the shell) so later phases edit small files. The right-slot `ReviewQueuePanel` is
   untouched in this phase.
2. **Rail overview** — progress header, per-file reviewed/count markers, "All open
   comments" collapsible that relocates the queue's grouping / hide-addressed /
   clear-addressed logic into the rail, plus mark-viewed controls + shortcuts.
   `ReviewQueuePanel` **stays in the right slot** through this phase; cross-file triage and
   bulk clear are now available in both the rail overview and the old panel (temporary,
   intentional redundancy), so landing this phase regresses nothing.
3. **Minimap + retire the right panel** — add the `CommentMinimap` component (dots,
   progress fill, flyout, clustering) wired to current-file comments, and only now remove
   `ReviewQueuePanel` from the right slot. Removal is safe because the rail overview from
   phase 2 already carries the cross-file triage + bulk-clear surface.
4. **Polish + robustness** — status color system, spacing, empty/loading/large-data
   states, virtualization, e2e coverage.

## Open questions

None outstanding. Decisions captured: inline-canonical comments; slim minimap with
dots + hover flyout; explicit "Mark viewed" reviewed model; left rail doubles as the
cross-file triage + progress overview.
