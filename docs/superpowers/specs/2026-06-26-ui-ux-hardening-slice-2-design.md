# UI/UX Hardening — Slice 2 Design

**Date:** 2026-06-26
**Author:** Vu Phan
**Status:** Approved (design); pending spec-review gate
**Predecessor:** `2026-06-26-ui-ux-hardening-slice-1-design.md`

## Overview

Slice 2 hardens three independent UI surfaces in the ai-14all Electron desktop
app. Each is self-contained and could ship on its own; they are bundled into one
spec because they are all small, keyboard/pointer-affordance improvements to the
terminal workspace.

1. **Layout selector keyboard navigation** — make the terminal layout picker
   fully navigable by arrow keys + Enter (spatial 2D), so the Command Palette →
   "Choose layout" → navigate → Enter flow needs no mouse.
2. **Command-presets dialog redesign** — restructure each preset row into a
   title/subtitle (command as a codeblock), convert the row actions to icon
   buttons with tooltips, drop the redundant plain claude/codex default presets
   (with a safe migration for existing installs), and add a per-preset flag
   choosing whether Launch targets a pinned terminal or a throwaway shell.
3. **Resizable throwaway shell** — let the floating-shell popover be resized via
   edge and corner handles, with its size clamped to 75% of the app window width
   and 80% of the app window height.

## Global Constraints

These bind every task in the implementation plan:

- **No new runtime dependencies.** `@radix-ui/react-tooltip` is already installed;
  the redesign wraps it rather than adding anything.
- **No changes to the whisper command-target enum or the agent-skill installer**
  (carried over from slice 1; these surfaces stay frozen).
- **No regressions to slice-1 surfaces** — the floating-shell command path, the
  agent-provider registry, and provider detection remain behaviorally unchanged
  except where this spec extends them.
- **Backward-compatible persistence.** Existing saved workspace snapshots must
  hydrate without error. New persisted fields default safely for snapshots that
  predate them.
- **Pure-core-first.** Navigation geometry, preset pruning, and resize clamping
  each live in a pure, DOM-free helper that is unit-tested in isolation; the
  React components are thin consumers.
- **Verification gate.** `typecheck`, `eslint`, `prettier`, and the unit suite
  must all be green before handback.
- **Formatting.** Prettier with tabs, matching the existing codebase.

---

## Issue 1 — Layout selector: spatial-2D keyboard navigation

### Problem

`src/features/terminals/components/TerminalLayoutDialog.tsx` renders 26 layout
tiles (`LAYOUT_IDS` in `terminal-layouts.ts`) across 6 buckets grouped by shell
count. Each bucket is a `flex-wrap` row of fixed-size tiles (132×78px). The tiles
are plain `<button>`s with `onClick` only — no `tabIndex`, no `onKeyDown`, not
keyboard-focusable. Opening the dialog from the Command Palette ("Choose layout",
command id `terminal.layout`) therefore dead-ends: the user must reach for the
mouse to pick a layout.

**Goal:** the dialog is fully operable from the keyboard — arrow keys move a focus
ring between tiles, Enter selects, Esc closes — with arrow movement matching what
the eye sees in the wrapped 2D arrangement.

### Approach: spatial (geometric) 2D navigation

Arrow navigation is computed from the tiles' actual on-screen geometry, so it is
faithful to the wrapped layout regardless of how many columns a bucket wraps to or
where the bucket boundaries fall.

**Pure helper — `src/features/terminals/logic/layout-grid-nav.ts`:**

```ts
export type NavTile = {
	id: string;
	rect: { left: number; top: number; right: number; bottom: number };
	disabled: boolean;
};
export type NavDirection = "up" | "down" | "left" | "right";

// Returns the id of the nearest enabled tile in `dir` from `currentId`,
// or `currentId` itself when there is no candidate (no wrap at edges).
export function nextLayoutTile(
	tiles: NavTile[],
	currentId: string,
	dir: NavDirection,
): string;
```

Algorithm:

1. Resolve the current tile's center `(cx, cy)`.
2. Keep only enabled tiles strictly in the half-plane of `dir` (e.g. for `right`,
   `tile.center.x > cx + ε`; for `down`, `tile.center.y > cy + ε`).
3. Score each candidate by `primaryDistance + K * crossOffset`, where
   `primaryDistance` is the gap along the movement axis and `crossOffset` is the
   absolute distance along the other axis. `K` (≈ 2) biases toward staying in the
   same row/column so movement feels straight.
4. Return the lowest-scoring candidate's id; if there are none, return
   `currentId` (edges do not wrap).

Disabled tiles (layouts not available for the current shell count) are never
candidates.

**Component wiring — `TerminalLayoutDialog.tsx`:**

- **Roving tabindex.** Track `focusedId` in component state. The focused tile gets
  `tabIndex={0}`; all others `tabIndex={-1}`. A ref map (`id → HTMLButtonElement`)
  lets the dialog imperatively focus the active tile.
- **Initial focus.** On open, seed `focusedId` with the currently-applied layout
  (the tile carrying `data-current`) and focus it, so arrow movement starts from
  where the user already is.
- **Key handling** on the tiles container's `onKeyDown`:
  - Arrow keys → `nextLayoutTile(...)` → update `focusedId`, focus the new tile,
    and `scrollIntoView({ block: "nearest" })` (buckets stack vertically and may
    overflow the dialog).
  - Enter / Space → `onSelect(focusedId)` (applies the layout and closes, matching
    the existing click behavior).
  - Esc and Tab keep the native dialog behavior (Esc closes; Tab is unaffected).
- **Focus affordance.** Add a `:focus-visible` ring to the tile button in
  `shell.css` so the keyboard position is visible.

### Decisions

- **Spatial 2D** over flat-1D or per-bucket roving tabindex: it is the only model
  that honors both horizontal and vertical movement across a variable-width,
  bucket-segmented wrapped grid.
- **No wrap at edges** — predictable; the focus simply stays put when there is no
  tile in the requested direction.
- **Enter selects and closes**, reusing the existing `onSelect` path; no separate
  "apply" affordance.

### Tests (TDD)

Unit-test the pure `nextLayoutTile` with hand-built rects that mirror the
6-bucket layout:

- From an interior tile, each of ↑ ↓ ← → lands on the expected neighbor.
- At each edge (top row up, bottom row down, leftmost left, rightmost right),
  the function returns the same id (no wrap).
- Disabled tiles are skipped as candidates (the result jumps over them).
- A single-tile bucket: vertical moves cross into it at the nearest column.

### Files

- Create: `src/features/terminals/logic/layout-grid-nav.ts`
- Test: `tests/unit/terminals/layout-grid-nav.test.ts`
- Modify: `src/features/terminals/components/TerminalLayoutDialog.tsx`
- Modify: `src/app/shell.css` (tile `:focus-visible` ring)

---

## Issue 2 — Command-presets dialog redesign

`src/features/terminals/components/PresetManager.tsx` lists saved command presets,
each row currently a single line — `"{label} — <code>{command}</code>"` — followed
by three text buttons (Edit / Delete / Launch), with an add/edit form below. Four
changes:

### 2a — Title/subtitle rows with the command as a codeblock

Restructure each row so the label is a title and the command sits on its own line
below as a codeblock:

```tsx
<li className="preset-row">
	<div className="preset-row__text">
		<span className="preset-row__title">{preset.label}</span>
		<code className="preset-row__command">{preset.command}</code>
	</div>
	<div className="preset-row__actions">{/* icon buttons (2b) */}</div>
</li>
```

`shell.css` styles `.preset-row__title` (normal weight) and
`.preset-row__command` (monospace, subtle background, padding, radius — a real
codeblock look, distinct from the title line).

### 2b — Icon buttons with Radix tooltips

- **New shared component — `src/components/ui/tooltip.tsx`** wrapping the
  already-installed `@radix-ui/react-tooltip` (`Provider`, `Root`, `Trigger`,
  `Content`), themed to match the app and configured with a short open delay
  (~300ms). A single `<TooltipProvider>` is mounted once at the app root so every
  tooltip shares timing.
- **Icon registry — `src/components/ui/icon.tsx`.** `edit` (✎) already exists; add
  two glyphs with their Nerd-Font codepoints: `trash` (delete) and `play`
  (launch).
- **Row actions** become `Icon` buttons — `edit`, `trash`, `play` — each wrapped
  in `Tooltip`. The Launch tooltip text reflects the preset's target:
  "Launch in pinned terminal" or "Launch in throwaway shell" (see 2d).

### 2c — Drop the plain claude/codex defaults, with safe migration

Quick-launch (`AgentLauncherBar`) already offers plain `claude` and `codex`
launches, so the two plain default presets are redundant. The two **yolo**
presets are kept — quick-launch does not offer the `--dangerously-skip-permissions`
/ `--yolo` variants.

- **`shared/models/command-preset.ts`:** remove `preset-start-claude` and
  `preset-start-codex` from `DEFAULT_COMMAND_PRESETS`; keep
  `preset-start-claude-yolo` and `preset-start-codex-yolo`.
- **Migration for existing installs.** New workspaces simply seed the trimmed
  defaults, but existing saved snapshots already persisted all four. A pure
  function prunes the retired defaults from a hydrated preset list **only when
  they are untouched**:

  ```ts
  // Co-located in command-preset.ts
  export const RETIRED_DEFAULT_PRESETS = [
  	{ id: "preset-start-claude", command: "claude" },
  	{ id: "preset-start-codex", command: "codex" },
  ] as const;

  // Removes a retired default only if both its id and command still match the
  // original seed (i.e. the user never edited it). Edited presets survive.
  export function pruneRetiredDefaults(presets: CommandPreset[]): CommandPreset[];
  ```

  Applied at the hydrate path (`workspace-state.ts:513`, the
  `commandPresets: action.snapshot.commandPresets` assignment), so old and new
  workspaces converge on the same default set without destroying any preset the
  user customized.

### 2d — Per-preset launch target (pinned vs throwaway)

- **Model — `shared/models/command-preset.ts`:** add
  `target: "pinned" | "throwaway"` to `CommandPreset`. The kept yolo defaults seed
  `target: "pinned"` (today's behavior).
- **Schema — `shared/models/persisted-workspace-state.ts:60`:** extend the preset
  object schema with `target: z.enum(["pinned", "throwaway"]).optional().default("pinned")`.
  Snapshots that predate the field hydrate as `"pinned"` — fully backward
  compatible.
- **Edit form — `PresetManager.tsx`:** add a segmented toggle, "Launch in:
  [Pinned] [Throwaway]", that sets the field on save.
- **Launch routing — `src/app/hooks/use-process-actions.ts` (`handleLaunchPreset`,
  ~line 184):** branch on `preset.target`. `"throwaway"` routes through
  `runCommandInFloatingShell(command, { label })`
  (`src/app/hooks/use-floating-shell-actions.ts`); `"pinned"` keeps the existing
  pinned-slot path. The throwaway branch reuses the slice-1 floating-shell command
  path verbatim (exit-subscription-before-send ordering preserved).

### Decisions

- **Keep yolo, drop plain** — the justification ("already in quick launch") only
  covers the plain launches; yolo flags are not available elsewhere.
- **Prune only untouched retired defaults** — consistent UX across old and new
  installs without ever discarding a user's edited preset.
- **Radix tooltip** over native `title=` — icon-only buttons need fast, styled,
  discoverable tooltips; native `title` has a ~1.5s delay and no styling.
- **Per-preset stored flag** over dual launch buttons — the preset remembers its
  intent, and the row keeps a single Launch affordance (consistent with the
  icon-button minimalism).

### Tests (TDD)

- `pruneRetiredDefaults`: an untouched retired default is removed; a retired-id
  preset with an edited command is kept; the yolo defaults are kept; unrelated
  user presets are untouched.
- Schema: a snapshot preset without `target` parses and defaults to `"pinned"`;
  an explicit `"throwaway"` round-trips.
- Launch routing: `handleLaunchPreset` invokes the floating-shell path for a
  `throwaway` preset and the pinned-slot path for a `pinned` preset.

### Files

- Modify: `src/features/terminals/components/PresetManager.tsx`
- Modify: `shared/models/command-preset.ts`
- Create: `src/components/ui/tooltip.tsx`
- Modify: `src/components/ui/icon.tsx` (add `trash`, `play` glyphs)
- Modify: `shared/models/persisted-workspace-state.ts` (preset `target` field)
- Modify: `src/features/workspace/logic/workspace-state.ts` (apply prune at hydrate)
- Modify: `src/app/hooks/use-process-actions.ts` (launch routing on `target`)
- Modify: `src/app/App.tsx` (mount `TooltipProvider` at root)
- Modify: `src/app/shell.css` (row title/codeblock/icon-button styles)
- Test: `tests/unit/models/command-preset.test.ts`,
  `tests/unit/workspace/persisted-workspace-state.test.ts` (or nearest existing),
  `tests/unit/app/use-process-actions.test.ts` (or nearest existing)

---

## Issue 3 — Resizable throwaway shell

### Problem

The throwaway/floating shell renders its expanded view as
`src/features/terminals/components/FloatingShellPopover.tsx`, sized by fixed CSS
(`shell.css:5083` — `width: 920px; height: 448px; max-width: calc(100vw - 24px)`,
no `max-height`). The popover already supports drag-to-reposition (pointer events
with a clamp against `window.innerWidth/Height`), but cannot be resized. Goal:
the user can resize it via edge/corner handles, with the size clamped to at most
75% of the app window width and 80% of its height.

### Approach

**Pure helper — `src/features/terminals/logic/floating-shell-resize.ts`:**

```ts
export const MIN_FLOATING_W = 480;
export const MIN_FLOATING_H = 280;

export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };
export type ResizeHandle =
	| "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Clamp a requested size: floor at MIN_*, ceiling at 75% width / 80% height.
// Ceiling wins on tiny windows (req >= floor > ceiling => min selects ceiling).
export function clampSize(
	req: Size,
	win: { width: number; height: number },
): Size;

// Apply a pointer delta for a given handle to a starting rect, keeping the
// opposite edge pinned (n/w handles move left/top as they resize), then clamp.
export function applyResize(
	handle: ResizeHandle,
	start: Rect,
	dx: number,
	dy: number,
	win: { width: number; height: number },
): Rect;
```

`clampSize` per axis: `Math.min(ceiling, Math.max(floor, requested))`. When the
window is so small that the ceiling drops below the floor, `Math.max` returns the
floor (≥ ceiling) and `Math.min` then returns the ceiling — so the popover never
exceeds the viewport.

**Component wiring — `FloatingShellPopover.tsx`:**

- Render eight resize handle elements (4 edges + 4 corners) inside the popover.
- Each handle uses the same pointer-capture drag pattern already used for
  repositioning: on `pointerdown` capture the pointer and record the start rect;
  on `pointermove` call `applyResize(handle, start, dx, dy, win)` and apply the
  result; on `pointerup` release and persist.
- **Size state** is held in the component and initialized from a single shared
  size. Mirroring the existing position memory (`floatingPositionsRef` in
  `App.tsx:226`, an in-session `useRef` map — **not** written to the workspace
  snapshot), a new `floatingSharedSizeRef` in `App.tsx` holds one shared size
  reused by every throwaway popover for the session. Size is intentionally **not**
  persisted to disk, matching how position behaves today.
- **Double-click the header** resets both size and position to the defaults
  (920×448, anchored) — extending the existing double-click-resets-position
  affordance.
- **Terminal refit is automatic.** `TerminalPane.tsx:439` already observes its
  container via `ResizeObserver` and calls `fitAddon.fit()` + `terminals.resize`
  on any size change, so resizing the popover refits xterm with no extra wiring.

**CSS — `shell.css:5083`:** width/height move from fixed values to state-driven
inline styles (defaults remain 920×448). Add handle element styles (thin hit
areas on each edge/corner) with appropriate `cursor` values
(`ns-resize`/`ew-resize`/`nesw-resize`/`nwse-resize`). The reposition clamp stays
consistent with the new size so a resized popover can never be dragged off-screen.

### Decisions

- **Edges + corners** (8 handles) over a single SE-corner grip — chosen for
  full single-axis and two-axis control.
- **One shared in-session size** over per-shell or no persistence — resize once
  and it sticks for the session, mirroring how position is already remembered;
  only one throwaway popover is expanded at a time, so a single shared value is
  sufficient.
- **Min 480×280** floor keeps the terminal usable; the 75%/80% ceiling keeps the
  popover within the app window.

### Tests (TDD)

- `clampSize`: caps at 75% width and 80% height; floors at 480×280; on a window
  smaller than the floor, the ceiling wins (result equals the ceiling, not the
  floor).
- `applyResize`: the `e` handle grows width only; `w` grows width and moves left
  by the same delta (right edge pinned); `s` grows height only; `n` grows height
  and moves top; `se` grows both; results are clamped to the same bounds as
  `clampSize`.

### Files

- Create: `src/features/terminals/logic/floating-shell-resize.ts`
- Test: `tests/unit/terminals/floating-shell-resize.test.ts`
- Modify: `src/features/terminals/components/FloatingShellPopover.tsx`
- Modify: `src/app/App.tsx` (shared size ref + wiring)
- Modify: `src/app/shell.css` (state-driven size, handle styles/cursors)

---

## Out of scope

- No change to the whisper command-target enum or the agent-skill installer.
- No change to slice-1 behavior beyond reusing the floating-shell command path
  for throwaway-targeted preset launches.
- Cross-restart persistence of floating-shell size or position (both remain
  in-session only, by design).
- Resizing or keyboard-navigating any surface other than the three named here.

## Implementation decomposition (for the plan)

The slice spans roughly a dozen files across three independent work-streams plus
one shared component, so it is executed via subagent-driven development (as in
slice 1), decomposed into TDD tasks approximately as:

1. `layout-grid-nav` pure helper + tests.
2. `TerminalLayoutDialog` keyboard wiring + focus CSS.
3. Shared `tooltip.tsx` + `TooltipProvider` mount + icon glyphs.
4. Preset row redesign (title/subtitle/codeblock + icon buttons + tooltips).
5. Preset defaults trim + `pruneRetiredDefaults` migration + tests.
6. Preset `target` field (model + schema + form toggle + launch routing) + tests.
7. `floating-shell-resize` pure helper + tests.
8. `FloatingShellPopover` resize handles + shared-size wiring + CSS.
9. Verification gate (typecheck / eslint / prettier / unit suite green).

The plan may merge or split these; each task ends with an independently testable
deliverable.
