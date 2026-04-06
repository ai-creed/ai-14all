# ai-14all — High-Level Plan

## Planning Intent

This document is a high-level delivery plan for the current V1 direction.

It is not a task-by-task implementation checklist yet.

The plan assumes:

- Electron for V1
- one repository first
- session-first UX
- interactive terminal sessions as the core workflow
- read-only code and diff inspection in the embedded viewer

The goal is to move from product validation to a usable personal MVP without overcommitting to premature infrastructure.

## Delivery Strategy

The project should be delivered in stages with explicit validation gates.

The sequence should be:

1. Prove the riskiest technical assumptions
2. Build the core session workflow
3. Add enough Git and code inspection to make sessions self-contained
4. Add persistence and restart behavior
5. Polish only after the daily workflow is already useful

## Proposed Timeline

This is a realistic high-level timeline for a focused solo build:

- Phase 0: 3 to 5 days
- Phase 1: 1 week
- Phase 2: 1 to 1.5 weeks
- Phase 3: 1 week
- Phase 4: 1 week
- Phase 5: 3 to 5 days

That puts the first usable personal MVP in roughly 5 to 7 weeks, depending on how much terminal and restore behavior fight back during implementation.

## Phase 0 — Technical Spike

**Goal:** Validate that the core workflow is technically viable before deeper product build-out.

**Focus areas:**

- Electron shell setup
- secure renderer-to-main IPC
- PTY-backed terminal sessions via `node-pty`
- worktree discovery via Git
- basic file opening in Monaco

**Deliverables:**

- minimal Electron + React + Vite app
- one selected repository loaded locally
- `git worktree list` displayed in the UI
- one or more interactive terminal sessions running inside the app
- basic file viewer opening files from a selected worktree

**Success gate:**

- multiple terminals can run reliably
- input, output, resize, stop, and restart behavior feel stable
- switching between a few worktrees does not feel fragile

**Failure signals:**

- PTY lifecycle becomes unreliable
- renderer and orchestration boundaries become messy too early
- file viewing and terminal streaming compete badly for responsiveness

## Phase 1 — Core App Skeleton

**Goal:** Establish the durable structure of the product without overbuilding persistence or UI polish.

**Focus areas:**

- app structure
- shared contracts
- session-oriented state model
- secure desktop bridge

**Deliverables:**

- project structure for frontend, Electron bridge, and orchestration services
- typed command and event contracts using `zod`
- high-level domain models for `Repository`, `Worktree`, `WorktreeSession`, `ProcessSession`, and `FileViewState`
- initial Zustand store structure
- basic error handling and logging paths

**Outcome:**

The codebase should now have a stable architectural spine so later UI and process work does not become tangled.

## Phase 2 — Session-First Workflow

**Goal:** Build the first end-to-end user experience around a single repository with multiple worktrees.

**Focus areas:**

- session navigation
- horizontal split layout
- tabbed terminal workflow
- one-screen visibility for a selected worktree

**Deliverables:**

- worktree/session sidebar
- session header with branch and lightweight Git state
- top terminal workspace with labeled tabs
- bottom review workspace with:
  - `Files` and `Changes` rail
  - center code or diff viewer
  - compact right-side context panel
- fast switching between active worktree sessions

**Success gate:**

- the app already feels better than juggling separate terminal and editor windows
- the selected worktree is understandable from one screen

## Phase 3 — Process and Attention Model

**Goal:** Make multi-session process monitoring trustworthy and convenient.

**Focus areas:**

- process session lifecycle
- repo-level command presets
- attention signaling for background output
- clear process metadata

**Deliverables:**

- create, start, stop, and restart terminal sessions
- repo-level command presets available in every worktree
- per-session metadata: label, status, last activity, exit code, pinned state
- terminal tab attention behavior:
  - temporary pulse for normal new output
  - persistent stronger state for action-required prompts

**Success gate:**

- the user can monitor multiple agents and scripts without confusion
- action-required sessions are hard to miss but not visually noisy

## Phase 4 — Code Inspection and Git Review

**Goal:** Make the session good enough for inspection and code review without leaving the app.

**Focus areas:**

- read-only code viewing
- diff-oriented review
- intentionally small Git surface

**Deliverables:**

- file tree browsing
- changed files list
- Monaco-based read-only file viewing
- diff-oriented review for changed files
- lightweight Git context showing:
  - branch
  - dirty or clean state
  - changed files count
  - changed file list
  - recent commits

**Success gate:**

- the user can inspect agent output and review code changes inside the same session
- the Git surface feels useful without turning into a separate Git client

## Phase 5 — Persistence and Restore

**Goal:** Preserve the user’s working context across app restarts in a practical V1 form.

**Focus areas:**

- saved workspace context
- reopen behavior
- user preference for restore prompts

**Deliverables:**

- persistence for repository registration, session layout, notes, recent files, open session tabs, and command presets
- reopen flow that asks whether to restore the previous context
- preference to remember that restore choice for future launches
- restored shell entry points in the correct worktree directories

**Important boundary:**

V1 should restore context, not true live PTY attachment.

That means:

- reopen the workspace shape
- recreate shell entry points cleanly
- do not promise reattachment to the exact same in-memory process

## Phase 6 — Personal MVP Hardening

**Goal:** Make the app dependable enough for repeated daily use.

**Status:** Beta-ready. Core Phase 6 hardening is complete; the remaining items are polish and can be deferred until after the first beta release.

**Focus areas:**

- UX cleanup
- performance passes
- failure handling
- practical escape hatches

**Deliverables:**

- completed:
  - workspace recovery and path-change handling
  - smoother loading and refresh behavior
  - better handling for missing worktrees, failed commands, and invalid paths
- deferred until after beta:
  - external editor integration
  - broader empty/error-state polish
  - targeted UI cleanup based on real use

**Exit condition:**

The app is useful enough that the user prefers it over their prior fragmented setup for at least part of real daily work.

## Deferred Until After MVP

These should stay out of the initial delivery unless real usage proves they are urgently needed:

- multi-repository UX as a first-class flow
- worktree creation and deletion from the app
- deep integration with specific agent APIs
- editable embedded code editor
- advanced Git operations
- collaboration or cloud sync
- remote environments
- Windows-first polish
- external editor integration
- broader UI state polish

## Recommended Working Rhythm

For this project, the right rhythm is:

1. Finish a thin slice
2. Use it immediately on a real worktree
3. Record friction
4. Refine the plan only after observing actual usage

The product risk is not lack of ideas. The product risk is building a polished shell around the wrong session workflow.

## End-To-End Coverage Rule

Each phase must add end-to-end coverage for the new user-visible behavior introduced in that phase.

End-to-end coverage is cumulative:

- keep previously covered behavior represented in the suite
- add new coverage for the current phase
- do not replace older flow coverage with a latest-phase-only spec
