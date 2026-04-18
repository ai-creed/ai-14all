# ai-14all — Architecture Decisions

## Purpose

This document records a small set of early architecture decisions that should guide the Phase 1 project skeleton.

It is intentionally short.

The goal is to prevent avoidable structural drift while the codebase is still small.

Primary references:

- [project_ai_14all_spike.md](/Users/vuphan/Dev/ai-14all/docs/shared/project_ai_14all_spike.md)
- [high_level_plan.md](/Users/vuphan/Dev/ai-14all/docs/shared/high_level_plan.md)
- [phase_1_plan.md](/Users/vuphan/Dev/ai-14all/docs/superpowers/plans/phase_1_plan.md)

## AD-001 — Desktop Runtime

**Decision**

Use `Electron` for V1.

**Why**

- the project is process-heavy and PTY-heavy
- `node-pty` fits naturally into the Electron runtime model
- this reduces early architecture complexity compared with a Tauri + Node sidecar setup

**Implication**

- prioritize implementation simplicity and reliable orchestration over minimal binary size

## AD-002 — Renderer Security Boundary

**Decision**

Keep the renderer unprivileged.

The renderer must not access Node APIs directly.

All privileged operations must go through a preload bridge and typed IPC.

**Why**

- keeps the security boundary clear
- prevents frontend code from becoming tightly coupled to desktop internals
- makes future shell migration less painful if needed

**Allowed renderer responsibilities**

- rendering UI
- holding view state
- dispatching typed commands
- consuming typed events

**Disallowed renderer responsibilities**

- spawning processes
- shelling out to Git
- reading files directly
- reaching into the filesystem directly

## AD-003 — IPC Shape

**Decision**

Use a narrow typed IPC contract rather than a generic message bus.

Commands and events should be explicit and grouped by domain.

**Why**

- easier to reason about
- easier to test
- less likely to accumulate ad hoc payloads
- keeps the preload bridge small

**Command domains**

- repository
- worktree
- terminal
- file viewer
- Git

**Event domains**

- terminal output
- terminal lifecycle
- load results
- structured errors when needed

**Rule**

Do not create one catch-all IPC channel for unrelated actions.

## AD-004 — Service-Oriented Local Backend

**Decision**

Put durable product logic in local services, not in Electron main and not in React components.

**Core services**

- worktree service
- terminal service
- file service
- Git service
- logging service

**Why**

- Electron main should stay thin
- frontend code should stay focused on presentation and state
- services are the most reusable part of the app

## AD-005 — Shared Contracts And Models

**Decision**

Put domain models, payload schemas, and shared contract definitions in a dedicated shared layer.

**Why**

- prevents drift between renderer and backend assumptions
- gives the app one canonical vocabulary for worktrees, sessions, and processes

**Initial shared models**

- `Repository`
- `Worktree`
- `WorktreeSession`
- `ProcessSession`
- `FileViewState`

## AD-006 — Session-First State Model

**Decision**

Model the frontend around worktree sessions, not files and not standalone terminals.

**Why**

- the product is session-first
- terminals, Git context, and code review all belong to the same worktree-centered workflow

**Implication**

- store shape and UI navigation should revolve around the selected worktree session

## AD-007 — Workspace Scope For Current Product

**Decision**

Support several repository-scoped workspaces in one app, but keep only one workspace foregrounded at a time.

Do not let that expansion collapse the session-first model into a dashboard.

**Why**

- preserves the worktree-session-centered workflow
- supports real use across two or three active projects
- keeps renderer and backend logic explicitly workspace-scoped

**Implication**

- keep repository abstractions in the model
- scope runtime state, IPC, and persistence by `workspaceId`
- still optimize the shell for one active workspace and one active worktree session at a time

## AD-008 — Command Preset Scope

**Decision**

Command presets belong to the repository level.

Worktree sessions may store usage state, but not duplicate preset definitions.

**Why**

- repo workflows are usually shared across branches
- avoids repetitive setup across worktrees

## AD-009 — Persistence Boundary For Early Phases

**Decision**

Early phases should persist definitions and UI context, not live process state.

**Why**

- true PTY resurrection is materially more complex
- V1 only needs practical workspace restoration

**Implication**

- reopen sessions and shell entry points cleanly
- do not promise reconnecting to the exact same live process

> **Update (2026-04-10):** The terminal session resilience spec (`docs/superpowers/specs/2026-04-10-terminal-session-resilience-design.md`) adds live terminal identity to persisted state for renderer-reload reconnection. Fresh creation remains the fallback when no live PTY exists, and cold-start restore behavior is unchanged.

## AD-010 — Code Viewer Scope

**Decision**

The embedded code viewer is read-only in V1.

It exists for inspection and review, not primary editing.

**Why**

- keeps the product from drifting into IDE scope
- keeps the terminal as the primary interactive surface

**Implication**

- support file viewing, search, and diff-oriented review
- defer editing workflows

> **Update (2026-04-18):** The lightweight editor spec (`docs/superpowers/specs/2026-04-18-lightweight-editor-design.md`) adds a narrow fast-path editing surface for agent-authored files and small config files via a modal, triggered per-file from the worktree tree. It is intentionally scoped to single-buffer, explicit-save, whitelist-gated editing and does not introduce IDE features (tabs, project-wide find/replace, refactors, Git integration, live file-watching). The embedded code viewer remains read-only in its inline form; editing is an explicit opt-in modal. The "no IDE drift" guardrail is preserved by scope, not by the read-only constraint.

## AD-011 — Terminal Attention Model

**Decision**

Terminal attention should distinguish ordinary activity from action-required prompts.

**Why**

- the user must be able to monitor multiple concurrent sessions
- a single undifferentiated unread signal is not enough

**Behavior**

- normal new output: temporary pulse
- action-required output: persistent stronger state until checked

## Review Rule

If future implementation work appears to conflict with these decisions, update this file deliberately instead of letting the code drift silently.
