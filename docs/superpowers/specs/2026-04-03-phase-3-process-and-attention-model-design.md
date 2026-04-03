# Phase 3 — Process And Attention Model Design

## Purpose

This spec defines the next product step after the completed Phase 2 session-first workflow.

Phase 2 established the single-worktree session shell, multiple simple terminal tabs, review rails, diff inspection, and terminal-first UI polish.

Phase 3 should not broaden the app into persistence, deeper Git features, or multi-worktree comparison yet.

Its job is to make background process supervision trustworthy and convenient inside the existing session-first shell.

## Goals

Phase 3 should make the app materially better for supervising long-running agents, scripts, and recurring repo commands.

The phase should improve two things together:

- launching recurring commands quickly
- noticing when background processes need attention

The intended outcome is that terminal tabs stop behaving like disposable shell panes and become true process sessions with meaningful identity and state.

## Non-Goals

Phase 3 should not include:

- persistence or restore behavior
- multi-worktree comparison
- editable embedded code workflows
- advanced Git operations
- configurable attention rules
- advanced preset configuration such as env vars, icons, groups, or import/export
- automatic process resurrection or auto-restart policies

Those belong to later phases or only after real usage proves they are needed.

## Product Direction

The existing Phase 2 layout remains the product foundation:

- one active worktree session at a time
- terminal area as the primary interaction surface
- read-only file and diff review in the same screen
- sidebar for worktree navigation

Phase 3 upgrades the terminal area into a process-oriented workspace without changing the overall session-first architecture.

## Recommended Approach

The recommended approach is to treat Phase 3 as a process-centered upgrade to the existing shell.

This means:

- repository-level command presets
- process sessions as the runtime model for terminal tabs
- richer per-process metadata
- explicit lifecycle controls
- attention signaling that rolls up from process tab to worktree session

This approach is preferable to a preset-only or attention-only pass because presets and attention both depend on the same stronger process model.

## Preset Model

Command presets are lightweight repository-level command definitions.

Each preset should include:

- `id`
- `label`
- `command`

Examples:

- `Claude` -> `claude`
- `Codex` -> `codex`
- `Tests` -> `pnpm test`
- `Dev Server` -> `pnpm dev`

Presets belong to the repository rather than a single worktree session.

That means:

- the repository defines the available presets once
- every worktree session can launch the same presets in its own working directory
- launching a preset creates a normal process session scoped to the selected worktree

This keeps repository workflows consistent across branches while avoiding duplicated setup.

## Preset Management Scope

Phase 3 should include a simple in-app preset manager.

The preset manager should support:

- list presets
- add preset
- edit preset
- delete preset
- launch preset

The management surface should stay intentionally minimal.

Phase 3 should not add:

- advanced arguments UI
- env-var editing
- preset folders or groups
- icons
- sharing or import/export

The point is to make recurring commands easy to define and easy to relaunch, not to build a full workflow automation layer.

## Process Session Model

Phase 2 terminal tabs should evolve into a clearer `ProcessSession` runtime model.

A process session represents a live or exited terminal-backed process tab inside a worktree session.

Recommended fields:

- `id`
- `worktreeId`
- `origin` = `adHoc` | `preset`
- `presetId?`
- `label`
- `command?`
- `status`
- `lastActivityAt?`
- `exitCode?`
- `pinned`
- `attentionState` = `idle` | `activity` | `actionRequired`

Important distinction:

- presets are reusable command definitions
- process sessions are runtime instances launched from a preset or from an ad hoc shell action

This keeps launch definitions separate from live process state.

## Worktree Session Ownership

The frontend should remain session-first.

A `WorktreeSession` should continue to own the process sessions that belong to that worktree.

For Phase 3, that should include:

- ordered process session ids
- selected process session id
- selected review mode and review target
- local note
- rolled-up worktree attention state

This keeps the terminal/process model aligned with the architecture decision that terminals and review state belong to the active worktree session.

## Lifecycle Behavior

Phase 3 should support the following lifecycle controls:

- create ad hoc shell
- launch preset
- stop process
- restart process
- close process tab

Lifecycle rules:

- ad hoc shells remain available and unpinned by default
- preset-launched process sessions are pinned by default
- exited processes remain visible until manually closed
- restart should create a fresh running instance from the same preset or command intent
- pinned state affects prominence and ordering, not whether a process can be closed

Phase 3 should not auto-close exited tabs.

Auto-removal would hide useful state and make the workflow feel disruptive.

## Process Metadata

Each process session should surface a compact V1 metadata set that is easy to scan:

- label
- status
- last activity
- exit code when not running
- pinned state

This is consistent with the earlier spike guidance and should be enough to understand:

- what the process is for
- whether it is still running
- whether it recently produced output
- whether it exited successfully or failed
- whether it is important enough to stay visually prominent

Fields such as full command string, cwd, pid, start time, or restart count may exist later, but they should not dominate the Phase 3 UI.

## Attention Model

Phase 3 should distinguish between ordinary background activity and stronger action-required conditions.

Recommended attention states:

- `idle`
- `activity`
- `actionRequired`

Behavior:

- `activity` means a background process produced new output and should get a temporary visual pulse only
- `actionRequired` means a background process likely needs user intervention and should remain visibly highlighted until viewed

This follows the architecture decision already recorded for the terminal attention model.

## Attention Detection

Phase 3 should use simple heuristic detection based on terminal output.

This is preferable to manual attention marking for the first cut because manual marking would add friction exactly where the feature is meant to reduce it.

Recommended initial heuristics:

- confirmation prompts such as `continue?`, `y/n`, `yes/no`
- obvious failure words such as `error`, `failed`, `exception`
- prompt-like waiting states
- test or build output that clearly indicates failure

Heuristics should stay conservative and inspectable.

Phase 3 should not attempt:

- complex interpretation
- command-specific parsers
- configurable user rule editing

Those can be revisited later after real usage.

## Attention Propagation

Attention should appear in two places:

- the process tab itself
- the owning worktree session in the sidebar

This is important because the user may be focused on one worktree while another background session needs input.

Recommended behavior:

- process tabs show the immediate signal
- worktree sessions show rolled-up attention when any contained process needs it
- `actionRequired` should outrank ordinary `activity`
- the strongest unresolved attention state should determine the visible worktree-level affordance

This provides strong awareness without requiring constant manual scanning.

## Pinned Behavior

Pinned state should be used to keep important process sessions easy to find.

Recommended rules:

- preset-launched sessions start pinned
- ad hoc shells start unpinned
- users can pin or unpin sessions manually
- pinned sessions sort ahead of unpinned sessions within a worktree session

Pinned state in Phase 3 is a visibility tool, not a persistence feature.

## UI Behavior

The terminal area remains the operational center of the app.

The primary terminal toolbar should support:

- new ad hoc shell
- launch preset
- open preset manager

Recommended placement:

- preset launcher near the terminal controls in the session header or terminal toolbar
- preset manager in a lightweight repo-level modal or side panel

This keeps launching in the hot path while separating command definition management from the main workflow.

### Process Tabs

Process tabs should show:

- label
- compact status cues
- pinned state
- attention state when relevant

They should support:

- selection
- close
- stop
- restart
- pin or unpin

Viewed tabs should clear their unresolved attention state.

### Sidebar Signals

The sidebar should indicate when a worktree session contains background activity or action-required processes.

This signal should make it obvious which worktree needs attention before the user switches into it.

## UX Outcome

If Phase 3 is successful, the app should feel materially better for supervising long-running agent and script workflows.

The user should be able to:

- relaunch recurring repo commands quickly
- understand multiple background processes at a glance
- notice action-required sessions without staring at terminal output
- keep important preset-backed sessions easy to locate
- inspect exit state without losing context

## Acceptance Criteria

Phase 3 should be considered successful when:

- recurring repository commands can be launched quickly from any worktree
- multiple process sessions can be monitored without confusion
- preset-launched sessions remain easy to find through default pinning
- exited sessions remain visible until manually closed
- background attention is visible both at the process tab and worktree sidebar levels
- the app feels better for supervising long-running terminal workflows than the completed Phase 2 shell

## Boundaries For Later Phases

The following should remain deferred:

- persistence and restore of presets or process state
- advanced preset configuration
- configurable attention rule editing
- automatic process resurrection
- deeper Git surface expansion
- multi-worktree comparison

This keeps Phase 3 focused on the process model itself rather than dragging in later-phase concerns.
