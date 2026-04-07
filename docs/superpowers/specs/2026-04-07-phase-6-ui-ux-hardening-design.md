# Phase 6 UI/UX Hardening Design

## Purpose

This spec defines a focused UI hardening pass on top of the existing Phase 6 shell.

Phase 6 already established the terminal-first shell, unified review surface, top-band collapse, commit review, and horizontal review-rail resizing. This follow-up pass should improve day-to-day usability by tightening layout control, reducing visual noise, and fixing terminal shortcut ownership.

## Goals

This hardening pass should deliver five concrete improvements:

- make the lower review area vertically resizable
- make the lower review area collapsible into a thin recoverable bar
- make the worktree sidebar collapsible into a thin session rail
- normalize the shell to a strict two-size typography system
- make terminal-local shortcuts work correctly when a terminal has focus

The outcome should be a shell that shows more useful content at once, gives the user better control over terminal space, and behaves more predictably when keyboard focus is inside an embedded terminal.

## Non-Goals

This pass should not include:

- persistence for the new layout controls across relaunch
- a broad application-wide keyboard shortcut redesign
- changes to the session-first product model
- changes to the existing review modes or their core content
- editable file workflows
- broader visual redesign beyond density, sizing, and collapse behavior

## Recommended Approach

The recommended approach is a terminal-first splitter hardening pass.

This means:

- keep the current two-column shell structure
- keep the current terminal-first hierarchy
- add a vertical splitter between terminal and review
- add collapsible affordances instead of removing whole surfaces
- treat the new layout state as runtime-only for now
- implement keyboard fixes at the xterm integration boundary rather than in Electron menu wiring

This is preferable to a more ambitious shell rewrite because the current Phase 6 composition is already directionally correct. The problem is not missing product structure. The problem is that the shell needs tighter density, better space control, and clearer ownership of focus-sensitive behavior.

## Shell Layout

The app should keep the existing high-level layout:

- left session sidebar
- main workspace column
- top summary band
- terminal panel
- lower review surface

This pass should not replace that structure. It should harden it.

### Sidebar Collapse

The session sidebar should remain expanded by default, but it should support collapsing into a thin rail.

Expanded mode should continue showing:

- worktree label
- branch name
- selected state
- attention state

Collapsed mode should show:

- one-letter or icon-like worktree markers
- selected state
- attention visibility
- a clear affordance to reopen the full sidebar

The collapsed rail should stay visible at all times. It should not become a hidden edge gesture.

Sidebar collapsed state should reset to default on relaunch.

Sizing targets:

- expanded sidebar width should stay at the current `240px` default
- collapsed sidebar rail should be `56px` wide

### Bottom Review Splitter

The lower review area should become vertically resizable relative to the terminal area.

Behavior:

- place a horizontal resize handle between terminal and review
- let the user drag the handle to give more or less height to the review area
- keep the terminal as the dominant default region
- preserve the existing horizontal split inside the review area
- do not persist review height between launches

Sizing targets:

- default expanded review height should be `280px`
- minimum expanded review height should be `160px`
- minimum terminal height should be `240px`

### Bottom Review Collapse

The lower review surface should support collapse into a thin horizontal bar.

Collapsed behavior:

- reduce the review area to a thin bar instead of hiding it completely
- keep the active review mode visible in the bar
- provide a clear reopen control
- preserve current review context in memory
- do not clear the selected file, changed file, or selected commit just because the panel is collapsed

Reopening the panel should restore it as a working review surface without forcing unnecessary state loss.

Collapsed review bar target:

- collapsed review height should be `28px`

### Top Band

The existing top-band collapse behavior can remain independent from the new bottom-panel and sidebar collapse controls.

This pass should not attempt to merge all collapsible regions into one generalized layout system.

## Typography And Density

This hardening pass should standardize the shell around only two font sizes:

- `14px` for labels and headers only
- `11px` for everything else

The `11px` size should be used for:

- terminal content
- terminal tab names
- file and change list rows
- commit rows
- buttons and controls
- note text
- metadata
- viewer body text
- general shell copy

The `14px` size should be used for:

- section headers
- labels
- orientation text that introduces a section

This means the current scattered typography values in `shell.css` should be normalized into a small token set. The app should stop relying on a mixture of rem-based approximations and single-purpose pixel values for everyday shell text.

The request to reduce the overall UI size should be interpreted as a normalization goal, not as a global CSS transform. The shell should use explicit target sizes instead of multiplying existing values by a percentage.

## Terminal And Editor Text Sizing

Terminal and editor surfaces are primary reading areas, so they should use the standard content size of `11px`.

### xterm

The embedded terminal should explicitly set xterm font sizing to `11px`.

This should apply to:

- terminal output
- prompt text
- typed input

The visible terminal tab label should also use `11px`.

### Monaco

The Monaco file viewer, working-tree diff viewer, and commit diff viewer should explicitly set editor font sizing to `11px`.

This avoids relying on Monaco defaults and keeps the editor surfaces aligned with the rest of the shell’s readable-content sizing.

## Terminal Shortcut Ownership

Terminal-local shortcuts should win when the terminal has focus.

This pass should define shortcut ownership with explicit scope:

- focused terminal: terminal-local shortcuts win
- focused non-terminal shell UI: app-level shortcuts win
- focused Monaco viewer: keep existing editor behavior unless a later spec defines overrides

### Cmd+K Behavior

`Cmd+K` in a focused terminal should clear only the visible xterm buffer in the app.

It should not:

- send `clear`
- send `reset`
- inject any command text into the shell
- restart the process
- alter shell state or command history

It should:

- clear the current visible xterm output and scrollback
- keep the live PTY session running
- allow future output to continue rendering normally

This should behave as a UI-buffer clear, not as a shell command.

### Implementation Boundary

This shortcut fix should be implemented at the terminal integration layer in the renderer.

It should not rely on Electron menu roles as the primary mechanism. The core problem is focus-sensitive embedded terminal behavior, not the absence of a global application accelerator.

Unsupported shortcuts should keep their current native behavior instead of being broadly intercepted.

## State And Architecture Boundaries

This pass should keep the new layout state lightweight.

The following state should be runtime-only for now:

- sidebar collapsed flag
- bottom review collapsed flag
- bottom review height

These controls should reset to defaults on relaunch.

The existing persisted top-band collapse behavior can remain as-is. This pass should not expand workspace persistence to cover the new layout controls.

The shell should keep the current composition model:

- collapsible sidebar
- collapsible top band
- vertically resizable bottom review
- horizontally resizable review rail inside the bottom review

That is enough flexibility for this phase. The app does not need a generalized dock or panel-management subsystem.

## Testing

This pass should add targeted coverage for the new hardening behavior.

### Unit And Component Coverage

Tests should cover:

- bottom review resize behavior
- bottom review collapse and reopen behavior
- sidebar collapse into thin rail and reopen behavior
- xterm clear-buffer shortcut handling
- explicit Monaco `11px` configuration
- preservation of current review selection state while the review panel is collapsed

Existing behavior should also be protected against regression:

- default shell creation
- terminal selection and review switching
- existing horizontal review-rail resizing
- top-band collapse behavior

### E2E Coverage

The cumulative Phase 6 flow should extend to prove at least one realistic session where:

- a repository and worktree are open
- the terminal remains active and usable
- the lower review area is resized
- the lower review area is collapsed and reopened
- the sidebar is collapsed and reopened
- `Cmd+K` clears the focused terminal viewport without killing the session

## Completion Criteria

This hardening pass is complete when:

- the user can reclaim terminal space by resizing or collapsing the lower review surface
- the sidebar can collapse into a thin but still useful session rail
- the shell reads consistently at `11px` body text and `14px` labels and headers
- terminal and Monaco reading surfaces both use explicit `11px` sizing
- terminal-local shortcut behavior works correctly for `Cmd+K`
- tests cover the new interaction paths without regressing the current Phase 6 shell
