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
shells fill the space, in a way that keeps the "feel" of the previous layout.

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

## Decisions (from brainstorming)

1. **Trigger:** Always reorganize immediately on close. The empty-pane +
   in-place refill-gap behavior after a close is **removed**. Growing back is via
   the existing add/promote path.
2. **Shrink rule:** Preserve orientation + distribution — mirror the
   `resolvePromotedLayout` preference ladder in reverse.
3. **Target sizing:** Shrink to a layout sized to the *actual remaining running
   shells*, not blindly `currentSlotCount - 1`. This correctly handles a current
   layout that already had empty slots (e.g. a `4-grid` showing only 2 running
   shells → closing one lands at `"1"`, not a 3-slot layout with gaps).

## Design

### 1. New pure function: `resolveShrunkLayout`

Add to `src/features/terminals/logic/terminal-layout-planner.ts`:

```ts
/**
 * The layout to shrink into when the running-shell count drops to
 * `remainingCount`. Mirrors resolvePromotedLayout's preference ladder:
 * same orientation+distribution → same-orientation Equal (grid/none →
 * vertical) → any vertical Equal. Returns "1" for counts <= 1.
 */
export function resolveShrunkLayout(
  currentId: LayoutId,
  remainingCount: number,
): LayoutId;
```

Behavior:
- `remainingCount <= 1` → `"1"`.
- Otherwise, among layouts whose `slotCount === remainingCount`, pick by ladder:
  1. exact `orientation` **and** `distribution` match to the current layout;
  2. else same orientation (current `"none"` → `"vertical"`) with
     `distribution === "equal"`;
  3. else any `vertical` + `equal`.
- `remainingCount` is expected to be in `[1, 6]` (a close can only reduce the
  count). No target found is not expected for valid inputs; fall back to `"1"`
  defensively.

Approved mappings (closing one shell from a full layout):

| From      | To     |
| --------- | ------ |
| `2-v`     | `1`    |
| `2-h`     | `1`    |
| `3-v`     | `2-v`  |
| `3-h`     | `2-h`  |
| `3-vm`    | `2-v`  |
| `3-hm`    | `2-h`  |
| `4-v`     | `3-v`  |
| `4-vm`    | `3-vm` |
| `4-hm`    | `3-hm` |
| `4-grid`  | `3-v`  |
| `5-*`     | `4-*` (same family where it exists, else same-orientation equal) |
| `6-grid23`| `5-v`  |

### 2. Reducer change: `session/closeProcess`

In `workspace-state.ts` `session/closeProcess`:
- After computing `remaining` (the non-null survivors, in slot order), compute
  `terminalLayoutId = resolveShrunkLayout(session.terminalLayoutId, remaining.length)`
  and `slotProcessIds = compactIntoLayout(slots, terminalLayoutId)`.
- This replaces the current "leave a gap in place" logic. The existing
  `remaining.length === 0 → "1"/[null]` branch is subsumed by
  `resolveShrunkLayout` returning `"1"` for count 0, but keep an explicit
  `activeProcessSessionId = null` for the empty case.
- **Focus:** compaction preserves process ids, so the existing focus resolution
  (keep active process if it survives; else nearest occupied slot / first
  survivor) still yields a valid process id. Compute the surviving active id
  *before* compaction using the pre-compaction `slots`/`slotIndex`, then verify
  it against the compacted array (it will still be present, just at a new index).
- The `mcpReportingActive` reset logic is unaffected (operates on `remaining`).

### 3. Removed behavior

- The post-close empty pane and its in-place refill CTA are gone — after a close
  there are no gaps to fill.
- `session/placeProcessInNewSlot`'s same-layout gap-fill branch: verify whether
  any flow other than "refill a post-close gap" still reaches it (it is also the
  general "start a shell" placement path). **Leave the handler intact** unless it
  is proven dead; removing it is out of scope for this change. Document the
  finding in the implementation.

## Edge cases & test cases

Unit tests (`terminal-layout-planner`):
- `resolveShrunkLayout` for every approved mapping in the table above.
- `resolveShrunkLayout(id, 1)` → `"1"` and `resolveShrunkLayout(id, 0)` → `"1"`
  for a representative set of ids.
- Family-preservation: `4-vm → 3-vm`, `4-hm → 3-hm`, master preserved.
- Grid/none orientation → vertical equal: `4-grid → 3-v`, `6-grid23 → 5-v`,
  `6-grid32 → 5-v`.
- Double-master shrink (`5-vdm`, `6-vdm`) picks a valid same-orientation target.

Reducer tests (`workspace-state`, `session/closeProcess`):
- Two shells `2-v`, close one → layout `"1"`, single survivor, no gap, survivor
  focused.
- Three shells `3-v`, close the middle → `2-v`, survivors packed forward in
  order, no gap.
- Close the active shell → focus moves to nearest survivor (existing behavior
  preserved) and survivor is present in the compacted array.
- Close a non-active shell → active process stays focused and present after
  compaction.
- Master layout: `4-vm`, close a child → `3-vm`, survivors compacted.
- Layout already had gaps (e.g. `4-grid` with 2 running): close one → `"1"`.
- Close the last shell → `"1"`, `[null]`, `activeProcessSessionId === null`.
- `mcpReportingActive` resets correctly when the last running detected agent is
  the one closed (existing behavior preserved).

E2E (project rule: new user-visible behavior needs E2E coverage; coverage
accumulates, never replaces older flows):
- Open two shells (two-column layout), close one, assert the remaining shell
  fills the pane (single-pane layout) and stays interactive.

## Out of scope

- Changing the add/promote path.
- Reworking `placeProcessInNewSlot` beyond the dead-code check.
- Manual layout selection (`session/setTerminalLayout`) behavior.
- Animating the reflow.
