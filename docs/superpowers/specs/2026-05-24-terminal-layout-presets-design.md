# Terminal Layout Presets — Design

Date: 2026-05-24
Status: Approved (pending implementation)

## Problem

The terminal chrome's current split model is `single | split` with two
hard-coded slots (`splitLeftProcessId` / `splitRightProcessId`) plus auto-assign
and `sanitizeSplitAssignments` logic tangled into tab selection
(`src/features/workspace/logic/workspace-state.ts`,
`src/app/components/TerminalPanel.tsx`, `TerminalTabs.tsx`). The special-casing
makes split behavior buggy and unpredictable, and unlimited tabbed shells in one
pane have no spatial structure.

## Goal

Replace ad-hoc splitting with a fixed **layout preset** system: the chrome is
divided into reserved **slots**, each holding exactly one terminal shell, chosen
from a catalog of preset layouts (up to 6 concurrent shells). Selection is via a
**layout dialog**. Behavior is deterministic and explicit.

## Layout Catalog

A layout is the **conjunction** of an orientation and a distribution:

- **Orientation:** `EVertical` (columns / side-by-side) · `EHorizontal` (rows /
  stacked). Not meaningful for `single` and grid.
- **Distribution:** `EEqualSized` · `EMasterChildSized` (1 master + N−1 children)
  · `EDoubleMasterChildSized` (2 masters + N−2 children, **5–6 only**) · `Grid`
  (an `EEqualSized` variant arranged as a grid).

Master is sized **2:1** vs. each child. The full **26-layout** catalog (kept in
full — no trimming):

| Bucket | Count | Layout ids |
|---|---|---|
| 1 | 1 | `1` (single) |
| 2 | 2 | `2-v` (cols), `2-h` (rows) |
| 3 | 4 | `3-v`, `3-h`, `3-vm` (master left+2 stacked), `3-hm` (master top+2 cols) |
| 4 | 5 | `4-v`, `4-h`, `4-vm`, `4-hm`, `4-grid` (2×2) |
| 5 | 6 | `5-v`, `5-h`, `5-vm`, `5-hm`, `5-vdm` (2 masters left+3 stacked), `5-hdm` (2 masters top+3 cols) |
| 6 | 8 | `6-v`, `6-h`, `6-vm`, `6-hm`, `6-vdm`, `6-hdm`, `6-grid23` (2×3), `6-grid32` (3×2) |

Total = 1+2+4+5+6+8 = **26**.

### Catalog as the single source of truth

A static table `TERMINAL_LAYOUTS: Record<LayoutId, LayoutDescriptor>` drives both
the dialog gallery and the panel geometry:

```ts
type Orientation = "vertical" | "horizontal" | "none";
type Distribution = "single" | "equal" | "master" | "double-master" | "grid";

interface LayoutDescriptor {
  id: LayoutId;            // e.g. "4-vm"
  slotCount: number;       // 1..6
  orientation: Orientation;
  distribution: Distribution;
  masterSlots: number;     // 0 (equal/grid/single), 1 (master), 2 (double-master)
  // CSS grid geometry; slotPlacements[i] positions slot index i.
  gridTemplateColumns: string;
  gridTemplateRows: string;
  slotPlacements: { gridColumn: string; gridRow: string }[]; // length === slotCount
}
```

**Slot index convention:** slot `0` (and slot `1` for double-master) is the
master region; remaining indices are children in reading order. `slotPlacements`
maps each index to its grid cell.

### Canonical geometry (authoritative)

The exact geometry for all 26 layouts is given below as the literal
`TERMINAL_LAYOUTS` table. `gridColumn`/`gridRow` use CSS grid line numbers
(`"start / end"`). Master slots use `1fr` weighting of `2` against `1` for
children (the `2fr`/`1fr` tracks). This block is the single source of truth;
implementers must reproduce it verbatim. A rendered visual of the same set is
tracked at `docs/superpowers/assets/2026-05-24-terminal-layout-map.html`.

```ts
export const TERMINAL_LAYOUTS: Record<LayoutId, LayoutDescriptor> = {
  // ---- bucket 1 ----
  "1": { id: "1", slotCount: 1, orientation: "none", distribution: "single", masterSlots: 0,
    gridTemplateColumns: "1fr", gridTemplateRows: "1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }] },

  // ---- bucket 2 ----
  "2-v": { id: "2-v", slotCount: 2, orientation: "vertical", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }] },
  "2-h": { id: "2-h", slotCount: 2, orientation: "horizontal", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }] },

  // ---- bucket 3 ----
  "3-v": { id: "3-v", slotCount: 3, orientation: "vertical", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "3 / 4", gridRow: "1 / 2" }] },
  "3-h": { id: "3-h", slotCount: 3, orientation: "horizontal", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "1 / 2", gridRow: "3 / 4" }] },
  "3-vm": { id: "3-vm", slotCount: 3, orientation: "vertical", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 3" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }] },
  "3-hm": { id: "3-hm", slotCount: 3, orientation: "horizontal", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "1fr 1fr", gridTemplateRows: "2fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 3", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }] },

  // ---- bucket 4 ----
  "4-v": { id: "4-v", slotCount: 4, orientation: "vertical", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr 1fr 1fr", gridTemplateRows: "1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "3 / 4", gridRow: "1 / 2" }, { gridColumn: "4 / 5", gridRow: "1 / 2" }] },
  "4-h": { id: "4-h", slotCount: 4, orientation: "horizontal", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "1 / 2", gridRow: "3 / 4" }, { gridColumn: "1 / 2", gridRow: "4 / 5" }] },
  "4-vm": { id: "4-vm", slotCount: 4, orientation: "vertical", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 4" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "3 / 4" }] },
  "4-hm": { id: "4-hm", slotCount: 4, orientation: "horizontal", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "2fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 4", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "3 / 4", gridRow: "2 / 3" }] },
  "4-grid": { id: "4-grid", slotCount: 4, orientation: "none", distribution: "grid", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }] },

  // ---- bucket 5 ----
  "5-v": { id: "5-v", slotCount: 5, orientation: "vertical", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gridTemplateRows: "1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "3 / 4", gridRow: "1 / 2" }, { gridColumn: "4 / 5", gridRow: "1 / 2" }, { gridColumn: "5 / 6", gridRow: "1 / 2" }] },
  "5-h": { id: "5-h", slotCount: 5, orientation: "horizontal", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "1 / 2", gridRow: "3 / 4" }, { gridColumn: "1 / 2", gridRow: "4 / 5" }, { gridColumn: "1 / 2", gridRow: "5 / 6" }] },
  "5-vm": { id: "5-vm", slotCount: 5, orientation: "vertical", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 5" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "3 / 4" }, { gridColumn: "2 / 3", gridRow: "4 / 5" }] },
  "5-hm": { id: "5-hm", slotCount: 5, orientation: "horizontal", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "1fr 1fr 1fr 1fr", gridTemplateRows: "2fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 5", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "3 / 4", gridRow: "2 / 3" }, { gridColumn: "4 / 5", gridRow: "2 / 3" }] },
  // double-master: two masters split the master region; children fill the cross axis.
  "5-vdm": { id: "5-vdm", slotCount: 5, orientation: "vertical", distribution: "double-master", masterSlots: 2,
    gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 4" }, { gridColumn: "1 / 2", gridRow: "4 / 7" }, { gridColumn: "2 / 3", gridRow: "1 / 3" }, { gridColumn: "2 / 3", gridRow: "3 / 5" }, { gridColumn: "2 / 3", gridRow: "5 / 7" }] },
  "5-hdm": { id: "5-hdm", slotCount: 5, orientation: "horizontal", distribution: "double-master", masterSlots: 2,
    gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gridTemplateRows: "2fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 4", gridRow: "1 / 2" }, { gridColumn: "4 / 7", gridRow: "1 / 2" }, { gridColumn: "1 / 3", gridRow: "2 / 3" }, { gridColumn: "3 / 5", gridRow: "2 / 3" }, { gridColumn: "5 / 7", gridRow: "2 / 3" }] },

  // ---- bucket 6 ----
  "6-v": { id: "6-v", slotCount: 6, orientation: "vertical", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gridTemplateRows: "1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "3 / 4", gridRow: "1 / 2" }, { gridColumn: "4 / 5", gridRow: "1 / 2" }, { gridColumn: "5 / 6", gridRow: "1 / 2" }, { gridColumn: "6 / 7", gridRow: "1 / 2" }] },
  "6-h": { id: "6-h", slotCount: 6, orientation: "horizontal", distribution: "equal", masterSlots: 0,
    gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr 1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "1 / 2", gridRow: "3 / 4" }, { gridColumn: "1 / 2", gridRow: "4 / 5" }, { gridColumn: "1 / 2", gridRow: "5 / 6" }, { gridColumn: "1 / 2", gridRow: "6 / 7" }] },
  "6-vm": { id: "6-vm", slotCount: 6, orientation: "vertical", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 6" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "3 / 4" }, { gridColumn: "2 / 3", gridRow: "4 / 5" }, { gridColumn: "2 / 3", gridRow: "5 / 6" }] },
  "6-hm": { id: "6-hm", slotCount: 6, orientation: "horizontal", distribution: "master", masterSlots: 1,
    gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gridTemplateRows: "2fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 6", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "3 / 4", gridRow: "2 / 3" }, { gridColumn: "4 / 5", gridRow: "2 / 3" }, { gridColumn: "5 / 6", gridRow: "2 / 3" }] },
  "6-vdm": { id: "6-vdm", slotCount: 6, orientation: "vertical", distribution: "double-master", masterSlots: 2,
    gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 3" }, { gridColumn: "1 / 2", gridRow: "3 / 5" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "3 / 4" }, { gridColumn: "2 / 3", gridRow: "4 / 5" }] },
  "6-hdm": { id: "6-hdm", slotCount: 6, orientation: "horizontal", distribution: "double-master", masterSlots: 2,
    gridTemplateColumns: "1fr 1fr 1fr 1fr", gridTemplateRows: "2fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 3", gridRow: "1 / 2" }, { gridColumn: "3 / 5", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "3 / 4", gridRow: "2 / 3" }, { gridColumn: "4 / 5", gridRow: "2 / 3" }] },
  "6-grid23": { id: "6-grid23", slotCount: 6, orientation: "none", distribution: "grid", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "3 / 4", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "3 / 4", gridRow: "2 / 3" }] },
  "6-grid32": { id: "6-grid32", slotCount: 6, orientation: "none", distribution: "grid", masterSlots: 0,
    gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr 1fr",
    slotPlacements: [{ gridColumn: "1 / 2", gridRow: "1 / 2" }, { gridColumn: "2 / 3", gridRow: "1 / 2" }, { gridColumn: "1 / 2", gridRow: "2 / 3" }, { gridColumn: "2 / 3", gridRow: "2 / 3" }, { gridColumn: "1 / 2", gridRow: "3 / 4" }, { gridColumn: "2 / 3", gridRow: "3 / 4" }] },
};
```

`LayoutId` is the union of the 26 keys above. The unit test over this table
(see Testing) asserts `slotPlacements.length === slotCount`, `masterSlots` is
0/1/2 consistent with `distribution`, and all 26 ids are present.

## Data Model

### Session (`shared/models/worktree-session.ts`)

Remove `terminalLayoutMode`, `splitLeftProcessId`, `splitRightProcessId`. Add:

- **`terminalLayoutId: LayoutId`** — current layout (default `"1"`).
- **`slotProcessIds: (string | null)[]`** — length **===** the layout's
  `slotCount`; each entry is a process-session id or `null` (empty slot).

Keep `activeProcessSessionId` (focused slot's process) and `processSessionIds`
(the worktree's processes; equals the non-null entries of `slotProcessIds`).

**Invariant:** `slotProcessIds.length === TERMINAL_LAYOUTS[terminalLayoutId].slotCount`
and `runningShells = slotProcessIds.filter(Boolean).length <= slotCount`. Empty
slots are allowed (they appear after a close); there are no hidden/overflow
shells.

### Persisted schema (`shared/models/persisted-workspace-state.ts`)

Drop `terminalLayoutMode` / `splitLeftProcessId` / `splitRightProcessId`. Add
`terminalLayoutId` (default `"1"`) and `slotProcessIds` (default `[null]`). See
Migration.

## Selector Dialog (`TerminalLayoutDialog`, new)

A modal gallery that mirrors the layout map:

- One **bucket group per row-section**, ordered 1 → 6, with the **bucket label on
  the left** and the layout tiles to its right.
- **Max 3 layout tiles per display row**; a bucket with more wraps to additional
  rows (still under the same left label).
- Each tile is a mini-grid glyph (master cells visually distinct) + caption,
  matching the map mockups.
- **Disabled tiles:** any layout whose `slotCount < runningShells` is greyed and
  unclickable — you cannot pick a layout too small to hold your running shells.
- Selecting an enabled tile sets `terminalLayoutId` and **compacts** the running
  shells (non-null entries, in order) into slots `0..running-1`; remaining slots
  become `null`. This is the only path to a smaller bucket — always explicit.

**Summon:** a grid-icon button in the terminal toolbar, and the keyboard shortcut
**`Cmd/Ctrl+Shift+L`** (new `terminal.layout` shortcut). Shift is required: plain
`Ctrl`+letter collides with readline bindings (Ctrl+D EOF, Ctrl+L clear, …);
`Ctrl+Shift`+letter is not a control character, so the shell/PTY never sees it —
matching the existing terminal-management family (`Ctrl+Shift+X/D/A`). The
removed split toggle frees its old `Cmd+D`.

> **Caveat:** on Linux/Windows some terminal emulators may bind `Ctrl+Shift+L`;
> the app's capture-phase handler wins while the terminal is focused. Acceptable
> for this macOS-first app; revisit if it bites.

## Components

- **`TerminalPanel`** (rewritten body) — renders a CSS grid from the active
  `LayoutDescriptor`; iterates `slotProcessIds`. A non-null slot renders a
  `TerminalPane` + a **slot header** (label, attention/status badge, `↻` restart,
  `✕` close, and — in master/double-master families, on **child** slots — a
  `↑ promote` action). A `null` slot renders a **"＋ start a shell"** CTA that
  spawns an ad-hoc shell into that exact slot. Deletes the old single/split
  branching and the "no shell assigned" placeholders.
- **`TerminalTabs` → `TerminalToolbar`** (trimmed) — keeps the launch-preset menu,
  `＋` add-shell, preset-manager, and adds the **layout button**. Drops
  tab-switching (all shells are visible), the split toggle, and the
  show-in-split / remove-from-split menus.
- **`TerminalLayoutDialog`** (new) — the gallery above.

## Behavior

### Add (`＋` / launch preset / `Cmd+T`)
1. If any slot is `null` → spawn the new process into the **first empty slot**;
   layout unchanged.
2. Else if `runningShells < 6` → **auto-promote** to the next bucket: pick the
   target layout via the family-preservation rule, grow `slotProcessIds`, and
   place the new process in the new slot.
3. Else (`runningShells === 6`) → the add button **and `Cmd+T` are disabled**.

Launching a *specific* preset places that preset in the chosen/new slot (not a
default shell). The empty-slot CTA spawns an ad-hoc default shell.

### Close (per-slot `✕`)
Sets that slot to `null`. **Layout is unchanged** — no reflow, no bucket shrink,
no repaint of other slots (the user may add another shell immediately). To shrink,
the user explicitly picks a smaller (still-valid) layout in the dialog. If the
**last** running shell is closed (`runningShells` hits 0), reset to `1` (single)
showing the empty-slot CTA.

### Family-preservation rule (auto-promote on add)
Target bucket = `currentSlotCount + 1`. Choose the target layout:
1. Same `(orientation, distribution)` if it exists in the target bucket; else
2. same orientation's `EEqualSized`; else (bucket 1) `single`.
Grid layouts have no orientation → fall back to **vertical** equal.

Examples: `3-vm` +add → `4-vm`; `4-vm` +add → `5-vm`; `4-grid` +add → `5-v`;
`5-vdm` +add → `6-vdm`.

### Promote child → master (`swapTerminalSlots`)
Available only in `master` / `double-master` families, on **child** slots. Promote
**swaps** the child's process with the **primary master (slot 0)**; the old
master moves to the child's former slot. Generalized primitive
`session/swapTerminalSlots(i, j)`; promote = `swap(childIndex, 0)`. (General
drag-reorder is out of scope v1 but reuses this primitive.)

### Focus
`activeProcessSessionId` = focused slot's process. After add → focus the new
shell; after close → focus the nearest remaining non-null slot. `terminal.selectNext`
/ `selectPrev` (`Cmd/Ctrl+Shift+D` / `…+A`) cycle focus across occupied slots.

### Resize
Slot proportions are **fixed by the layout** (master 2:1). **No draggable
dividers in v1** (the source of today's unpredictability); drag is a future add.

## Orchestration Boundary

Spawning/closing PTYs is async (`services/terminals/terminal-service.ts` via the
desktop client). The **reducer stays pure** — it only mutates `terminalLayoutId`
/ `slotProcessIds` / focus. **App-level handlers** perform the async spawn/close,
then dispatch the slot update. On **spawn failure** (fill or promote), revert:
leave the slot `null` / don't promote, and toast. This keeps the model
deterministic and unit-testable independent of the PTY backend.

## Reducer Actions

Replace `setTerminalLayoutMode`, `assignProcessToSplitSlot`,
`removeProcessFromSplit` with:

- `session/setTerminalLayout { worktreeId, layoutId }` — guards
  `slotCount >= runningShells`; compacts running shells into the new slots.
- `session/setSlotProcess { worktreeId, slotIndex, processId | null }` — fill /
  clear a slot (used by the App handlers after async spawn/close).
- `session/swapTerminalSlots { worktreeId, i, j }` — promote-to-master / swap.
- `session/promoteSlotProcess` (optional sugar) = swap(childIndex, 0).

## Migration

One-time, on first load after upgrade: **every worktree resets to `1` (single)
with one shell.** Keep `activeProcessSessionId` (or the first process) as the
single slot's occupant; terminate all other processes. Persisted hydration maps
old `terminalLayoutMode`/`split*` (now removed from schema, read leniently and
ignored) → `terminalLayoutId: "1"`, `slotProcessIds: [keptProcessId ?? null]`.

## Error / Edge Handling

- Spawn failure on add/promote → revert state + toast; no orphan slot.
- Closing the last shell → reset to `single` empty-slot CTA.
- Promote invoked outside master families → not offered (no-op).
- Dialog: layouts with `slotCount < runningShells` disabled; `setTerminalLayout`
  reducer also rejects such ids defensively (returns state unchanged).
- Layout descriptor integrity (slotPlacements length === slotCount, masterSlots
  ≤ slotCount) is asserted by a unit test over the catalog table.

## Testing

- **Unit — catalog:** every `LayoutDescriptor` has `slotPlacements.length ===
  slotCount`, valid `masterSlots`, and the 26 ids are present.
- **Unit — family-preservation resolver:** table of `(layoutId) → promoted
  layoutId` transitions incl. fallbacks (`4-grid`→`5-v`, `5-vdm`→`6-vdm`, etc.).
- **Unit — reducer:** `setTerminalLayout` compacts + rejects too-small ids;
  `setSlotProcess` fill/clear; close leaves an empty slot (no reflow);
  `swapTerminalSlots` promote semantics; migration hydration resets to single+1.
- **Component:** panel renders N slots incl. empty-slot CTA; add disabled at 6
  running; promote action shown only on child slots in master families; dialog
  greys layouts smaller than running count.
- **e2e:** dialog → grid renders N panes; add fills an empty slot then
  auto-promotes when full; close leaves an empty slot (layout unchanged); promote
  child→master swaps; at 6 running the add control is disabled.

## Scope

Large but cohesive: catalog table, session model + persisted schema + migration,
reducer actions, `TerminalPanel` (grid + slot headers + empty CTA),
`TerminalTabs`→`TerminalToolbar`, new `TerminalLayoutDialog`, App orchestration
handlers, shortcut registry (`terminal.layout`, remove split toggle, disable add
at 6), shortcuts-help listing, and CSS. The writing-plans step decomposes this
into bite-sized, independently testable tasks. No unrelated refactoring.
