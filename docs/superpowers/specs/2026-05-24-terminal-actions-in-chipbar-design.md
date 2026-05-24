# Terminal Actions in the Session Chipbar — Design

Date: 2026-05-24
Status: Approved (pending implementation)

## Problem

The terminal chrome renders a standalone toolbar row (`TerminalToolbar`) above
the slot grid, holding three controls (add shell, layout, presets). It consumes
a full row of vertical space for only three icon buttons, shrinking the usable
terminal area — especially noticeable in multi-slot layouts.

## Goal

Remove the standalone terminal header row and fold its three controls into the
existing **session chipbar** (`SessionChipBar`) as **icon+text chip buttons**,
grouped separately from the existing Files/Note chips. The terminal slot grid
then reclaims the freed vertical space.

## Decisions (confirmed with user)

1. **Separate terminal group** in the chipbar — Files/Note stay; the terminal
   controls form their own right-side group, visually separated by a divider.
2. **Presets is a dropdown chip** ("⚙ Presets ▾") that opens the existing
   presets menu (launch preset / manage presets).
3. **All chips are icon+text** — Files/Note gain icons too, for a consistent
   chip row.

## Components

### `SessionChipBar` (`src/features/workspace/components/SessionChipBar.tsx`)

- The existing Files and Note buttons become **icon+text** chips: a leading
  icon span (🗂 Files, 📝 Note) before the label. The note indicator dot is
  preserved.
- Add an optional prop **`terminalActions?: React.ReactNode`**. When present, it
  renders inside the `__actions` area after the Files/Note chips, separated by a
  divider element (`.shell-chip-bar__action-divider`). This keeps `SessionChipBar`
  presentational — it gains a render slot, not terminal-specific logic.

### `TerminalToolbar` → `TerminalActions` (`src/features/terminals/components/`)

Rename `TerminalToolbar.tsx` → `TerminalActions.tsx` (export `TerminalActions`).
It renders the same three controls as **chip-style buttons** (reusing the
`shell-chip-bar__action` look) rather than a toolbar row:

- **＋ Shell** — `data-testid="terminal-add-shell"`, `aria-label="Add shell"`,
  `disabled={addDisabled}`.
- **▦ Layout** — `data-testid="terminal-layout-button"`, `aria-label="Choose layout"`,
  opens the layout dialog.
- **⚙ Presets ▾** — a Radix `DropdownMenu` trigger chip; menu lists each preset
  (`onLaunchPreset`) then a separator and "Manage presets" (`onOpenPresetManager`).

Props unchanged from today's `TerminalToolbar`: `presets`, `addDisabled`,
`onAddAdHoc`, `onLaunchPreset`, `onOpenPresetManager`, `onOpenLayoutDialog`.
Each control gets a leading icon span; testids/aria-labels are preserved so the
existing unit and e2e selectors keep working.

### `MainColumnChrome` (`src/app/components/MainColumnChrome.tsx`)

Add a `terminalActions?: React.ReactNode` prop and forward it to `SessionChipBar`.
No other change.

### `App` (`src/app/App.tsx`)

- Build `<TerminalActions … />` from the handlers App already owns
  (`handleAddAdHoc`, `() => setLayoutDialogOpen(true)`, `handleLaunchPreset`,
  `() => setPresetManagerOpen(true)`, `addDisabled`, `workspaceState.commandPresets`)
  and pass it as `terminalActions` into `MainColumnChrome` (only when
  `activeWorktree` is set).
- **Remove** the standalone `<TerminalToolbar>` element rendered above
  `<TerminalPanel>`. `<TerminalPanel>` stays as-is and now fills the freed height.

### `shell.css`

- Add `.shell-chip-bar__action-divider` (a thin vertical rule / spacer between
  the Files-Note group and the terminal group).
- Add a leading-icon style for chip buttons (e.g. `.shell-chip-bar__action-icon`)
  so icon+text aligns; or render the icon inline before the label.
- Delete the now-dead `.shell-terminal-tabs*` toolbar-row styles (no remaining
  consumer once the standalone toolbar is removed).

## Data Flow

No new state. App owns all terminal handlers and the dialog/preset-manager open
setters today. The only change is *where* the controls render: App passes a
rendered `TerminalActions` node down through `MainColumnChrome` into the
`SessionChipBar` actions slot. `App.tsx`'s `addDisabled`/`runningShells`
derivation is unchanged.

## Error / Edge Handling

- Terminal chips render only when there is an active worktree (App guards the
  node); `SessionChipBar` itself renders only with an active session (existing
  `MainColumnChrome` guard), so the slot is never shown without a session.
- Add disabled at 6 running shells → the ＋ Shell chip is `disabled` (same
  `addDisabled` flag as before).
- Narrow window → the chip row wraps (`flex-wrap` on `.shell-chip-bar__actions`)
  so chips never overflow the bar.

## Testing

- **Unit — `SessionChipBar`**: renders the `terminalActions` slot node when
  provided; Files and Note chips keep their accessible names ("Open Files",
  "Open note") and the note dot still appears when `noteNonEmpty`.
- **Unit — `TerminalActions`** (migrated from `TerminalToolbar.test.tsx`): the
  add chip is enabled when `addDisabled` is false and disabled when true; the
  layout chip calls `onOpenLayoutDialog`; the presets menu lists presets and
  "Manage presets". Selectors use the preserved testids/labels.
- **e2e**: unchanged — `terminal-layout-presets.test.ts` and the cumulative-flow
  suites target `data-testid="terminal-add-shell"` / `terminal-layout-button`
  and `aria-label="Add shell"`, all preserved. Removing the header row only
  reclaims space; the overlay-guard waits in those tests still hold.

## Scope

`SessionChipBar.tsx`, `TerminalToolbar.tsx`→`TerminalActions.tsx`,
`MainColumnChrome.tsx`, `App.tsx`, `shell.css`, plus the two unit tests. One
cohesive UI relocation; no behavior change to terminal layout/slot logic. No
unrelated refactoring.
