# Phase 4 — Code Inspection And Git Review Design

## Purpose

This spec defines the next product step after the completed Phase 3 process and attention model.

Phase 3 made the terminal area more trustworthy for supervising long-running agents, scripts, and recurring commands.

Phase 4 should make the active worktree session good enough for code inspection and change review without leaving the app.

This phase should strengthen the existing session-first shell. It should not turn the app into a full editor or a full Git client.

## Goals

Phase 4 should make the app materially better for validating work produced inside the active worktree session.

The phase should improve three things together:

- inspecting changed files quickly
- reviewing per-file diffs against `HEAD`
- keeping lightweight Git context visible in the same session

The intended outcome is that the user can stay in one worktree session, run commands in terminals, and inspect the resulting code changes without switching to a separate editor or Git tool.

## Non-Goals

Phase 4 should not include:

- editable embedded code workflows (see note below)
- staging, unstaging, discard, checkout, or commit actions
- commit-by-commit review flows
- commit diff browsing
- multi-worktree comparison
- blame, branch graph, or deeper history exploration
- a full repository file explorer unrelated to changed areas
- persistence or restore behavior

Those belong to later phases or only after real usage proves they are needed.

> **Update (2026-04-18):** A narrow fast-path editor is introduced as an explicit opt-in modal in `docs/superpowers/specs/2026-04-18-lightweight-editor-design.md`. The inline viewer used by Phase 4 remains read-only; editing is not an inline workflow. See `AD-010` update for the architectural framing.

## Product Direction

The existing session-first shell remains the foundation:

- one active worktree session at a time
- terminal and process work as the primary interaction surface
- code and Git inspection in the same session
- active branch and worktree context kept visible

Phase 4 upgrades the lower review workspace into a stronger read-only inspection surface without changing the overall architecture.

The review flow should stay attached to the selected worktree session rather than introducing a separate Git page or editor mode.

## Recommended Approach

The recommended approach is to make Phase 4 a change-driven review layer for the active worktree.

This means:

- working tree changes are the primary review target
- per-file diffs are anchored to `HEAD`
- changed files remain the main review entry point
- file browsing exists only as lightweight context around changed areas
- recent commits appear as contextual information only

This approach is preferable to a full file-browser-first or commit-browser-first design because it stays aligned with the session-first product direction.

## Review Model

Phase 4 should define one clear review target:

- the selected worktree's current working tree changes

Diff behavior:

- selecting a changed file shows a per-file diff against `HEAD`
- the diff viewer is read-only
- the diff should focus on inspection rather than patch manipulation

Commit history behavior:

- a short recent-commits list should be visible as lightweight context
- recent commits should not be selectable in this phase
- commit drill-in and commit diff browsing are explicitly deferred to a later follow-on

This keeps Phase 4 centered on current-session validation rather than broader repository history browsing.

## File Browsing Scope

Phase 4 should include file browsing, but only as a support workflow around changed files.

Recommended scope:

- provide a lightweight file tree scoped to directories that contain changed files
- allow the user to open nearby files for read-only context
- do not expose a full worktree-wide repository explorer yet

This allows the user to inspect surrounding code without broadening the app into a general-purpose code browser.

## Workspace Behavior

The overall screen should continue to revolve around one selected worktree session.

The top area remains the terminal and process workspace.

The lower review workspace should continue to use two rails:

- `Changes`
- `Files`

Recommended behavior:

- `Changes` is the primary review entry point for this phase
- selecting a changed file opens a diff against `HEAD` in the central viewer
- `Files` opens the scoped file tree derived from changed directories
- selecting a file from `Files` opens read-only file content in the same central viewer
- the viewer switches between diff mode and file mode based on the current selection

The review surface should feel like a support workflow for the active session, not a separate destination.

## Git Context Surface

Phase 4 should add an intentionally small Git context surface for the active worktree.

It should show:

- branch name
- dirty or clean state
- changed files count
- changed files list
- a short recent-commits list

This surface should help the user stay oriented without pulling the product toward advanced Git client behavior.

## Session Ownership

The frontend should remain session-first.

A `WorktreeSession` should continue to own the review state that belongs to its worktree.

For Phase 4, that should include:

- selected review tab: `changes` or `files`
- selected changed file path
- selected file path
- viewer mode: `diff` or `file`
- cached Git summary for the worktree

Session switching should restore the review state for that worktree session rather than behaving statelessly.

This keeps review behavior aligned with the existing architecture rule that session state belongs to the active worktree session.

## Service Responsibilities

The service layer should provide the durable logic for Phase 4.

### Git Service

Should provide:

- worktree status summary
- changed files list for the selected worktree
- per-file diff against `HEAD`
- recent commits summary

### File Service

Should provide:

- read-only file content
- lightweight directory and file listing needed to build the scoped tree

### Main And Preload

Should remain thin and only expose typed IPC for the queries above.

The renderer should not call Git directly, read files directly, or own privileged review logic.

## UI Boundaries

Phase 4 should keep the review UI intentionally small.

Include:

- changed-files review
- scoped file browsing around changed directories
- Monaco-based read-only file viewing
- read-only diff viewing
- lightweight Git context

Do not include:

- inline editing
- patch staging controls
- discard or checkout controls
- commit actions
- commit diff browsing
- full repository navigation

These boundaries are important to keep the app aligned with its terminal-first V1 direction.

## Error Handling

Phase 4 should handle the common failure cases without widening scope.

Relevant cases:

- the worktree has no changes
- the selected file no longer exists
- a diff cannot be generated for the selected path
- the Git query fails because the worktree is invalid or unavailable

Recommended behavior:

- show clear empty states for clean worktrees
- keep error messages local to the affected review surface
- avoid dropping the entire session view because one review query failed

## Testing

Phase 4 should add both targeted unit coverage and cumulative end-to-end coverage.

Unit coverage should focus on:

- Git status parsing
- changed-files derivation
- scoped-tree derivation from changed paths
- per-file diff retrieval behavior

End-to-end coverage should extend the cumulative suite to cover:

- selecting a worktree session
- opening a changed file and seeing its diff
- switching to `Files` and opening a nearby file as read-only content
- seeing lightweight Git context including recent commits
- switching worktrees and restoring per-session review state

## Success Criteria

Phase 4 is successful when:

- the user can review current worktree changes without leaving the app
- the user can inspect nearby files for context without needing a full file explorer
- Git context is useful and visible without dominating the workflow
- the review surface supports the active session instead of competing with it

## Follow-On Work Explicitly Deferred

If Phase 4 proves useful in real usage, later follow-on work can explore:

- commit selection from the recent-commits list
- commit detail drill-in
- commit diff browsing
- broader repository file browsing

Those should be evaluated after the working-tree review flow is proven, not folded into this phase by default.
