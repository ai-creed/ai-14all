# Phase 2 Session-First Workflow Design

## Purpose

Phase 2 turns the current Phase 0 shell into the first cohesive daily-use workflow.

The goal is not more infrastructure. The goal is a usable one-screen workspace for a single active worktree session inside one repository.

This phase should make the app feel better than juggling separate terminal and editor windows for the same branch-oriented workflow.

## Product Direction

Phase 2 optimizes for one focused worktree session at a time.

Multi-worktree comparison is explicitly deferred. The user should be able to switch quickly between worktree sessions, but the UI should always present one active session as the center of attention.

The active session should make these things visible from one screen:

- the active branch and worktree path
- one or more terminal tabs for that worktree
- file browsing
- changed-files review
- per-file diff inspection
- a short in-memory note for local context

## Scope

Phase 2 includes:

- a session-oriented workspace layout
- worktree or session switching in a left sidebar
- multiple simple terminal tabs within the selected worktree session
- a review area with both `Files` and `Changes`
- read-only file viewing
- per-file diff viewing for changed files
- a compact right-side context panel
- a lightweight in-memory session note

Phase 2 does not include:

- side-by-side comparison between worktrees
- persistence or restore behavior
- command presets
- terminal attention states
- advanced process metadata
- restart workflows beyond the current simple terminal lifecycle
- advanced Git operations

## Workspace Shape

The entire screen should revolve around one selected worktree session.

Recommended layout:

```text
+---------------------------------------------------------------+
| Sidebar |           Session Header / Context Strip            |
|         +---------------------------------------+-------------+
|         |         Terminal Tabs / Pane          | Context     |
|         |                                       | Panel       |
|         +-----------------------+---------------+             |
|         | Files / Changes Rail  | Viewer / Diff |             |
+---------------------------------------------------------------+
```

The intended visual hierarchy is:

1. Active worktree context should be obvious immediately
2. Terminal work should remain the primary interaction surface
3. Review should be available in the same screen without feeling secondary or hidden

## Core Components

### Left Sidebar

Purpose:

- show available worktree sessions
- make switching sessions fast and predictable

Minimum contents:

- worktree label
- branch name
- selection state

Phase 2 behavior:

- selecting a worktree swaps the entire active session context
- the sidebar is for navigation, not deep management

### Session Header

Purpose:

- anchor the center workspace to the currently selected worktree

Minimum contents:

- session title or worktree label
- branch name
- lightweight Git summary

This should not become a dense toolbar in this phase.

### Terminal Workspace

Purpose:

- support the primary interactive workflow inside the active worktree session

Phase 2 requirements:

- multiple terminal tabs per worktree session
- auto-generated labels such as `shell 1`, `shell 2`
- create tab
- switch tab
- close tab

Explicitly deferred:

- custom names
- pinned tabs
- unread states
- action-required attention states
- command presets
- advanced restart controls

### Review Workspace

Purpose:

- keep code inspection and Git review in the same session workflow

The lower review area should include:

- a `Files` rail for regular file browsing
- a `Changes` rail for changed files
- a central viewer that can show either file content or per-file diffs

The app should not force the user to leave the session to inspect edits made in the active worktree.

### Right Context Panel

Purpose:

- make branch and path awareness hard to miss
- preserve a small amount of local working context

Minimum contents:

- prominently highlighted branch
- clearly visible worktree path
- small in-memory note area

The panel should be visually strong enough that the user does not lose track of which branch or path they are looking at.

## Data Model

Phase 2 should formalize the session-oriented state that is only implicit in the current Phase 0 UI.

### WorktreeSession

One logical session per worktree for this phase.

Owns:

- selected terminal tab id
- selected review mode: `files` or `changes`
- selected file path
- selected changed file path
- in-memory note

This is the main unit of focus in the renderer.

### ProcessSession

One lightweight terminal tab record under a worktree session.

Minimum fields:

- id
- worktreeSessionId
- label
- cwd
- status
- exitCode

This is intentionally lighter than the richer process model planned for later phases.

### Git Review State

Minimum state needed for the active worktree:

- branch name
- changed-files list
- selected changed file
- diff payload for the selected changed file

### Context State

Minimum context to keep visible:

- worktree path
- branch name
- short session note

## Interaction Model

The interaction rules for Phase 2 should stay simple.

### Session Switching

- selecting a worktree restores that worktree session's local UI state
- terminal selection, note text, and review selection belong to that session
- switching sessions should feel fast and should not drop the local context unnecessarily

### Terminal Flow

- user opens a new tab inside the active worktree session
- the new tab starts in the selected worktree path
- user can switch between tabs without leaving the session
- closing one tab should not disturb the others

### Review Flow

- `Files` opens read-only file content
- `Changes` opens the changed-files list for the active worktree
- selecting a changed file shows a per-file diff in the main viewer
- the viewer changes mode based on what the user selected, but remains in the same part of the layout

### Context Flow

- the right panel always reflects the active worktree session
- the session note is editable in memory only
- the note is intended for short local reminders, not durable documentation

## Architectural Implications

The current app shell in [App.tsx](/Users/vuphan/Dev/oneforall/src/app/App.tsx) is still a Phase 0 composition of top-level local state and stacked sections.

Phase 2 should move toward a session-oriented store or equivalent session model that can own:

- selected worktree session
- per-session terminal tab state
- per-session note state
- per-session review selection state

The current `TerminalSession` model in [terminal-session.ts](/Users/vuphan/Dev/oneforall/shared/models/terminal-session.ts) should evolve toward a clearer `ProcessSession` role under a worktree session model.

This phase should not overbuild persistence or full process orchestration. It only needs enough structure to make the UI coherent and extensible.

## Success Criteria

Phase 2 is successful when:

- one selected worktree session is understandable from a single screen
- switching worktrees restores local session context instead of feeling stateless
- multiple simple terminal tabs work reliably inside a worktree session
- the user can inspect both files and diffs without leaving the app
- branch and path context are prominent enough to prevent orientation mistakes
- the workflow feels materially better than juggling separate windows for terminal and review

## Deferred Work

These are explicitly not part of this design:

- multi-worktree comparison
- persistence and restore
- repo-level command presets
- terminal attention states
- richer process metadata such as last activity and pinned state
- advanced Git actions
- deeper notes or workspace documentation features

## Recommended Next Planning Step

After this design is approved, the implementation plan should break the work into a few thin slices:

1. session-oriented state and layout shell
2. terminal tabs within a session
3. changed-files and diff data flow
4. right-side context panel and in-memory note
5. integration testing for the full Phase 2 workflow
