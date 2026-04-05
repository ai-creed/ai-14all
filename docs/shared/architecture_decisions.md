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

## AD-007 — Repo Scope For V1

**Decision**

Support one repository well in V1.

Do not let multi-repo concerns complicate early architecture.

**Why**

- reduces early scope
- keeps core workflows clear
- avoids overbuilding registration and navigation too early

**Implication**

- keep repository abstractions in the model
- but optimize the first UX and first services for a single active repository

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
