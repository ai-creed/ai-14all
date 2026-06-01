# Icon system (lucide) + telemetry dropdown readability

**Date:** 2026-06-01
**Branch:** UI-overhaul
**Status:** Design — awaiting review

## Goal

Two related UI-polish pieces:

1. **Icon system** — replace ad-hoc emoji/glyph icons across the app with
   `lucide-react` (the shadcn-standard icon set, already a dependency), so
   icons are consistent, scalable, and inherit theme colors via `currentColor`.
2. **Telemetry dropdown** (`UsagePopover`) — redesign for readability
   (confirmed direction: **per-provider cards + typography fix**).

Both are independent but shipped together. lucide-react `1.17.0` is installed;
all icon names below were verified to exist in it.

## Part 1 — Icon migration to lucide-react

### Conventions

- Import named icons: `import { RefreshCw, X, Plus } from "lucide-react";`.
- Size via Tailwind: `h-4 w-4` default (icon buttons), `h-3.5 w-3.5` compact,
  `h-3 w-3` inline-with-text (the ↑/↓ token arrows). Never set color on the
  icon — it inherits `currentColor`, so existing `text-*` token classes on the
  button/parent drive the color (theme-aware automatically).
- **Preserve every existing `aria-label`** (tests resolve buttons by them; no
  test selects by glyph text — verified). Where a glyph was the only label
  (none found, but if any), add an `aria-label`.
- Icons are decorative inside labeled buttons → add `aria-hidden="true"` to the
  icon and keep the button's `aria-label`.

### Mapping

| Glyph | Meaning | Files (line) | lucide |
| --- | --- | --- | --- |
| `↻` | refresh | ReviewChipBar:88, ReviewExpandedPortal:233, TerminalPanel:185 | `RefreshCw` |
| `✕` / `×` | close | TerminalPanel:196, RestoreBanner:22, MarkdownPreviewModal:95, WorkspaceSwitcher:33, ShortcutsHelp:92, UsagePopover:203 | `X` |
| `＋` | new shell / add | TerminalActions:45, TerminalPanel:116 | `Plus` |
| `▦` | layout | TerminalActions:57 | `LayoutGrid` |
| `⚙` | presets / budget settings | TerminalActions:64, UsagePopover:368 | `Settings2` |
| `▾` | menu caret | TerminalActions:66, UsageStrip:114 | `ChevronDown` |
| `🗂` | files | SessionChipBar:102 | `Files` |
| `📝` | note | SessionChipBar:112 | `StickyNote` |
| `✎` | rename | SessionChipBar (rename button) | `Pencil` |
| `▸` / `◂` | expand / collapse sidebar | SessionSidebar:124 | `PanelLeftOpen` / `PanelLeftClose` |
| `⤓` | download | TerminalPanel:174 | `Download` |
| `↑` (scroll top) | scroll terminal to top | TerminalPanel:163 | `ArrowUp` |
| `ⓘ` | help | UsagePopover:361 | `Info` |
| `↑` / `↓` | token in / out (inline w/ number) | UsageStrip:84,87; UsagePopover:284,287,341,345,378 | `ArrowUp` / `ArrowDown` (`h-3 w-3`) |
| `✓` | resolve / done / installed | InlineCommentThread:47, ReviewQueuePanel:210, AgentInstallModal:118 | `Check` |

### Kept as-is (not action icons — confirmed)

- **Keyboard glyphs** in `<kbd>` (`↵` in FilesOverlay:268) — denote physical
  keys; conventional in `kbd`. Unchanged.
- **Status dots** (`●` dirty indicator in EditorDirtyBar:40; the sidebar
  process-state dots, already CSS) — state indicators, not action icons.
  Unchanged.

## Part 2 — Telemetry dropdown redesign (`UsagePopover`)

Direction: **per-provider cards + typography fix** (Option A). Container stays
`rounded-lg`, `w-[760px]`, portal-anchored under the caret.

### Typography

- Remove `font-mono` from the popover root. Use the app UI font (Inter) for all
  labels and prose. Apply `tabular-nums` (and a mono/figure treatment) **only to
  numeric values** (percentages, token counts) so columns still align.
- Introduce real hierarchy: section titles (existing `text-[10px] uppercase`
  kept), provider names `text-sm font-semibold`, values `text-sm`/`font-medium`,
  secondary detail `text-xs text-muted-foreground`.

### Account-limits section → per-provider cards

Replace the single 9-column grid row with one block per provider:

```
●­ claude                                  (provider name, provider color)
  5h     [gauge]   42%      resets 2h10m
  week   [gauge]   18%      0.7M / 4M · resets 4d
```

- Per provider: a name row (colored dot + name), then two aligned rows (`5h`,
  `week`), each a small grid: label · `Gauge` · bold % (tabular) · reset/detail
  (muted). Use a 4-column grid per card so the two rows align.
- Extract a `LimitCard` (or inline block) — one provider's limits — so the
  section is `snapshot.limits.map(...) => <LimitCard/>`. Keeps `UsagePopover`
  readable and the card independently understandable.

### Breakdown table

- Keep grouped-by-workspace structure and `groupByWorkspace`. Lighten: clearer
  column headers (Inter, not mono), more row vertical padding, workspace
  subtotal rows visually distinct (slightly stronger weight / top border).
- Keep the scope toggle (active / all tracked) and include-untracked checkbox.

### Footer / help / budget editor

- Functionally unchanged. Swap icons (`Info`, `Settings2`, `X`, inline
  `ArrowUp`/`ArrowDown`). Tidy spacing to match the new type scale.
- **Preserve `data-testid="usage-total"`** and any other testids.

## Testing

- Unit suite (`pnpm test`) must stay green; watch `tests/unit/.../usage` (the
  telemetry tests) and any chip-bar/terminal-actions tests — they resolve
  buttons by `aria-label`, which is preserved.
- e2e gate `flush-layout.test.ts` must stay green.
- Manual: launch the app, open the telemetry caret → verify the dropdown reads
  clearly in dark + light themes; confirm every swapped icon renders (no
  missing-glyph boxes) and icon buttons still click.

## Risks

- **Test selectors:** mitigated — no test selects by glyph; aria-labels kept.
- **Icon alignment:** lucide SVGs are baseline-different from text glyphs; inline
  `↑/↓` next to numbers need `inline-flex items-center` + `h-3 w-3` to sit
  correctly. Verify the telemetry strip visually.
- **Icon button sizing:** several glyphs lived in `Button size="icon"` (h-8 w-8)
  or bare buttons; ensure the lucide icon is centered (`h-4 w-4`) and the button
  keeps its hit area.
- **Scope creep:** only the listed glyphs change; do not restyle unrelated
  buttons.

## Out of scope

- Changing icon button behaviors, the telemetry data model, or the IPC/worker
  that produces snapshots.
- Replacing kbd key glyphs or status dots (kept by decision).
- The theme tokens / radius work (already complete).
