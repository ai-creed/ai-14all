# Review Pane Expand Mode — Design Spec

**Date:** 2026-04-27
**Status:** Approved (rev 2)

## Overview

Add an "expand mode" to the ReviewDrawer that slides it up as a fixed portal overlay covering from just below the chip bar to the bottom of the viewport. The portal renders on top of the terminal panes and does not change the terminal's current height. Triggered by a new keyboard shortcut and a button in the drawer header.

## Decisions

- **Implementation strategy:** Portal (`ReactDOM.createPortal` into `document.body`)
- **Triggers:** ⌘⇧J / Ctrl+Shift+J keyboard shortcut + expand button (⬆/⬇) in drawer header, right of Refresh
- **⌘⇧J behavior:** Toggles expand on/off regardless of drawer open/closed state — does NOT change drawer open state
- **Backdrop:** None — portal slides up cleanly over terminal, no scrim
- **Escape:** Not wired to expand/collapse (reserved for Monaco/comment forms)
- **State persistence:** Not persisted — `reviewExpanded` lives only in `App.tsx` component state and resets to `false` on reload. Rationale: expand is a transient "give me more room right now" gesture, not a layout preference. Persisting it would surprise users who reload and find the portal covering their terminals; it would also need a migration if the state shape later changes. The underlying `reviewDrawerOpen` state remains persisted as before, so the user's drawer-open/closed preference still survives reloads.

## State Model

```
reviewDrawerOpen: boolean   — existing persisted state, unchanged by expand
reviewExpanded: boolean     — new independent local state in App.tsx (not persisted)
```

`reviewExpanded` and `reviewDrawerOpen` are fully independent. Expanding does not open the drawer; collapsing the portal does not close the drawer. The four combinations are all valid:

| `open` | `expanded` | Visual result |
|--------|-----------|---------------|
| false  | false     | Drawer collapsed (header only), no portal |
| true   | false     | Drawer open at `panelHeight`, no portal |
| false  | true      | Portal visible, drawer still shows collapsed header |
| true   | true      | Portal visible, drawer shows header + placeholder body |

## Terminal Isolation Guarantee

Toggling expand mode must not change the terminal's current height.

Mechanism:
- Portal is `position: fixed` — does not participate in document flow, terminal height unaffected
- When `open=false, expanded=true`: drawer stays collapsed (single `"auto"` grid row), terminal keeps full height
- When `open=true, expanded=true`: drawer keeps `gridTemplateRows: auto auto ${panelHeight}px` — body slot renders an **empty placeholder `<div>`** (`visibility: hidden`) so the grid row stays at `panelHeight`, no xterm resize event fires
- ⌘⇧J never dispatches `session/setReviewDrawerOpen` — drawer state is owned separately

**Implementation status (verified 2026-04-28):** matches spec.
- Portal: `ReviewExpandedPortal` uses `ReactDOM.createPortal(content, document.body)` + `position: fixed`
- Placeholder: `ReviewDrawer.tsx` renders `<div className="shell-review-drawer__body--placeholder" />` when `open && expanded`; `.shell-review-drawer__body--placeholder` in `shell.css` uses `visibility: hidden; pointer-events: none`
- Shortcut isolation: ⌘⇧J handler in `App.tsx` calls `setReviewExpanded` only; no `session/setReviewDrawerOpen` dispatch
- E2E coverage: `tests/e2e/review-expand.spec.ts` exercises portal toggle and terminal isolation

## Component Changes

### `ReviewDrawer.tsx`

New props:
```ts
expanded?: boolean;
onExpand?: () => void;
onCollapse?: () => void;
```

Behavior when `expanded=true` and `open=true`:
- Body renders `<div className="shell-review-drawer__body--placeholder" />` instead of children — grid row stays at `panelHeight`, no duplicate Monaco instances
- Header shows ⬇ button (accent color) calling `onCollapse`

Behavior when `expanded=false`:
- Body renders children normally
- Header shows ⬆ button calling `onExpand`

Button placement: right side of header, after Refresh (↻ ⬆/⬇).

### New: `ReviewExpandedPortal.tsx`

```ts
interface ReviewExpandedPortalProps {
  mainColRef: RefObject<HTMLElement>;
  chipBarRef: RefObject<HTMLElement>;
  onCollapse: () => void;
  onRefresh: () => void;
  isDirty: boolean;
  changedFileCount: number;
  children: ReactNode;
  // onRequestRecompute omitted: useLayoutEffect (no deps) recomputes on every
  // render, covering bannerInfo changes without an extra prop or App coupling.
}
```

- `ReactDOM.createPortal(content, document.body)`
- `position: fixed`, `z-index: 30`
- Positioning state: `{ top, left, right }` computed from rects, stored in state, applied as inline styles
- `recomputePosition()` helper: reads `chipBarRef.current.getBoundingClientRect().bottom` (→ `top`), `mainColRef.current.getBoundingClientRect().left` (→ `left`), `window.innerWidth - mainColRef.current.getBoundingClientRect().right` (→ `right`). Never uses `right: 0` — the layout has viewport padding so the main column does not reach the viewport edge.
- `ResizeObserver` on **both** `chipBarRef` and `mainColRef` → calls `recomputePosition()` on every callback
- `window.resize` event listener → calls `recomputePosition()` as fallback for rapid resize
- `useLayoutEffect` with no deps (runs every render while mounted) → calls `recomputePosition()` to catch position-only shifts (e.g., `UpdateBanner` pushing chip bar down without resizing it — `ResizeObserver` misses these because chip bar's own size doesn't change)
- `bannerInfo` changes in App.tsx cause a re-render of the portal (as a child), which triggers the `useLayoutEffect` — no extra prop needed
- Renders its own header: label + status + Refresh + ⬇ collapse button (no drawer toggle — portal is a standalone overlay)
- Renders `children` as body (the same Tabs.Root content passed from App.tsx)

### `shortcut-registry.ts`

New predicate: `isReviewExpandShortcut`
- Key: `J` with Shift
- Modifier: `metaKey` (mac) / `ctrlKey` (other)
- Same `targetOwnsTyping` guard (blocks when focus is in Monaco, terminal, dialog)

New registry entry:
```ts
{ id: "review.expand", label: "Toggle full review", mac: "⌘⇧J", other: "Ctrl+Shift+J" }
```

### `App.tsx`

- New state: `const [reviewExpanded, setReviewExpanded] = useState(false)`
- New refs: `chipBarRef` (on the chip bar wrapper div), `mainColRef` (on `<section className="shell-main-column">`)
- Dedicated `useEffect` for `review.expand` shortcut (follows per-shortcut pattern in App.tsx):
  - Uses `appPlatform` (existing variable), guards `if (!activeWorktree) return`
  - `setReviewExpanded((prev) => !prev)` — no drawer state change
- Conditional children placement:
  - `expanded=true`: children go to `ReviewExpandedPortal`, `ReviewDrawer` gets no children (placeholder body takes over when open)
  - `expanded=false`: children go to `ReviewDrawer` normally
- Passes `expanded`, `onExpand`, `onCollapse` to `ReviewDrawer`
- Mounts `ReviewExpandedPortal` when `reviewExpanded=true`

### `shell.css`

New rules:
```css
.shell-review-expanded-portal {
  position: fixed;
  z-index: 30;
  /* left/top/right set via inline style from JS rects — never hard-code right: 0
     because .shell-layout has viewport padding, main column does not reach the edge */
  bottom: 0;
  background: var(--panel-bg);
  border-top: 1px solid var(--pane-border-review);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
  transform: translateY(0);
  transition: transform 220ms ease-out;
}

.shell-review-expanded-portal[data-leaving="true"] {
  transform: translateY(100%);
}

.shell-review-drawer__body--placeholder {
  /* Occupies the panelHeight grid row to prevent terminal resize */
  visibility: hidden;
  pointer-events: none;
}
```

**Entry animation:** portal mounts with `data-leaving="true"` (slide-down position) → `requestAnimationFrame` removes attribute → CSS transitions to `translateY(0)`.

**Exit animation:** set `data-leaving="true"` → wait for `transitionend` → `setReviewExpanded(false)` → portal unmounts.

## z-index Ladder

| Layer | z-index |
|-------|---------|
| Terminal | (none) |
| Sidebar resize handle | 10 |
| Review expanded portal | 30 |
| Note sheet | 49–50 |
| Files overlay | 50 |

## Files Affected

1. `src/app/shortcut-registry.ts` — new `isReviewExpandShortcut` + registry entry
2. `src/features/shortcuts/ShortcutsHelp.tsx` — add `"review.expand"` to the Review group in `SHORTCUT_GROUPS`
3. `src/features/review/ReviewDrawer.tsx` — `expanded` prop + ⬆/⬇ button + placeholder body
4. `src/features/review/ReviewExpandedPortal.tsx` — **new file** — portal component
5. `src/app/App.tsx` — new state, refs, shortcut handler, conditional children (`reviewTabContent` local const); no bannerInfo prop needed — portal's `useLayoutEffect` recomputes position on every render
6. `src/app/shell.css` — portal positioning + slide animation + placeholder style

## Test Coverage

### Unit tests

- `tests/unit/components/ReviewDrawer.test.tsx` — new cases (extends existing file):
  - renders ⬆ button when `expanded=false`, calls `onExpand` on click
  - renders ⬇ button (accent) when `expanded=true`, calls `onCollapse` on click
  - body renders placeholder (no children) when `expanded=true` and `open=true`
  - body renders children when `expanded=false` and `open=true`

- `tests/unit/review/ReviewExpandedPortal.test.tsx` — **new file** (follows pattern of `ReviewCommentSidebar.test.tsx` in same dir):
  - portal renders into `document.body`
  - mounts with `data-leaving="true"`, removes on next frame
  - sets `data-leaving="true"` when collapse triggered, fires `onCollapse` after transition

- `shortcut-registry.ts` — `isReviewExpandShortcut`:
  - fires on ⌘⇧J (mac) / Ctrl+Shift+J (other)
  - blocked when focus is in Monaco / xterm / dialog

### E2E tests

- `tests/e2e/review-expand.spec.ts` — new file:
  - ⌘⇧J opens portal when drawer is closed; drawer stays closed
  - ⌘⇧J opens portal when drawer is open; drawer stays open at same height
  - ⬇ button collapses portal; drawer returns to prior state
  - ⌘⇧J again collapses portal
  - terminal `clientHeight` does not change between pre-expand and post-expand states (assert via `evaluate`)
  - sidebar resize while expanded: portal `left` updates to match

## Edge Cases

- Sidebar resized while expanded: `ResizeObserver` on both refs updates portal position
- UpdateBanner appears/disappears while expanded: `ResizeObserver` on `chipBarRef` updates portal `top`
- Window resized while expanded: `window.resize` listener recomputes both `left` and `top`
- Drawer toggle (▾) clicked while expanded: drawer closes normally, portal stays visible (independent state)
- Comment sidebar open while expanded: portal inherits same `commentSidebarOpen` + `reviewSidebarWidth` state, renders inside portal normally
