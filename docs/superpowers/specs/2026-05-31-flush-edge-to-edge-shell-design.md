# Flush edge-to-edge shell + tabs/telemetry in the app bar

**Date:** 2026-05-31
**Branch:** UI-overhaul
**Status:** Design — awaiting review

## Goal

Remove every gap *between* the major UI regions so the shell reads as one
continuous edge-to-edge surface (VS Code–like), and lift the top
tabs/telemetry strip out of the main column into a full-width application bar
that occupies the macOS title-bar region.

Two user-confirmed decisions shape this design:

1. **Keep the colored per-pane accents** (sessions = blue, session-info =
   amber, terminal = mint, review = pink). They stay as the *single* 1px
   divider color between flush regions — we do **not** flatten to uniform
   neutral.
2. **Edge-to-edge**, not merely "gaps collapsed": the UI fills the window
   including the title-bar region; no outer inset.

## Current state

### Gaps between components (measured, 1440×868)

All inter-region spacing is multiples of 4px and comes from three places:

| Source | Current class | Produces |
| --- | --- | --- |
| `src/app/App.tsx:1392` master grid | `grid h-screen gap-4 p-4` | 16px gap between sidebar ↔ main column **and** 16px inset from window edges on all sides |
| `src/app/App.tsx:1421` main column | `flex flex-col gap-4 …` | 16px gaps between app chrome ↔ terminal area ↔ review bar |
| `src/app/components/TerminalPanel.tsx:90` pane grid | `grid gap-x-2 …` | 8px gap between side-by-side terminal panes |

### Panel seams

Each region is an independent rounded card with its own border:

- Terminal section: `bg-transparent border border-border rounded-md …`
  (`TerminalPanel.tsx:88`)
- Individual terminal panes: `border border-border rounded-sm …`
  (`TerminalPanel.tsx:106` / `:131`)
- Review chip bar: `border-t border-[var(--pane-border-review)]`
  (`ReviewChipBar.tsx:38`)

With gaps removed these would show doubled 2px borders and rounded corners
poking at the seams. The seam cleanup (below) resolves this.

### Window chrome

`electron/main/windows.ts:17` constructs a **standard framed** `BrowserWindow`
with no `titleBarStyle`. On macOS this draws the native ~28px title bar
(traffic lights + "ai-14all") above the web content. There is no app-owned
title-bar region today.

### The "tabs / telemetry" strip

Rendered by `MainColumnChrome` (`src/app/components/MainColumnChrome.tsx`):
`SessionChipBar` (session title, worktree/branch, dirty + changed-files pills,
files/note buttons, and the `terminalActions` slot — `+ Shell` / `Layout` /
`Presets`) with the telemetry `UsageStrip` passed in as its `usage` prop. This
whole strip currently lives **inside the main column** (`App.tsx:1422`,
sibling to the terminal area), so it spans only the main-column width, not the
full window. It is gated on `activeWorktree && activeSession`.

There is **no literal editor-tab component** — the "tabs" in the user's
phrasing are `SessionChipBar`'s chips (session title with rename pencil,
worktree label, branch name, and the `1 changed` pill). `SessionChipBar`'s
root is already `h-10` (40px), which is why the app bar height below is set to
match.

`chipBarRef` (attached at `MainColumnChrome.tsx:108`) is consumed by
`ReviewExpandedPortal` (`src/features/review/components/ReviewExpandedPortal.tsx:74,103`)
to anchor the expanded review overlay against the chip bar's measured
position. Relocating the strip must keep this ref pointing at a laid-out
element, or the review overlay positioning breaks.

## Design

### 1. Window chrome — own the title-bar region

`electron/main/windows.ts`: add to the `BrowserWindow` options

```ts
...(process.platform === "darwin"
  ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 } }
  : { titleBarStyle: "hidden" }),
```

- `hiddenInset` hides the native bar but keeps the traffic-light buttons,
  handing the full window height (including the ~28px title region) to the web
  content — the foundation for an app-owned top bar.
- `trafficLightPosition` vertically centers the buttons within the new app bar
  height (see §2). The app targets macOS (README: macOS arm64); the non-mac
  branch is defensive only.

### 2. Full-width application bar

Restructure the root layout (`App.tsx:1391`) from a single 2-column grid into
a **vertical stack**:

```
┌───────────────────────────────────────────────┐  ← App bar (full width)
│  [traffic-light clearance]  tabs … telemetry   │     draggable region
├──────────┬────────────────────────────────────┤
│ sidebar  │ main column (terminal / review)     │  ← existing 2-col grid
└──────────┴────────────────────────────────────┘
```

- New `<header>` app bar, fixed height (proposal: **40px** — clears the
  default traffic-light cluster and keeps the 4px grid; revisit during
  implementation if cramped).
- Move the `SessionChipBar` + `UsageStrip` rendering out of `MainColumnChrome`
  into this header. `MainColumnChrome` keeps only the overlays/sheets it
  already owns (`UpdateBanner`, `NoteSheet`, `FilesOverlay`, `ShortcutsHelp`).
  Preserve `chipBarRef` on the same wrapping element (it is used elsewhere for
  measurement/positioning) — it moves with the strip, it is not removed.
- **Dragging:** the header gets `-webkit-app-region: drag`; every interactive
  child (buttons, pills, the usage strip controls) gets
  `-webkit-app-region: no-drag`. Add a left inset of ~78px on macOS so the
  strip's content clears the traffic lights.
- **Empty state:** because the bar is now always present (not gated on an
  active session), render a minimal placeholder (app/workspace name only) when
  `activeWorktree`/`activeSession` is null, instead of the full chip bar.

### 3. Zero the gaps

- `App.tsx:1392` master grid: drop `gap-4 p-4` → `gap-0 p-0` (grid now lives
  below the app bar and fills remaining height).
- `App.tsx:1421` main column: `gap-4` → `gap-0`.
- `TerminalPanel.tsx:90` pane grid: `gap-x-2` → `gap-x-0`.

### 4. Seam cleanup (keep colored accents)

With panels flush, collapse doubled borders to a single 1px divider per seam,
colored with the existing `--pane-border-*` tokens:

- Square the outer corners of the regions that previously floated
  (`rounded-md`/`rounded-sm` → none on the *outer* edges; inner pane separators
  may keep minimal rounding only where they don't meet another panel).
- Each seam is owned by exactly one side (e.g. main column draws its left
  divider in `--pane-border-terminal`; sidebar draws no right border) so no
  2px doubling.
- Terminal pane-to-pane: a single shared 1px `--pane-border-terminal` divider
  replaces the removed `gap-x-2`.
- Review chip bar already uses a single `border-t` in
  `--pane-border-review` — unchanged.

## Testing

- The Playwright e2e suite (`tests/`, `playwright.config.ts`) drives the shell;
  recent commits updated selectors for the shadcn migration. **Preserve
  `data-testid="shell-layout"`** on the layout container (`App.tsx:1393`) and
  any `data-testid` on the chip bar so existing specs keep resolving.
- Add/adjust an e2e assertion that the app bar spans full window width and that
  no inter-region gap remains (computed `gap` = 0 on the three containers).
- Manual verification across all three themes (dark/light/warm) via the run
  driver: confirm traffic lights are vertically centered, the bar is draggable,
  interactive controls still click, and seams show single colored dividers.

## Out of scope

- Activity-bar / file-tree / status-bar additions (the broader VS Code parity
  list). This change is strictly: remove gaps + relocate the existing strip.
- Changing the colored accent palette, type scale, or the 4px spacing grid.
- Windows/Linux title-bar polish beyond the defensive `titleBarStyle: hidden`.

## Risks

- **Traffic-light overlap:** if the app bar is shorter than the traffic-light
  cluster, buttons clip. Mitigated by the 40px height + `trafficLightPosition`;
  verify visually.
- **Lost draggability:** if `no-drag` is missed on a control it becomes
  unclickable, or if `drag` is missed the window can't be moved. Audit every
  interactive descendant.
- **chipBarRef consumers:** relocating the chip bar must not break whatever
  measures it (review chip positioning). Verify the ref still resolves to a
  laid-out element post-move.
