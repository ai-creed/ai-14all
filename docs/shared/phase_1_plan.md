# oneforall — Phase 1 Plan

## Purpose

This document expands the Phase 1 "Core App Skeleton" from [plan.md](/Users/vuphan/Dev/oneforall/plan.md).

`plan.md` remains the high-level source of truth for the full project timeline.

This file focuses only on the project skeleton that should exist after the Phase 0 spike proves the core technical bets.

Phase 1 should also follow the architecture rules captured in [architecture_decisions.md](/Users/vuphan/Dev/oneforall/architecture_decisions.md).

## Why This Is Phase 1

The project skeleton belongs to Phase 1, not Phase 0.

Reason:

- Phase 0 proves that Electron, PTY sessions, Git worktree discovery, and Monaco can coexist
- Phase 1 turns those proven pieces into a durable application structure

Some minimal scaffolding will exist during Phase 0, but it should stay disposable.

Phase 1 is where the codebase stops being a spike and starts becoming the product.

## Phase 1 Goal

Build the durable app skeleton that all later features will use.

By the end of this phase, the codebase should have:

- a clear separation between renderer, Electron bridge, and orchestration logic
- shared typed contracts for commands and events
- stable domain models for the core session workflow
- a predictable state structure in the frontend
- enough internal structure that later phases do not require major reorganization

This phase is about architecture and boundaries, not feature breadth.

## Inputs From Phase 0

Phase 1 should only begin once Phase 0 confirms:

- Electron is the right shell for V1 in practice
- PTY lifecycle is stable enough to continue
- worktree discovery is straightforward enough to build around
- Monaco integration is viable in the same app

Useful Phase 0 artifacts to carry forward:

- working preload pattern
- working PTY session wiring
- working worktree parsing logic
- working file-read path for Monaco

Useful Phase 0 artifacts to discard if messy:

- temporary UI layout
- ad hoc state wiring
- shortcut code that bypasses intended architecture

## Target Outcome

By the end of Phase 1, the project should feel like a real product skeleton with placeholders, not a demo.

Specifically, the codebase should support:

1. A thin Electron shell
2. A secure and narrow preload bridge
3. Shared command and event schemas
4. Local orchestration services with clear responsibility boundaries
5. A frontend store shaped around worktree sessions
6. A minimal but stable shell UI that later phases can extend

## Phase 1 Scope

Phase 1 should include:

- repo structure cleanup
- module boundaries
- typed contracts
- core domain models
- frontend store structure
- service layer boundaries
- basic logging and error paths
- minimal shell UI foundation

Phase 1 should not include:

- persistence implementation
- restore behavior
- command presets UX
- attention signaling polish
- diff review UX
- multi-repo support
- advanced Git features
- settings screens

## Proposed Repo Structure

The structure should stay simple but intentional.

Recommended baseline:

```text
/electron
  main/
    index.ts
    windows.ts
    ipc.ts
  preload/
    index.ts

/src
  app/
    App.tsx
    routes.tsx
    providers.tsx
  components/
  features/
    worktrees/
    sessions/
    terminals/
    viewer/
    git/
  stores/
    app-store.ts
    session-store.ts
  lib/
    ipc-client.ts
    formatting.ts
  types/

/services
  worktrees/
  terminals/
  files/
  git/
  logging/

/shared
  contracts/
    commands.ts
    events.ts
  schemas/
  models/
```

This does not need to be perfect, but it should make one thing clear:

- Electron-specific code stays thin
- durable logic lives outside the renderer
- shared contracts are not duplicated

## Architectural Boundaries

Phase 1 should make these boundaries explicit.

### 1. Renderer

Responsible for:

- UI rendering
- local UI state
- command dispatch
- event consumption

Not responsible for:

- spawning processes
- calling Git directly
- reading files directly

### 2. Electron Main + Preload

Responsible for:

- application lifecycle
- window management
- secure IPC exposure
- bridging renderer requests to services

Not responsible for:

- owning product workflows
- implementing business logic that should live in services

### 3. Services Layer

Responsible for:

- worktree discovery
- PTY lifecycle
- file reads
- Git queries
- logging

This is where durable product logic should live.

### 4. Shared Layer

Responsible for:

- typed schemas
- domain models
- command and event payload definitions

This prevents renderer and backend drift.

## Domain Models To Lock In

Phase 1 should define these models clearly enough that the app can grow around them.

### Repository

Fields to include:

- id
- name
- rootPath

### Worktree

Fields to include:

- id
- repositoryId
- branchName
- path
- label

### WorktreeSession

Fields to include:

- id
- worktreeId
- title
- note
- pinned

### ProcessSession

Fields to include:

- id
- worktreeSessionId
- label
- command
- args
- cwd
- status
- lastActivityAt
- exitCode
- pinned

### FileViewState

Fields to include:

- worktreeSessionId
- selectedPath
- openPaths
- selectedMode

Phase 1 does not need every final field, but it should lock the primary shape.

## Contracts To Define

Phase 1 should define a typed command/event layer in `/shared`.

### Minimum command categories

- repository commands
- worktree commands
- terminal session commands
- file viewer commands
- Git info commands

Examples:

- `setRepositoryRoot`
- `listWorktrees`
- `createTerminalSession`
- `sendTerminalInput`
- `resizeTerminalSession`
- `stopTerminalSession`
- `readFile`
- `getWorktreeGitSummary`

### Minimum event categories

- terminal output
- terminal exit
- terminal state change
- worktree load result
- error events where needed

Contracts should be narrow and explicit. Avoid generic message buses.

## Frontend State Plan

Phase 1 should create stable store structure, even if the UI remains minimal.

Recommended state buckets:

- app state
  - current repository root
  - loading/error flags
  - selected worktree session id

- worktree state
  - discovered worktrees
  - worktree session metadata

- terminal state
  - active terminal ids per session
  - terminal metadata
  - terminal connection state

- viewer state
  - open files
  - selected file
  - selected review mode

Keep remote/system state separate from purely presentational UI state where possible.

## Step-by-Step Plan

### Step 1 — Clean Up Phase 0 Output

Review the Phase 0 spike and decide:

- what to keep
- what to rewrite
- what to discard

Expected result:

- the project is no longer carrying spike shortcuts into the real app skeleton

### Step 2 — Create The Repo Structure

Set up the agreed folders for:

- Electron main
- preload
- shared contracts
- services
- frontend app and feature modules

Expected result:

- the codebase structure matches intended ownership boundaries

### Step 3 — Extract Shared Models And Schemas

Move command payloads, event payloads, and domain models into `/shared`.

Expected result:

- both renderer and backend depend on the same shapes
- ad hoc payload drift is removed early

### Step 4 — Formalize The Electron Bridge

Replace ad hoc IPC calls with a thin and typed bridge.

Expected result:

- preload exposes a minimal API surface
- renderer uses one client path for privileged actions

### Step 5 — Organize Services

Break orchestration responsibilities into focused services:

- worktree service
- terminal service
- file service
- Git service
- logging service

Expected result:

- main process no longer accumulates unrelated logic

### Step 6 — Create Frontend State Skeleton

Define the store shape and the minimum actions/selectors needed by future phases.

Expected result:

- session-first UI work can build on stable state rather than ad hoc local component wiring

### Step 7 — Rebuild A Minimal Stable Shell UI

Create a minimal app frame with:

- worktree/session navigation area
- main content area
- placeholder regions for terminal and viewer flows

This UI does not need full polish.

Expected result:

- later phases can layer features into a stable shell instead of repeatedly rebuilding layout foundations

### Step 8 — Add Basic Error And Logging Paths

Introduce enough structure for:

- service-level logging
- command failure handling
- user-visible error boundaries where needed

Expected result:

- failures become observable and debuggable before complexity increases

## Validation Checklist

Before considering Phase 1 complete, verify:

- renderer has no direct Node access
- Electron main stays relatively thin
- services have clear ownership boundaries
- shared contracts compile cleanly on both sides
- terminal and worktree flows still work after refactor
- the frontend state model can represent the intended session-first workflow
- the project structure feels stable enough for the next few phases

## Success Gate

Phase 1 is successful if:

- the project can continue without major architectural rework
- the next phases can add features mostly by filling in modules rather than moving them around
- the codebase is easier to reason about than the Phase 0 spike

## Failure Signals

Stop and rethink if:

- business logic is spreading across renderer, preload, and main without discipline
- contracts are too generic to be meaningful
- state shape is still driven by component convenience instead of domain structure
- the shell UI is already too rigid for the intended session-first layout

## Notes For Later Phases

Phase 1 should leave obvious extension points for:

- repo-level command presets
- restore behavior
- read-only diff review
- terminal attention signaling
- multi-repo support later

But it should not implement those yet just to "prepare" for them.

The correct Phase 1 mindset is:

- define boundaries early
- defer detail until needed
