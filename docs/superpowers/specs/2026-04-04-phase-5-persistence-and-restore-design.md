# Phase 5 — Persistence And Restore Design

> **Update (2026-04-10):** The terminal session resilience spec extends this restore contract to attempt live PTY reconnection before fresh creation when the renderer reloads but the main process survives. Cold starts and cross-session restores still follow the fresh-shell recreation path.

## Purpose

This spec defines the next product step after the completed Phase 4 code inspection and Git review work.

Phase 4 made the active worktree session usable for read-only code and diff inspection inside the app.

Phase 5 should make restart behavior practical for daily use by restoring workspace context after relaunch without pretending to resume live terminal processes.

## Goals

Phase 5 should improve continuity across app restarts while keeping the product honest about what is and is not restored.

The phase should improve four things together:

- reopening the same repository-centric workspace after relaunch
- restoring the last selected worktree session immediately
- lazily restoring other saved worktree sessions when selected
- recreating prior process tabs as fresh live shells in the correct worktree

The intended outcome is that the user can quit and reopen the app, choose to restore the previous workspace, and return to a familiar session shape with minimal friction.

## Non-Goals

Phase 5 should not include:

- true PTY attachment or process resurrection
- restoring PIDs, terminal scrollback, or live output buffers
- multi-repository restore behavior
- advanced conflict resolution for heavily changed on-disk state
- window management persistence beyond the restore-choice preference
- eager relaunch of every saved worktree session on startup

Those remain out of scope for V1 unless real usage proves they are needed.

## Product Direction

The existing session-first shell remains the foundation:

- one repository first
- one active worktree session at a time
- terminal sessions remain the primary interaction surface
- Git review and local notes remain attached to the worktree session

Phase 5 should preserve that model across restarts rather than introducing a second workspace-management mode.

Restore should feel like returning to the same session shell, not loading a separate project-recovery screen.

## Recommended Approach

The recommended approach is a prompted, selected-session-first restore flow.

This means:

- on launch, detect whether a prior workspace snapshot exists
- if a restore preference has not been remembered, prompt the user to restore or start clean
- if restore is accepted, reopen the saved repository
- fully hydrate only the previously selected worktree session at startup
- keep other saved worktree sessions serialized until the user selects them
- recreate saved process tabs as fresh live shells when their session is hydrated

This approach is preferable to eager restore of every session because it keeps startup lighter, reduces terminal surprise, and stays aligned with the product priority of one active worktree session at a time.

## Restore Model

Phase 5 should restore context, not execution continuity.

That means:

- the app restores the previous workspace shape
- recreated process tabs are new shells
- restored shells launch in the correct worktree directory
- saved labels and lightweight metadata come back
- prior runtime execution state does not come back

Explicitly not restored:

- live process attachment
- stdout or scrollback history
- prior exit-state history beyond whatever durable metadata already belongs to the saved tab shape
- transient loading, polling, or error state

This boundary is important so the product does not imply more reliability than it can actually provide.

## Restore Preference

Phase 5 should support a small restore-policy setting.

Supported policies:

- prompt
- always restore
- always start clean

Recommended default:

- `prompt`

If the user chooses to remember their launch choice, that preference should be stored and applied on future launches until changed.

This keeps startup explicit for V1 while still allowing the workflow to become faster for users who prefer consistency.

## Workspace Snapshot Scope

Phase 5 should persist one repository-scoped workspace snapshot.

The snapshot should include:

- repository path
- selected worktree identifier or path
- restore preference
- repo-level command presets
- per-worktree saved session state needed for later hydration

Per-worktree saved session state should include:

- local note content
- review state
- open process-tab descriptors
- selected process tab

Review state should include the same read-only inspection state introduced in Phase 4, such as:

- selected review rail
- selected changed file path
- selected file path
- viewer mode

Persist only restore-worthy state. Do not persist transient renderer state that is meaningful only inside the current process lifetime.

## Process Restore Behavior

Saved process tabs should be persisted as descriptors for recreation rather than as resumable processes.

A persisted process-tab descriptor should carry enough information to recreate a fresh shell, including:

- stable tab id
- display label
- owning worktree reference
- launch type or shell intent
- any lightweight metadata already represented in session state

When the selected worktree session is restored at startup:

- its saved process tabs should be recreated as fresh live shells
- the previously selected tab should become active

When another saved worktree session is selected later:

- that session should hydrate from persisted state at that moment
- its saved process tabs should be recreated then

Phase 5 should not attempt to infer whether an old process "should still be running." Every recreated tab should be treated as a new shell entry point.

## Startup And Lazy Hydration Flow

Startup behavior should follow this sequence:

1. Load persisted restore preference and workspace snapshot.
2. If no snapshot exists, continue with normal startup.
3. If a snapshot exists, apply the restore policy.
4. If the result is restore, reopen the repository and hydrate the previously selected worktree session.
5. Keep other saved worktree sessions dormant until selected.

Lazy hydration behavior:

- when the user selects another saved worktree session, hydrate its saved note, review state, and process-tab descriptors
- recreate that session's saved process tabs as fresh shells
- after hydration, the session behaves like any normally loaded in-memory session

This preserves the session-first model without paying the startup cost of recreating every saved session immediately.

## Failure Handling

Phase 5 should handle common restore failures locally and clearly.

Relevant cases:

- the saved repository path no longer exists
- a saved worktree path no longer exists
- a process tab cannot be recreated
- persisted data is malformed or from an older incompatible shape

Recommended behavior:

- if the repository path is missing, show a local recovery state and do not crash the app
- if a worktree is missing, keep the repository open and mark that session unavailable
- if a saved process tab fails to recreate, keep the session usable and show failure locally in that tab
- if persisted data is invalid, fail safely by ignoring the invalid snapshot and falling back to clean startup

Phase 5 should avoid global startup failure because one portion of restore data is bad.

## Service Responsibilities

The service layer should own persistence and hydration logic.

### Workspace Persistence Service

Should provide:

- read persisted restore preference
- read persisted workspace snapshot
- write updated workspace snapshot
- clear or replace invalid persisted state when needed

### Session Orchestration

Should provide:

- conversion from live session state to persisted snapshot shape
- hydration of one worktree session from persisted state
- recreation of saved process tabs through the existing process lifecycle

### Main And Preload

Should remain thin and expose typed IPC for snapshot and preference load or save operations.

The renderer should not read or write persistence files directly and should not recreate process sessions by bypassing the existing session or process services.

## Architecture Boundaries

Phase 5 should not introduce a parallel state system.

The in-memory store remains the source of truth for active runtime state.

Persistence should act as:

- a serialization layer around selected store state
- a hydration input during startup or lazy session restore

It should not become:

- a second long-lived state manager
- a place for renderer-only transient flags
- a shortcut around typed contracts

This keeps the existing renderer, preload, main, and service boundaries intact.

## UI Boundaries

Phase 5 should keep the user-facing restore UI small.

Include:

- startup restore prompt when policy is `prompt`
- option to restore previous workspace
- option to start clean
- option to remember the choice for future launches
- local session-level restore error states where needed

Do not include:

- a large restore dashboard
- per-tab restore selection UI
- per-worktree restore configuration
- advanced conflict-resolution flows

The restore flow should remain a small startup decision, not a product surface of its own.

## Testing

Phase 5 should add both targeted unit coverage and cumulative end-to-end coverage.

Unit coverage should focus on:

- snapshot serialization and deserialization
- restore-policy decisions
- selected-session-first hydration behavior
- lazy hydration of non-selected worktree sessions
- failure handling for missing repository or worktree paths
- process-tab recreation from persisted descriptors

End-to-end coverage should extend the cumulative suite to cover:

- choosing restore from the startup prompt
- reopening the repository and restoring the previously selected worktree session
- restoring note, review state, and selected process tab
- recreating fresh shell tabs for the restored selected worktree
- delaying hydration of non-selected worktree sessions until selection
- choosing start clean from the startup prompt
- remembering and applying the restore preference on later launch

## Success Criteria

Phase 5 is successful when:

- the user can relaunch the app and return to the prior active worktree workflow with one startup decision
- the restored workspace shape feels familiar enough to be useful in daily use
- the app remains explicit that shells are recreated rather than resumed
- startup stays focused on the selected worktree session rather than eagerly rebuilding everything

## Follow-On Work Explicitly Deferred

If Phase 5 proves useful in real usage, later work can explore:

- richer restore preferences
- restoring multiple repositories
- restore-aware external editor handoff
- deeper recovery tools for missing paths or changed disk state
- more selective process recreation policies

Those should be evaluated after the basic restart flow is proven, not folded into this phase by default.
