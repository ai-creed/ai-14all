# Split Shell Mode Design

## Purpose

This spec defines a lightweight terminal layout extension for `ai-14all`.

The current shell model supports multiple process tabs per worktree session, but only one terminal pane is visible at a time. That works for single-process workflows, but it breaks down when the user wants to watch two long-running shells at once inside the same worktree session.

The intended outcome is that one worktree session can show two shell outputs side by side without turning the product into a general pane manager or IDE-style terminal workspace.

## Goals

This feature should improve the terminal workflow in three linked ways:

- let the user view two shell outputs at the same time inside one worktree session
- keep the feature lightweight and explicitly assigned rather than heuristic-driven
- preserve the existing session-first and tab-first terminal model

The most important use case is watching two concurrent processes in one worktree session, such as two agent shells or any other pair of long-running commands.

## Non-Goals

This feature should not include:

- multi-worktree terminal comparison
- more than two visible shells at once
- general-purpose pane layout management
- drag and drop terminal assignment in the first version
- agent-specific process roles or orchestration logic
- new backend terminal semantics or IPC changes

This phase should remain a focused renderer-side layout enhancement, not a broader terminal system redesign.

## Product Direction

The core product rules remain unchanged:

- one active worktree session at a time
- terminals remain the primary interaction surface
- worktree session state remains the canonical UI model
- tabs remain the inventory and control surface for terminal processes

Split shell mode should extend the current terminal model rather than replace it.

The user should still understand the terminal area as one session-owned shell panel with multiple process tabs. Split mode only changes how many assigned processes are visible at once.

## Recommended Approach

The recommended approach is an explicit two-slot split layout.

This means:

- each worktree session can be in `single` or `split` terminal layout mode
- split mode renders exactly two visible panes: `left` and `right`
- each split pane is assigned explicitly from the terminal tab context menu
- tabs continue to show all session processes, not only the assigned pair
- slot assignment is remembered per worktree session

This approach is preferable to an inferred active-plus-companion model because it removes ambiguity once the user has more than two shells. It also remains much smaller than a full pane manager.

## Interaction Model

### Layout Toggle

The terminal area should expose a split mode toggle.

Behavior:

- when off, the session behaves exactly as it does today with one visible terminal pane
- when on, the terminal area renders two side-by-side panes
- split mode is remembered per worktree session and restored when returning to that session

For the first version, the user does not need arbitrary resizing or pane rearrangement inside the terminal panel. The layout can use a fixed equal-width split.

### Slot Assignment

Terminal tabs should remain the primary place to choose what appears in each pane.

The tab context menu should add these actions:

- `Show in split left`
- `Show in split right`
- `Remove from split` when the tab is currently assigned to either slot

Assignment rules:

- assigning a process to `left` replaces any previous `left` assignment
- assigning a process to `right` replaces any previous `right` assignment
- one process should not occupy both slots at the same time
- if the process is already assigned to the opposite slot, reassignment should move it rather than duplicate it

This keeps split assignment explicit and predictable.

### Behavior With More Than Two Shells

The session may continue to own any number of process tabs.

Split mode only controls which two of those processes are visible at once.

This means:

- existing tabs remain visible and usable while split mode is on
- the user may reassign either split slot at any time from any tab
- opening more tabs does not disrupt the current split pair automatically

### Empty Slots

If split mode is enabled and one or both slots are unassigned, the pane should show a lightweight empty state.

Recommended copy:

- `No shell assigned to this split pane. Use a tab menu to show one here.`

This is preferable to guessing a process automatically after the mode is enabled.

### Input Focus

Each split pane should remain fully interactive.

Behavior:

- clicking inside a pane focuses that terminal for input
- the currently focused process may still be considered the active process for tab highlighting and other terminal actions
- split mode does not remove the concept of one active process; it only allows two visible panes

## State And Architecture

This feature should remain a renderer-side session-state change.

Recommended `WorktreeSession` additions:

- `terminalLayoutMode: "single" | "split"`
- `splitLeftProcessId: string | null`
- `splitRightProcessId: string | null`

These values belong in per-worktree session state because they are layout preferences tied to the current session workflow, not global application preferences.

### Rendering Model

The rendering model should stay close to the current architecture:

- `TerminalTabs` remains the process inventory and action surface
- `App.tsx` decides whether to render the existing single-pane view or the two-pane split view
- `TerminalPane` continues to render one terminal session per component instance

No privileged behavior needs to move into Electron main for this feature.

### Persistence

Split layout mode and slot assignments should be included in workspace persistence.

This is consistent with the current product direction that worktree session state should return when the user switches sessions or restores the workspace later.

### Slot Validation

Reducer behavior should validate split assignments whenever process state changes.

Rules:

- if a process is closed, clear any split slot that points to it
- if a slot points at a process id that no longer exists after restore or reconciliation, clear that slot
- if both slots become empty, split mode may remain enabled rather than silently turning itself off

Keeping split mode enabled with empty slots is preferable because it reflects the user's chosen layout instead of unexpectedly collapsing it.

## Failure And Edge Behavior

The first version should behave conservatively in edge cases.

### Process Closed While Assigned

If an assigned process is closed:

- remove it from the corresponding split slot
- keep the other slot intact
- keep split mode enabled

### Worktree Session Switch

When switching worktree sessions:

- each session should restore its own `single` or `split` mode
- each session should restore its own slot assignments if those processes still exist

### Restore After Relaunch

When workspace restore recreates processes:

- valid split assignments should reconnect if the matching process ids survive in restored session state
- invalid assignments should clear silently
- the terminal panel should never crash or render duplicate panes because of stale ids

### Tab Actions Outside Split Assignments

Stopping, restarting, pinning, or closing tabs should continue to work as they do today.

Split mode should not require a separate process lifecycle model. It is only a layout and visibility feature layered on top of existing process sessions.

## Testing

This feature should be covered at three levels.

### Unit Tests

Add reducer coverage for:

- toggling a session between `single` and `split`
- assigning left and right split slots
- moving a process from one split slot to the other
- clearing split slots when a process closes
- preserving split state across unrelated process actions

Add component coverage for:

- tab context menu actions assigning a process to `left` or `right`
- split mode rendering two panes when both slots are assigned
- empty slot placeholder rendering

### Integration Or App-Level Tests

App-level tests should cover:

- enabling split mode for a worktree session
- assigning two existing shells into split left and split right
- keeping more than two tabs while only two panes are visible
- switching away from the worktree and back while preserving split layout

### E2E Tests

The cumulative e2e suite should cover one user-facing split flow:

- load a repository
- create or expose at least two shell tabs in one worktree session
- enable split mode
- assign two shells into left and right
- verify both terminal panes are visible simultaneously
- switch worktrees and return to verify the split layout persists for that session

Drag and drop pane assignment should remain out of scope for this first phase and should not be assumed by tests.

## Deferred Follow-Up

If the first version proves useful, a later follow-up phase may add:

- drag and drop from tabs into split panes
- swap-pane actions
- pane headers with lightweight reassignment affordances

Those should be treated as polish on the same two-slot model rather than justification for expanding into a general multi-pane terminal workspace.
