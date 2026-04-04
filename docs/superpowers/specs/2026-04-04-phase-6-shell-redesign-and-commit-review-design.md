# Phase 6 — Shell Redesign And Commit Review Design

## Purpose

This spec defines the next product step after the completed Phase 5 persistence and restore work.

Phase 5 made restart behavior practical by restoring workspace context and recreating fresh shells after relaunch.

Phase 6 should make the app feel deliberate and dependable in daily use by redesigning the session shell, tightening the visual hierarchy, and adding the first read-only commit review flow.

## Goals

Phase 6 should improve the product in three linked ways:

- make the active worktree session feel visually central and easier to scan
- make the terminal area feel unified instead of sporadic
- make Git review read as one coherent flow from current working-tree changes to recent commits

The intended outcome is that the user can open the app, land in a clearly structured active session, work primarily through terminals, and review both uncommitted and recent committed work without the shell feeling fragmented.

## Non-Goals

Phase 6 should not include:

- changing the session-first product rules
- changing the one-repository-first product scope
- Git action buttons such as stage, discard, commit, or checkout
- full history exploration or branch graph tooling
- multi-worktree comparison
- editable embedded code workflows
- broader product expansion beyond shell hardening and review usability

Other UX or platform work should remain deferred unless directly required to support this redesign.

## Product Direction

The core product rules remain unchanged:

- one active worktree session at a time
- terminals are still the primary interaction surface
- code and Git review stay inside the same session flow
- branch and worktree context remain obvious

Phase 6 should not reinvent the product model. It should rearrange and strengthen the existing shell so the user understands where to look, what is active, and how the current work relates to recent Git history.

## Recommended Approach

The recommended approach is a stacked-focus shell redesign with a connected Git review surface.

This means:

- keep the left sidebar for worktree/session switching
- make the center column the dominant workspace
- use a stronger header zone for session identity and live state
- turn the terminal tabs and terminal pane into one unified panel
- remove the permanent right-side context column
- restructure the review rail around `Changes`, `Commits`, and `Files`
- add read-only commit selection with side-by-side stacked commit diffs

This approach is preferable to a pure styling pass because the current problem is not only visual polish. The shell composition itself is making the workflow feel floppy and weakly prioritized.

## Shell Layout

Phase 6 should redesign the shell around a dominant center stack.

### Left Sidebar

The left sidebar should remain the place for:

- worktree/session switching
- attention visibility across worktrees

It should stay narrow and utilitarian rather than competing with the main workspace.

### Center Workspace

The center workspace should become the main focus of the application.

It should be organized as three stacked zones:

1. session header zone
2. unified terminal panel
3. review workspace

The main application window should not scroll. Only the internal panels and content regions should scroll.

This is important so the shell feels anchored and intentional instead of like a long page of unrelated sections.

## Header Zone

The header zone should absorb the highest-value session context that was previously split across the top header and the right context rail.

It should show:

- active worktree identity
- active branch
- dirty or clean state
- changed-file count
- lightweight session state or restore warnings where relevant

The header should act as the orientation and status band for the active session.

It should not become a heavy toolbar or command center. The goal is clarity, not control sprawl.

## Unified Terminal Panel

The terminal area should be redesigned as one clear panel with a shared border and flatter visual treatment.

That panel should contain:

- terminal tab pills
- the active terminal pane

The panel should:

- feel visually continuous from tab strip to terminal content
- use less floating widget chrome
- provide stronger boundaries against surrounding sections
- remain the most prominent interaction surface in the center column

### Terminal Tab Behavior

Terminal tab pills should remain the main terminal switcher.

In Phase 6 they should also support a right-click context menu with:

- pin or unpin
- stop
- restart
- close

This should replace the feeling of scattered tab actions with a more cohesive interaction model.

### Default Shell Behavior

When the app opens with a selected worktree session, there should always be an active shell available.

Behavior:

- if the selected session already has restored or existing process tabs, use the saved active one
- if the selected worktree has no process tabs, automatically create one default ad hoc shell

This avoids the empty-terminal feeling and makes the session immediately usable.

### Terminal Sizing

The unified terminal panel should use a lower minimum height than today.

Recommended target:

- minimum terminal panel height: `520px`

This gives more room to the review workspace while keeping terminals clearly primary.

## Review Surface Structure

Phase 6 should turn the lower review workspace into one connected Git-oriented reading surface.

The left review rail should be ordered as:

- `Changes`
- `Commits`
- `Files`

This ordering matches the actual importance of those surfaces in the intended workflow:

- current uncommitted work first
- recent committed work second
- nearby contextual browsing last

## Working-Tree Review

The `Changes` surface should remain fast and focused.

Behavior:

- selecting a changed file opens one diff at a time
- current working-tree review remains read-only
- current diff behavior should stay oriented around immediate validation rather than document-style reading

This should remain the fastest path for uncommitted review.

## Commit Review

Phase 6 should add the first real committed-history review surface.

### Commit List

The `Commits` rail should show recent commits as a lightweight linear graph against the merge target.

For the initial MVP use case, the merge target can be treated as:

- `origin/main`
- or `origin/master`
- up to the active worktree branch

The graph should help the user understand:

- commit order
- the current branch progression relative to the merge target
- which recent commit is being reviewed

This is intentionally not a full branch graph explorer.

### Commit Selection

Selecting a commit should open that commit’s changes in the main diff zone.

The commit diff view should:

- be read-only
- use side-by-side diff presentation
- provide clear syntax and diff highlighting
- show all changed files for the selected commit in one stacked review

### Stacked Commit Diff View

The main commit diff view should present the selected commit as a review bundle.

Behavior:

- each changed file appears as its own section
- sections are stacked vertically
- each file section is collapsible
- selecting a file from the commit-associated list focuses that file section in the stacked review

This should feel closer to a document-style commit review than a single-file toggling workflow.

Phase 6 should not add action buttons such as stage or discard to this surface.

## File Browsing

`Files` should remain available, but it should be visually and conceptually de-emphasized.

Its role remains:

- nearby read-only context for surrounding code

It should not compete with `Changes` or `Commits` for primary attention in this phase.

This keeps the product aligned with its review-oriented purpose instead of drifting toward a general code browser.

## Context Consolidation

The permanent right-side context panel should be removed from the main shell layout.

Its useful information should be redistributed:

- active session identity and current state move into the header zone
- recent commit visibility becomes part of the `Commits` review surface
- working-tree change visibility stays in `Changes`

This should make the Git flow easier to understand as one whole instead of a scattered set of metadata blocks.

## Visual Direction

Phase 6 should include a meaningful visual cleanup, but still in service of clarity.

Recommended direction:

- flatter UI influence, especially in terminal tabs and shell surfaces
- stronger panel grouping and section boundaries
- cleaner spacing and density rules
- clearer active-state emphasis
- calmer empty, loading, and error states

The goal is not to apply a decorative skin. The goal is to make the shell feel unified and intentional.

## Interaction Boundaries

Phase 6 should improve interaction quality without broadening product scope.

Include:

- component relocation
- layout recomposition
- terminal tab context menu
- commit selection and read-only commit diff review
- better internal scrolling behavior

Do not include:

- Git write actions
- editor-like inline code editing
- deep history exploration beyond the recent linear commit graph
- feature expansion unrelated to shell usability

## Architecture Boundaries

The existing architectural rules remain intact.

- renderer remains unprivileged
- Electron main remains thin
- privileged Git and file work still go through preload and typed IPC
- durable logic should remain in services rather than accumulating inside React components

Phase 6 may require new Git query surfaces for commit review, but those should still follow the existing shared-contract and service-layer pattern.

## Error Handling

Phase 6 should make error and empty states feel more controlled as part of the redesign.

Relevant cases include:

- no recent commits available in the review window
- no local changes
- commit diff cannot be loaded
- missing merge-target context for the lightweight linear graph
- no process tabs available before default-shell creation

Recommended behavior:

- show local, calm empty states
- keep failures isolated to the affected panel
- avoid collapsing the whole session shell because one review query fails

## Testing

Phase 6 should add both targeted unit coverage and cumulative end-to-end coverage.

Unit coverage should focus on:

- terminal default-shell creation logic
- review rail and header-state behavior
- commit-list and merge-target graph derivation
- commit diff view expansion and collapse behavior
- terminal tab context-menu actions

End-to-end coverage should extend the cumulative suite to cover:

- opening a selected worktree into a guaranteed active shell
- using the redesigned terminal panel and tab context menu
- switching between `Changes`, `Commits`, and `Files`
- selecting a commit from the recent history graph
- viewing a stacked side-by-side commit diff bundle
- collapsing and focusing commit file sections
- confirming the shell remains internally scrollable without page-level scrolling

## Success Criteria

Phase 6 is successful when:

- the active session becomes visually obvious and easier to operate
- the terminal area feels like one coherent panel
- the Git review surface reads as one connected flow from working-tree changes to recent commits
- the shell feels materially less floppy in real use

## MVP Boundary

Phase 6 should be treated as the main shell redesign and usability-hardening phase before claiming the personal MVP.

Other follow-on ideas should be deferred until after this phase unless they are directly required to complete the redesigned shell and review workflow.

## Follow-On Work Explicitly Deferred

After Phase 6, possible follow-on work can explore:

- broader Git history exploration
- richer branch graph interactions
- more advanced session management or process controls
- additional shell polish discovered from daily use
- post-MVP workflow expansion

Those should be evaluated after the redesigned shell is proven in real use, not pulled into this phase by default.
