# Auto-reorganize terminal layout on shell close

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

When a session has multiple shells arranged in a multi-slot layout (e.g. two
shells in the `2-v` two-column layout) and the user closes one shell, the layout
does **not** shrink to fit the survivors. Today the closed slot is set to `null`
and the layout id is left unchanged, leaving an empty pane behind. The empty pane
only disappears when the *last* shell is closed (reset to the single `"1"`
layout).

The user wants the layout to auto-reorganize after a close so the surviving
shells fill the space in the way that most naturally preserves where those
survivors already sit on screen.

## Current behavior (baseline)

- Reducer `session/closeProcess` (`src/features/workspace/logic/workspace-state.ts`,
  ~line 1099): sets the closed shell's slot to `null`, keeps
  `terminalLayoutId` unchanged, keeps the gap in `slotProcessIds`. Only when
  `remaining.length === 0` does it reset to `terminalLayoutId: "1"`,
  `slotProcessIds: [null]`.
- The empty pane left behind is intentional today: the `+ start a shell` CTA
  refills the exact gap in place via `session/placeProcessInNewSlot`
  (`workspace-state.ts` ~line 665), whose same-layout branch writes into the
  empty slot without compacting.
- Growing a layout when adding a shell to a full layout is handled by
  `resolvePromotedLayout` + `planAddPlacement` in
  `src/features/terminals/logic/terminal-layout-planner.ts`. `compactIntoLayout`
  packs running shells (in order) into the first slots of a target layout.
- Each layout descriptor in `terminal-layouts.ts` carries `slotPlacements`, an
  ordered array of `{ gridColumn, gridRow }` CSS grid line ranges (e.g.
  `"1 / 2"`, `"2 / 3"`). These placements are the geometric source of truth this
  design reads from.

## Decisions (from brainstorming)

1. **Trigger:** Always reorganize immediately on close. The empty-pane +
   in-place refill-gap behavior after a close is **removed**. Growing back is via
   the existing add/promote path.
2. **Shrink rule:** *Position-aware best-fit.* Read the surviving panes' actual
   grid placements and pick the smaller layout that best preserves their relative
   arrangement (who is left-of / above whom). Which pane you close therefore
   changes the result (e.g. closing the master of `3-vm` vs. a child yields
   different layouts).
3. **Preserve shape:** When the survivors still form a master/grid arrangement,
   keep it (`4-vm` close a child → `3-vm`). Only flatten to an equal split when no
   smaller layout reproduces the survivors' arrangement exactly.
4. **Target sizing:** Shrink to a layout sized to the *actual remaining running
   shells*, not blindly `currentSlotCount - 1`. This correctly handles a current
   layout that already had empty slots (e.g. a `4-grid` showing only 2 running
   shells → closing one lands at `"1"`).

## Design

### 1. New pure function: `resolveReorganizedLayout`

Add to `src/features/terminals/logic/terminal-layout-planner.ts`:

```ts
/**
 * The layout to reorganize into after a close, chosen by best-fit against the
 * surviving panes' current grid placements. `survivingSlotIndices` are the
 * indices (into currentId's slotPlacements) that still hold a running shell,
 * in ascending slot order. Returns "1" for <= 1 survivors.
 */
export function resolveReorganizedLayout(
  currentId: LayoutId,
  survivingSlotIndices: number[],
): LayoutId;
```

Algorithm:

1. `n = survivingSlotIndices.length`. If `n <= 1` → `"1"`.
2. `survivors` = `currentLayout.slotPlacements` at `survivingSlotIndices`, kept in
   ascending index order (packing order).
3. Candidate set = all catalog layouts with `slotCount === n`.
4. **Score** each candidate by pairwise spatial-relation preservation. Pair the
   `i`-th survivor with the candidate's `i`-th slot (order-aligned). For every
   pair `(i < j)` compute two relations for both survivors and candidate:
   - **horizontal**: `before` (`a.colEnd <= b.colStart`), `after`
     (`b.colEnd <= a.colStart`), else `overlap` (shared column band).
   - **vertical**: `before` (`a.rowEnd <= b.rowStart`), `after`, else `overlap`.
   Each pair contributes up to 2 points (one per relation) when the candidate's
   relation equals the survivors' relation. `maxScore = 2 * C(n, 2)`.
5. **Perfect match wins:** if the top-scoring candidate reaches `maxScore`, return
   it. This preserves master/grid shapes when the survivors still form them.
6. **Equal-split fallback:** if no candidate is a perfect match (a true grid
   remnant, e.g. an L-shape), return the equal split oriented by the survivors'
   dominant axis:
   - survivors share a common row band (intersection of all survivor row-ranges
     is non-empty) → columns → `<n>-v`;
   - survivors share a common column band → rows → `<n>-h`;
   - neither → default `<n>-v`.
7. **Tie-break** (equal scores, or multiple equal-split candidates): catalog
   order (`LAYOUT_IDS`).

Range parsing: `"1 / 2"` → `{ start: 1, end: 2 }`. Add a small internal helper
(`parseGridRange`) and relation helpers; keep them unexported unless a test needs
them directly.

### Resulting mappings (verified against `slotPlacements`)

| From        | Close                | →       |
| ----------- | -------------------- | ------- |
| `2-v`/`2-h` | any                  | `1`     |
| `3-v`       | any                  | `2-v`   |
| `3-h`       | any                  | `2-h`   |
| `3-vm`      | master (A, left)     | `2-h`   |
| `3-vm`      | child (B/C, right)   | `2-v`   |
| `3-hm`      | master (A, top)      | `2-v`   |
| `3-hm`      | child (bottom)       | `2-h`   |
| `4-v`       | any                  | `3-v`   |
| `4-h`       | any                  | `3-h`   |
| `4-vm`      | child                | `3-vm`  |
| `4-vm`      | master               | `3-h`   |
| `4-hm`      | child                | `3-hm`  |
| `4-hm`      | master (top)         | `3-v`   |
| `4-grid`    | any corner           | `3-v`   (no perfect match → equal fallback) |
| `5-*`       | child / master       | best-fit, per the same rules |
| `6-grid23`  | any                  | `5-v`   |
| `6-grid32`  | any                  | `5-v`   |

### 2. Reducer change: `session/closeProcess`

In `workspace-state.ts` `session/closeProcess`:

- After setting the closed slot to `null`, compute `survivingSlotIndices` = the
  indices of `slots` that are still non-null (ascending order).
- `terminalLayoutId = resolveReorganizedLayout(session.terminalLayoutId,
  survivingSlotIndices)`.
- `slotProcessIds = compactIntoLayout(slots, terminalLayoutId)` — survivors pack
  forward into the target with no gaps, preserving their slot order.
- Replaces the current "leave a gap in place" logic. The `remaining.length === 0`
  case is subsumed by `resolveReorganizedLayout` returning `"1"`; keep an explicit
  `activeProcessSessionId = null` for the empty case.
- **Focus:** compaction preserves process ids, so the existing focus resolution
  (keep active process if it survives; else nearest occupied slot / first
  survivor) still yields a valid process id that is present in the compacted
  array. Resolve the surviving active id using the pre-compaction `slots` /
  `slotIndex`, then rely on the fact that a surviving id remains present after
  compaction (its index shifts, which is fine).
- `mcpReportingActive` reset logic is unaffected (operates on `remaining`).

### 3. Removed behavior

- The post-close empty pane and its in-place refill CTA are gone — after a close
  there are no gaps to fill.
- `session/placeProcessInNewSlot`'s same-layout gap-fill branch: verify whether
  any flow other than "refill a post-close gap" still reaches it (it is also the
  general "start a shell" placement path). **Leave the handler intact** unless it
  is proven dead; removing it is out of scope. Document the finding in the
  implementation.

## Edge cases & test cases

Unit tests (`terminal-layout-planner`) — `resolveReorganizedLayout`:
- Every row of the mapping table above, keyed on which slot index is closed.
- `n <= 1` → `"1"` (close the last shell; close down to one survivor).
- Master preserved when a child closes: `4-vm` child → `3-vm`, `4-hm` child →
  `3-hm`, `5-vm` child → `4-vm`.
- Master collapses to stacked/equal when the master closes: `4-vm` master →
  `3-h`, `4-hm` master → `3-v`.
- Grid remnant → equal fallback: `4-grid` (each of the 4 corners) → `3-v`;
  `6-grid23`/`6-grid32` → `5-v`.
- Double-master (`5-vdm`, `5-hdm`, `6-vdm`, `6-hdm`) closes resolve to a valid
  same-count layout (assert the returned id has the right `slotCount` and a
  sensible orientation; lock exact ids once computed).
- Determinism: identical inputs always return the same id (tie-break by catalog
  order).

Reducer tests (`workspace-state`, `session/closeProcess`):
- Two shells `2-v`, close one → `"1"`, single survivor, no gap, survivor focused.
- Three shells `3-v`, close the middle → `2-v`, survivors packed forward in order.
- `3-vm`, close the master → `2-h`; close a child → `2-v`.
- `4-vm`, close a child → `3-vm`; close the master → `3-h`.
- Close the active shell → focus moves to a surviving process that is present in
  the compacted array (existing nearest-survivor behavior preserved).
- Close a non-active shell → active process stays focused and present after
  compaction.
- Layout already had gaps (`4-grid` with 2 running): close one → `"1"`.
- Close the last shell → `"1"`, `[null]`, `activeProcessSessionId === null`.
- `mcpReportingActive` resets when the last running detected agent is the closed
  one (existing behavior preserved).

E2E (project rule: new user-visible behavior needs E2E coverage; coverage
accumulates, never replaces older flows):
- Open two shells (two-column layout), close one, assert the remaining shell
  fills the single pane and stays interactive.

## Out of scope

- Changing the add/promote path.
- Reworking `placeProcessInNewSlot` beyond the dead-code check.
- Manual layout selection (`session/setTerminalLayout`) behavior.
- Animating the reflow.
