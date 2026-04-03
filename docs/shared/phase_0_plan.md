# oneforall — Phase 0 Plan

## Purpose

This document expands Phase 0 from [plan.md](/Users/vuphan/Dev/oneforall/plan.md) into a concrete execution plan.

`plan.md` remains the source of truth for the overall project timeline and phase ordering.

This file is only for the Phase 0 technical spike.

## Phase 0 Goal

Validate that the core session workflow is technically viable before investing in the broader product.

Phase 0 is successful if it proves all of the following in one thin slice:

- Electron can host the app cleanly
- the renderer-to-main security boundary is workable
- `node-pty` can power interactive terminals reliably
- Git worktrees can be discovered and displayed
- Monaco can open files from a selected worktree without fighting the terminal workflow

This phase is not about polish. It is about technical proof.

## Scope

Phase 0 should include:

- Electron shell
- React renderer
- secure preload bridge
- one selected repository
- worktree listing
- interactive terminal sessions
- basic file viewing

Phase 0 should not include:

- persistence
- restore behavior
- repo-level presets
- diff review
- attention signaling polish
- multi-repo support
- final session layout
- production packaging

## Target Outcome

By the end of Phase 0, the app should be able to:

1. Open as a desktop window
2. Load one local repository
3. Show that repository's worktrees
4. Let the user select a worktree
5. Open one or more interactive terminals in that worktree
6. Open a file from that worktree in Monaco

If those six actions feel stable, the project can move into Phase 1 with confidence.

## Deliverables

The concrete deliverables for Phase 0 are:

- a minimal Electron + React + Vite + TypeScript scaffold
- a secure preload API for the minimum required actions
- a Git worktree query path
- a PTY orchestration path using `node-pty`
- an `xterm.js` terminal view
- a Monaco file viewer
- a temporary demo UI that wires those pieces together

The UI can be ugly. It only needs to prove the workflow.

## Implementation Outcome

At the end of implementation, the spike should behave like this:

1. Launch the desktop app in development mode
2. Enter or load one repository path
3. See the parsed worktree list
4. Click a worktree
5. Open a terminal session in that worktree
6. Type commands and see live output
7. Open a file from that worktree in Monaco
8. Switch to another worktree and repeat

If this flow works reliably, the spike has done its job.

## Concrete Milestones

Phase 0 should be implemented as five small milestones.

### Milestone A — App Bootstrapping

Outcome:

- Electron launches
- React renderer loads
- preload bridge is available
- development workflow is stable

### Milestone B — Worktree Discovery

Outcome:

- repository root can be set
- `git worktree list` is parsed
- worktrees are shown in the UI

### Milestone C — Interactive Terminal

Outcome:

- PTY sessions can be created per worktree
- `xterm.js` displays terminal output
- input, resize, stop, and restart work

### Milestone D — File Viewing

Outcome:

- files can be read from the selected worktree
- Monaco displays them in read-only mode

### Milestone E — End-To-End Validation

Outcome:

- the whole thin slice works together without obvious instability

## Step-by-Step Plan

### Step 1 — Scaffold The Desktop App

Create the minimum Electron application structure with:

- Electron main process
- preload script
- React renderer
- TypeScript
- Vite-based development flow

Expected result:

- the app launches locally
- the renderer loads reliably
- the preload bridge is available

Notes:

- keep Node out of the renderer
- keep the preload API intentionally narrow from the start

Implementation notes:

- choose one Electron + Vite setup path and do not overcustomize it
- make development startup simple enough to run with one command
- keep Electron main and preload separate from renderer files immediately

### Step 2 — Define The Thin IPC Contract

Create only the IPC needed for the spike.

Minimum commands:

- select or set repository path
- list worktrees for the repository
- create terminal session for a worktree
- send terminal input
- resize terminal
- stop terminal session
- read file by absolute path

Minimum events:

- terminal output
- terminal exit
- terminal status change
- terminal error if needed

Expected result:

- the renderer never reaches directly into privileged APIs
- the Electron bridge remains thin and replaceable

Implementation notes:

- define the payload schemas before wiring every handler
- keep commands explicit instead of passing arbitrary objects around
- use one renderer-side client wrapper so UI code does not talk to `window` directly everywhere

### Step 3 — Implement Repository And Worktree Discovery

Support one repository path for the spike.

The backend side should:

- accept a repository root
- run `git worktree list --porcelain` or equivalent
- parse the output into a structured model
- return worktree label, branch, and path

Expected result:

- the UI can display a stable list of worktrees
- the user can select a worktree to inspect

Notes:

- do not build multi-repo registration yet
- do not build watchers yet

Implementation notes:

- validate that the selected path is actually a Git repository
- handle the case where the repo has no linked worktrees besides the main tree
- return normalized paths and stable identifiers where possible

### Step 4 — Implement PTY Session Management

Create the thinnest viable terminal session service.

It should support:

- creating a PTY in a selected worktree directory
- launching the default shell
- streaming stdout and stderr into the renderer
- accepting user input from the renderer
- resizing with the terminal viewport
- stopping the session cleanly

Expected result:

- the user can type into the terminal
- shell output appears live
- the terminal behaves like a real interactive session

This is the highest-risk step in the phase.

Implementation notes:

- keep one service responsible for PTY creation and teardown
- assign each terminal session a stable id
- do not overdesign terminal persistence or metadata yet
- prioritize shell correctness over UI features

### Step 5 — Render The Terminal In The UI

Add `xterm.js` to the renderer and connect it to the PTY session.

The terminal needs to prove:

- initial mount works
- output streaming works
- input forwarding works
- resize works
- the session can stop and restart

Expected result:

- at least one interactive terminal works end to end

If possible during the spike, also prove that two terminals can exist without the second one breaking the first.

Implementation notes:

- use the fit addon early so resize behavior is tested from the start
- make the renderer own only display state, not PTY lifecycle
- avoid premature terminal tab polish

### Step 6 — Add Basic Worktree Selection UI

Build a temporary UI for:

- repository path entry or hardcoded repo path
- worktree list
- active worktree selection
- one active terminal view

This does not need to match the final session-first UX yet.

Expected result:

- the user can move across a few worktrees and open terminals against them

Implementation notes:

- prefer a plain utilitarian layout
- optimize for clarity over design
- this UI is a validation surface, not the final product shell

### Step 7 — Add Basic File Viewing

Integrate Monaco only far enough to prove code viewing works.

Support:

- selecting a file path from the current worktree
- reading file content through the preload bridge
- rendering it in Monaco

Expected result:

- the app can show a code file from the selected worktree while the terminal remains usable

Notes:

- read-only is enough
- no diff mode yet
- no file tree polish yet

Implementation notes:

- start by opening a file from a simple selectable list if needed
- do not build a complete file tree unless it is cheap
- prove coexistence with the terminal before improving navigation

### Step 8 — Prove The Thin Slice End To End

Run the full spike workflow:

1. load one repository
2. show multiple worktrees
3. select a worktree
4. open a terminal in it
5. run a real command
6. switch worktrees
7. open a file from one of them

Expected result:

- the app already feels like a plausible replacement for part of the current fragmented workflow

Implementation notes:

- test on a real repository with actual worktrees
- run at least one interactive CLI and one normal shell command
- use the end-to-end run to identify what should not be carried into Phase 1

## Suggested Build Order

The safest implementation order is:

1. scaffold app shell
2. thin IPC contract
3. worktree discovery
4. PTY service
5. terminal renderer integration
6. simple worktree selector UI
7. Monaco file viewer
8. end-to-end validation pass

This avoids spending time on UI before the risky system pieces are working.

## Proposed File-Level Work Plan

The spike should likely produce a structure close to this:

```text
/electron
  main.ts
  preload.ts
  ipc/
    repository.ts
    terminal.ts
    files.ts

/services
  worktrees.ts
  terminals.ts
  files.ts

/shared
  contracts.ts
  models.ts

/src
  main.tsx
  App.tsx
  components/
    RepositoryInput.tsx
    WorktreeList.tsx
    TerminalPane.tsx
    FileViewer.tsx
```

The exact names can change, but the responsibilities should remain close to this split.

## Minimum Data Shapes For The Spike

The spike should define simple internal shapes for:

### Worktree

- `id`
- `path`
- `branchName`
- `label`

### TerminalSession

- `id`
- `worktreeId`
- `cwd`
- `status`

### FileReadResult

- `path`
- `content`

These do not need to be final production models, but they should be explicit.

## Development Commands To Support

By the time Step 1 is complete, the project should support:

- one command to start the renderer and Electron in development
- one command to typecheck if practical

Avoid building a large tooling setup in Phase 0.

The only requirement is that the spike is easy to run repeatedly.

## Technical Decisions For Phase 0

Phase 0 should make these concrete choices:

- use Electron for the desktop shell
- keep the renderer unprivileged
- use preload-based IPC, not direct Node access in the renderer
- use `node-pty` for terminal sessions
- use `xterm.js` for terminal rendering
- use Monaco in read-only mode

These are enough decisions to validate the workflow without overdesigning Phase 1.

## Recommended Temporary Repo Structure

The spike can use a simple structure such as:

```text
/electron
  main.ts
  preload.ts
/src
  main.tsx
  App.tsx
/src/components
  WorktreeList.tsx
  TerminalPane.tsx
  FileViewer.tsx
```

This does not need to match the final long-term layout yet.

It only needs to be clean enough to evolve.

## Dependencies To Expect

Phase 0 will likely need:

- `electron`
- `vite`
- `react`
- `react-dom`
- `typescript`
- `xterm`
- `@xterm/addon-fit`
- `monaco-editor`
- `node-pty`
- `zod`

Additional build tooling may be added as needed, but avoid broad setup unless it directly helps the spike.

## Manual Test Script

Use this script to validate the spike before calling Phase 0 complete:

1. Start the app in development mode
2. Load a real local repository path
3. Confirm the app lists the main worktree and any linked worktrees
4. Select one worktree and open a terminal
5. Run `pwd` and confirm the cwd matches the selected worktree
6. Run a simple command such as `ls` or `git status`
7. Resize the window and confirm the terminal resizes correctly
8. Stop the terminal session
9. Start another terminal session in the same worktree
10. Switch to another worktree and repeat `pwd`
11. Open a source file from that worktree in Monaco
12. Confirm the file viewer stays usable while the terminal is active

This test should be repeatable without restarting the whole app between each step.

## Acceptance Criteria

Phase 0 should only be considered complete when all of these are true:

- app boot is reliable in development
- repository selection works
- worktree parsing is correct on a real repo
- at least one PTY session behaves like a real shell
- terminal input and output are both stable
- resize works without obvious corruption
- terminal stop and restart both work
- a real file opens in Monaco from the selected worktree
- worktree switching does not break the open workflow

Anything less means the spike is still incomplete.

## Validation Checklist

Before calling Phase 0 complete, verify:

- the app launches reliably in development
- the repository path can be loaded
- worktrees are parsed correctly
- at least one interactive shell works
- terminal input is not delayed or broken
- terminal resize behaves correctly
- stopping and restarting a session works
- Monaco can open a real file from a worktree
- terminal and file viewer can coexist without obvious instability

## Go / No-Go Gate

Move to Phase 1 only if:

- PTY behavior is stable enough for daily experimentation
- the Electron bridge feels manageable
- one-screen worktree selection plus terminal usage already feels promising

Do not move forward casually if:

- PTY sessions are flaky
- the IPC layer already feels overcomplicated
- terminal rendering becomes the dominant source of UI instability

## Risks To Watch During Phase 0

The main risks are:

- `node-pty` build or runtime friction
- resize bugs in terminal rendering
- messy event flow between main, preload, and renderer
- file viewer and terminal lifecycle stepping on each other
- accidental scope creep into persistence or polished UI

Mitigation approach:

- keep the UI thin
- keep the contracts explicit
- test each slice immediately after it lands
- prefer working end-to-end behavior over “clean but unproven” abstraction

## Exit Notes For Phase 1

When Phase 0 is done, record:

- what worked immediately
- what felt fragile
- what should be kept out of Phase 1
- whether the current session workflow already feels valuable

That short retrospective should drive the next refinement of [plan.md](/Users/vuphan/Dev/oneforall/plan.md).
