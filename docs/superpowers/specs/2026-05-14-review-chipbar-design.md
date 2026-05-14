# Review Chrome Redesign — Chipbar Spec

**Date:** 2026-05-14
**Status:** Approved

## Problem

The collapsible bottom drawer never provides enough vertical space to be usable for actual review work. Users always end up opening the full expanded overlay anyway. The drawer occupies space in the main column while delivering no value in its collapsed or partially-open states.

## Decision

Replace the bottom drawer with a compact, always-visible **`ReviewChipBar`** — a single-row status strip at the bottom of the main column. The expanded overlay (`ReviewExpandedPortal`) becomes the only review surface, opened on demand from the chipbar or automatically on file selection.

Approach: **Clean sweep** — remove the drawer and all associated state; do not retain backwards-compatibility scaffolding.

---

## Architecture Changes

### Deleted

| File | Reason |
|------|--------|
| `src/features/review/components/ReviewDrawer.tsx` | Replaced by chipbar |
| `src/app/components/ReviewDrawerSection.tsx` | Wrapper no longer needed |
| `src/features/review/hooks/use-review-drawer-auto-expand.ts` | Chipbar makes status always visible; auto-pop is unnecessary |

From `usePaneResizers`: remove `reviewPanelHeight` and `handleReviewPanelResizeStart` (the drag-resize handle disappears with the drawer).

From `shortcut-registry.ts`: remove `isReviewDrawerShortcut` and `isReviewExpandShortcut` (two separate drawer/expand shortcuts, replaced by one unified shortcut below).

### Added

| File | Purpose |
|------|---------|
| `src/app/components/ReviewChipBar.tsx` | New compact status row component |

### Changed

| File | Change |
|------|--------|
| `shared/models/worktree-session.ts` | Remove `reviewDrawerOpen: boolean` |
| `src/features/workspace/logic/workspace-state.ts` | Remove `session/setReviewDrawerOpen` action + handler |
| `src/app/App.tsx` | Remove drawer wiring; add chipbar + simplified overlay open/close; wire unified shortcut |
| `src/app/shortcut-registry.ts` | Replace two shortcuts with one `isReviewOpenShortcut` |
| `src/features/shortcuts/ShortcutsHelp.tsx` | Replace `review-drawer` + `review.expand` rows in the Review group with the new `review.open` shortcut |
| `src/features/workspace/logic/workspace-persistence.ts` | Stop writing `reviewDrawerOpen` to snapshot output |
| `shared/models/persisted-workspace-state.ts` | Remove `reviewDrawerOpen` from `PersistedWorktreeSessionSchema` (see Persisted State below) |
| Tests | Remove drawer/section/auto-expand tests; add `ReviewChipBar` test; update persistence tests |

**Untouched:** `ReviewExpandedPortal`, `ReviewArea`, all inline thread/comment machinery, `reviewMode`, `reviewSidebarWidth`, all selected-file session fields.

### Portal positioning — `chipBarRef` stays anchored to the top chip bar

`ReviewExpandedPortal` computes its `top` from `chipBarRef.current.getBoundingClientRect().bottom` (`ReviewExpandedPortal.tsx:67`). The existing `chipBarRef` in `App.tsx` (`App.tsx:92`) points to the **top session chip bar** inside `MainColumnChrome`. This ref is **unchanged** by this redesign — the new `ReviewChipBar` (bottom of main column) does **not** use this ref and does **not** participate in portal positioning. The overlay continues to start just below the top session chip bar and extends to the bottom of the viewport, covering the new bottom chipbar while open.

---

## ReviewChipBar Component

### Props

```ts
type Props = {
  isDirty: boolean;
  changedFileCount: number;
  reviewMode: ReviewMode;        // "files" | "changes" | "commits"
  openCommentCount: number;
  addressedCommentCount: number;
  onRefresh: () => void;
  onOpen: () => void;
};
```

### Layout

Single `flex` row (~32px tall), matching the visual weight of the session info chip bar at the top. Left to right:

1. `REVIEW` label — muted, small-caps
2. Mode chip — `Files` / `Changes` / `Commits`, muted; reflects last active review tab from session
3. Status chip — `✓ clean` (green) when `!isDirty`; `N changed` (red/amber) when dirty
4. Comment info — `N open` (blue accent); ` · M addressed` (muted) appended only when `M > 0`; hidden entirely when both counts are zero
5. Spacer (`flex: 1`)
6. Refresh button `↻`
7. Open button `⬆ Review` — calls `onOpen`

### CSS

New class block: `.shell-review-chipbar`. Sits at the bottom of `.shell-main-column` (`flex-shrink: 0`), bordered top with `--pane-border-review`, same background as other chip bars.

### Comment count scope — active worktree, not current file

`openCommentCount` and `addressedCommentCount` are computed across **all comments for the active worktree**, not filtered by the currently selected file. Rationale: the chipbar is always visible regardless of which file (if any) is selected, so file-scoped counts would frequently hide real open comments.

Current drawer code uses current-file scoping (`ReviewDrawerSection.tsx:77`). That logic stays only for the in-overlay header (which already has file context); the chipbar uses worktree-wide totals derived from `reviewState.comments`:

```ts
const openCommentCount = reviewState.comments.filter((c) => c.status === "open").length;
const addressedCommentCount = reviewState.comments.filter((c) => c.status === "addressed").length;
```

---

## Overlay Open Triggers

Because `ReviewArea` only mounts when the overlay is open, all the entry points that today rely on the drawer staying mounted (or auto-opening) must explicitly call `setReviewOpen(true)` in the new design. The complete list of closed-state entry points and their replacements:

### From outside the overlay (must set `reviewOpen = true`)

| Trigger | Current behavior | New behavior |
|---------|------------------|--------------|
| Chipbar `⬆ Review` button | n/a (new) | `setReviewOpen(true)` |
| `Cmd+J` / `Ctrl+J` shortcut | toggles drawer | toggles `reviewOpen` |
| Dirty chip click in `SessionChipBar` (top) | dispatches `setReviewDrawerOpen` + `setReviewMode("changes")` (`MainColumnChrome.tsx:114`) | dispatches `setReviewMode("changes")` + `setReviewOpen(true)` |
| Review-mode shortcuts `Cmd+1/2/3` | dispatches `setReviewMode` + `setReviewDrawerOpen` if closed (`App.tsx:1200`) | dispatches `setReviewMode` + `setReviewOpen(true)` |
| `FilesOverlay` → "View file" | dispatches `selectFile` + `setReviewMode("files")` + `setReviewDrawerOpen` (`MainColumnChrome.tsx:167`) | dispatches `selectFile` + `setReviewMode("files")` + `setReviewOpen(true)` |

These all live in `App.tsx` or `MainColumnChrome.tsx`. The cleanest pattern is to thread a single `openReview()` callback (closure over `setReviewOpen(true)`) down to `MainColumnChrome` and call it alongside any dispatches in each handler. Drop the `autoExpand.noteUserExpand(...)` calls — `autoExpand` is being deleted with the auto-expand hook.

### From inside the overlay (no extra action needed)

When `ReviewArea` is mounted, dispatches like `session/selectFile`, `session/selectChangedFile`, `session/selectCommit`, `session/selectCommitFile`, and internal dispatches (`ensureFileFocused`, jump-to-comment) all fire from within the already-open overlay. No wrapper needed.

The earlier proposal to wrap these dispatches with `selectAndOpen` in `App.tsx` is **not needed** — those actions originate inside `ReviewArea`, which only mounts when the overlay is already open.

---

## Session State Changes

**Removed from `WorktreeSession`:**
- `reviewDrawerOpen: boolean`

**Kept (all feed into the overlay on restore):**
- `reviewMode` — restores the active tab
- `reviewSidebarWidth` — restores comment sidebar width
- `selectedFilePath`, `selectedChangedFilePath`, `selectedCommitSha`, `selectedCommitFilePath` — restore last viewed content

**`reviewOpen` (was `reviewExpanded`) stays local state in `App.tsx`** — purely a UI concern, resets to `false` on app restart.

### Persisted state cleanup

`reviewDrawerOpen` is currently both written to and read from on-disk snapshots:

- **Write side** (`src/features/workspace/logic/workspace-persistence.ts:93`): drop the `reviewDrawerOpen` property from the object built in `worktreeSessions.map(...)`.
- **Schema side** (`shared/models/persisted-workspace-state.ts:30`): remove `reviewDrawerOpen: z.boolean().optional().default(false)` from `PersistedWorktreeSessionSchema`.

**Backward compatibility:** Old snapshots written before this change will contain a `reviewDrawerOpen` field. After this change Zod's default behavior is to silently strip unknown keys (the schema is not in `.strict()` mode), so old snapshots will continue to parse — the extra key is dropped, no migration needed. Verify with a persistence test that loads a snapshot containing `reviewDrawerOpen: true` and confirms it parses successfully and produces a session without that field.

---

## App.tsx Wiring (before → after)

**Before:**
```tsx
const { reviewPanelHeight, handleReviewPanelResizeStart, ... } = usePaneResizers({});
const [reviewExpanded, setReviewExpanded] = useState(false);
useReviewDrawerAutoExpand(...);

<ReviewDrawerSection
  reviewPanelHeight={reviewPanelHeight}
  onResizeStart={handleReviewPanelResizeStart}
  reviewExpanded={reviewExpanded}
  setReviewExpanded={setReviewExpanded}
  ...
>
  <ReviewArea ... />
</ReviewDrawerSection>
```

**After:**
```tsx
const { ... } = usePaneResizers({}); // reviewPanelHeight removed
const [reviewOpen, setReviewOpen] = useState(false);

<ReviewChipBar
  isDirty={activeSummary?.isDirty ?? false}
  changedFileCount={changedFileCount}
  reviewMode={activeSession?.reviewMode ?? "files"}
  openCommentCount={openCommentCount}
  addressedCommentCount={addressedCommentCount}
  onRefresh={handleRefreshChanges}
  onOpen={() => setReviewOpen(true)}
/>
{reviewOpen && (
  <ReviewExpandedPortal
    ref={expandedPortalRef}
    mainColRef={mainColRef}
    chipBarRef={chipBarRef}
    onCollapse={() => setReviewOpen(false)}
    ...
  >
    <ReviewArea ... />
  </ReviewExpandedPortal>
)}
```

---

## Keyboard Shortcut Unification

Currently two shortcuts exist for the review chrome:
- `Cmd+J` / `Ctrl+J` — toggles the drawer open/closed
- `Cmd+Shift+J` / `Ctrl+Shift+J` — opens the expanded overlay

In the new design these collapse to **one**: `Cmd+J` / `Ctrl+J` toggles `reviewOpen` (opens the overlay when closed, closes it when open). `Cmd+Shift+J` is removed.

In `shortcut-registry.ts`: remove `isReviewDrawerShortcut` and `isReviewExpandShortcut`; add `isReviewOpenShortcut` (same binding as `Cmd+J`).

In `App.tsx`: a single `useKeyboardShortcut("review.open", ...)` handler calls `setReviewOpen(v => !v)` (or `expandedPortalRef.current?.collapse()` when closing, to preserve the slide-out animation).

---

## Out of Scope

- Changes to `ReviewExpandedPortal` layout or header
- Changes to `ReviewArea` internals (tabs, diff viewer, comment queue)
- Inline thread/comment machinery
- Global status-bar approach (review is per-worktree; a global bar was considered and rejected)
- Auto-pop overlay when changes appear (chipbar makes status visible; manual open is sufficient)
