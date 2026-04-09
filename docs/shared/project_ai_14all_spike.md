# ai-14all — Project Spike

## Purpose

This document captures the current high-level intention for `ai-14all` before any scaffolding work starts.

It is not a detailed implementation plan. It exists to align on:

- what the product is
- what the MVP is not
- the preferred V1 architecture
- the technical bets that must be validated early

`plan.md` remains an earlier draft plan and will be refined later.

## Problem

The project starts from a workflow problem in local development.

When working on multiple features in parallel, the developer often ends up managing:

- multiple Git worktrees
- multiple terminal windows or tabs
- multiple coding-agent sessions
- multiple long-running scripts such as dev servers or test runners
- multiple editor windows

This creates constant context switching across terminals, folders, branches, and tools.

The friction is not writing code. The friction is coordinating parallel work cleanly.

## Product Intention

`ai-14all` is intended to be a local desktop control panel for worktree-based development sessions.

The app should make it easy to:

- see all active worktrees in one place
- switch across worktrees quickly
- run and monitor multiple processes per worktree
- inspect code and Git state without leaving the app
- reduce dependence on scattered terminal and editor windows

The product is not a full IDE replacement.

## Product Framing

The core object is the `worktree session`.

A worktree session represents one active branch or task and acts as a container for:

- repository and branch metadata
- one or more terminal-backed process sessions
- lightweight Git context
- recent files and code inspection state
- notes and labels

For MVP, this is the correct framing:

**A local mission-control app for managing parallel development sessions across Git worktrees.**

The UX should be session-first, not dashboard-first.

The main experience should help the user jump directly into active worktree sessions, inspect running processes, and switch among them quickly.

A high-level overview can exist, but it should support session navigation rather than become the center of the product.

## MVP Definition

The MVP should focus on four things:

1. Worktree discovery and navigation
2. Terminal-backed process management
3. Lightweight Git visibility
4. Embedded code inspection

If those four parts work well together, the core product is validated.

The product should still optimize for one active workspace and one active worktree session at a time, even though the app can now keep a small set of repository-scoped workspaces registered.

Multi-workspace support should remain intentionally lightweight rather than turning into a dashboard.

## MVP Capabilities

The MVP should support:

- registering a small set of local repositories as app workspaces
- fast switching between repo-scoped workspaces
- detecting and listing Git worktrees
- opening a session view for each worktree
- creating and removing worktrees from the app
- running multiple PTY-backed terminal sessions per worktree
- streaming live terminal output
- sending input to running processes
- stopping and restarting commands
- defining named command presets per worktree
- browsing files inside the selected worktree
- opening files in an embedded code viewer
- keeping the terminal fully interactive for shells, agents, and long-running commands
- showing basic Git state such as branch, changed files, and recent commits
- persisting local metadata such as workspaces, presets, notes, recent files, and layout state

For V1, the one-active-workspace flow should feel first-class and obvious even when several workspaces are registered.

## Git Surface For V1

The Git surface should stay intentionally small.

The app should provide enough Git context to support session awareness without turning into a full Git client.

The always-visible Git information for a worktree session should be:

- current branch
- dirty or clean state
- changed files count
- changed file list
- recent commits

These should help the user answer:

- what branch am I in?
- is this worktree currently dirty?
- what changed recently?

The following Git features should be secondary, optional, or deferred:

- staged versus unstaged breakdown
- diff preview
- ahead or behind status
- merge, rebase, or conflict state

V1 should favor clarity and low noise over Git completeness.

## Process Metadata For V1

The app should make multiple concurrent process sessions easy to scan.

For V1, each process session should surface a small default set of metadata:

- label
- status
- last activity
- exit code when not running
- pinned state

This should be enough for the user to quickly understand:

- what this session is for
- whether it is still running
- whether it is actively producing output
- whether it stopped successfully or failed
- whether it should stay visually prominent

The following fields should be secondary or optional:

- full command string
- working directory
- process id
- start time
- restart count

Those can still exist in details views, but they should not dominate the primary session UI.

## Code Viewer Scope For V1

The embedded code viewer should be read-only in V1.

Its job is inspection and review, not general editing.

The terminal remains fully interactive and is the primary place for active work.

The code viewer should support:

- file browsing
- opening files in tabs
- syntax highlighting
- text selection
- search
- diff-oriented review inside the session

For code review workflows, the viewer should be able to highlight code changes clearly enough to inspect diffs within the session.

The viewer should not try to compete with a full editor in V1.

## Restart And Restore Behavior For V1

On app reopen, `ai-14all` should be able to restore the previous workspace context.

That should include:

- previously open worktree sessions
- terminal tabs per worktree
- shell entry points in the correct working directory
- layout state
- recent files and viewer state
- notes and lightweight session metadata

V1 does not need true live PTY reattachment.

That means the app does not need to reconnect to the exact same in-memory shell process from before the app closed.

Instead, V1 should restore the prior context cleanly enough that the user can continue working without rebuilding their workspace manually.

The restore flow should be user-controlled:

- when the app reopens, ask whether the user wants to restore the previous context
- provide an option to remember that choice as a personal preference
- allow that preference to be changed later in settings

This keeps restart behavior practical for V1 while still matching the user's preferred workflow.

## Command Presets For V1

Command presets should be defined at the repository level.

They represent reusable command definitions that can be launched inside any worktree of that repository.

Examples:

- `Codex`
- `Claude`
- `Dev Server`
- `Tests`
- `Build`

The intended behavior is:

- the repository owns the standard preset definitions
- each worktree session can launch those presets in its own working directory
- new worktrees automatically inherit the same available presets

This avoids duplicated setup and matches how repository workflows usually work in practice.

Worktree sessions can still own local usage state such as:

- which presets are currently open
- which sessions are pinned
- which commands were launched most recently

Ad hoc commands can still exist, but presets should be repo-scoped in V1.

## Agent Support In MVP

For MVP, an "agent" should not be treated as a special protocol or product-specific integration.

Instead:

- an agent is a terminal-backed process running inside a worktree
- the app launches it like any other command
- the app tracks title, cwd, status, output stream, and exit state

Examples:

- `codex`
- `claude`
- `aider`
- `npm run dev`
- `pnpm test`

This keeps the product grounded in a simple and durable abstraction.

If richer agent-specific integrations are useful later, they can be added after the terminal/process model is proven.

## Explicit Non-Goals For MVP

The MVP should not try to do the following:

- replace Cursor, VS Code, or a full IDE
- provide full LSP or code intelligence
- deeply integrate with specific agent APIs
- support collaboration or cloud sync
- manage remote environments
- provide advanced Git tooling beyond lightweight visibility
- restore live PTY processes after app restart
- optimize for Windows before the macOS workflow feels solid

## Why Electron For V1

V1 should use `Electron`, not `Tauri`.

This decision is based on the actual risk profile of the project.

The hardest parts of the product are:

- PTY lifecycle management
- subprocess orchestration
- terminal streaming
- filesystem and Git access

Electron is the safer V1 choice because:

- it has a more direct fit for Node-based local orchestration
- `node-pty` and related process tooling fit naturally into the runtime
- it avoids the extra sidecar and lifecycle complexity that a Tauri + Node architecture would introduce
- it reduces the chance that infrastructure complexity blocks product validation

For this project, the main bottleneck risk is orchestration complexity, not raw UI rendering performance.

## Security And Performance Position

Electron is heavier than Tauri, but that does not make it the wrong choice here.

The V1 tradeoff is:

- accept higher runtime overhead
- in exchange for lower implementation risk in the most critical subsystem

Security and performance should be handled explicitly:

- the renderer should remain unprivileged
- Node integration should stay out of the renderer
- all privileged operations should go through a narrow IPC bridge
- terminal, filesystem, and Git access should live behind well-defined service boundaries
- the frontend should only receive the minimum data it needs

This gives V1 a practical path without committing the entire product to Electron forever.

## Preferred V1 Tech Stack

### Desktop shell

- `Electron`

### Frontend

- `React`
- `TypeScript`
- `Vite`

### Terminal

- `xterm.js`
- `node-pty`

### Code viewer

- `Monaco Editor`

### State management

- `Zustand`

### Validation and contracts

- `zod`

### Persistence

Prefer starting with the simplest option that works.

That means:

- JSON or lightweight local storage is acceptable for the first spike
- SQLite can be introduced once the session model and persistence needs are stable

SQLite is still a likely long-term choice, but it should not slow down the first validation pass.

## UX Direction

The primary workflow should assume the user already has one repository with several active worktrees.

The app should open into a session-oriented experience where the user can:

- see active worktree sessions immediately
- switch between them with minimal friction
- keep terminals and code inspection close together
- avoid bouncing between multiple external windows

The main UX principle for V1:

- optimize for fast session switching over broad project overview

This means:

- the default landing experience should emphasize active sessions
- overview surfaces should stay lightweight
- global dashboards should support navigation, not become the main product experience

## Session Layout Direction

The primary worktree session view should use a horizontal split layout.

The screen should be organized as:

- top area for terminals
- bottom area for code-related inspection

The terminal area should be the more active part of the interface because that is where the user interacts with shells, agents, and long-running commands.

The code-related area should support quick inspection and review of what is happening in the selected worktree.

That lower area can contain:

- file browsing
- read-only code viewing
- diff-oriented review
- lightweight Git context

The recommended V1 shape is:

- a thin session header
- a larger terminal workspace on top
- a structured review workspace on the bottom

### Session Header

The session header should stay compact and always visible.

It should show:

- worktree name
- branch name
- dirty or clean state
- changed files count
- quick actions

This gives orientation without consuming much space.

### Terminal Presentation

Terminals should be organized as tabs with clear labels.

The terminal UI should make it easy to:

- understand what each tab is for at a glance
- switch quickly between tabs
- monitor multiple agent or command sessions without confusion

The tab label should be short and meaningful, such as:

- `Codex`
- `Claude`
- `Dev Server`
- `Tests`

The top terminal workspace should be the primary active area of the screen.

Only one terminal needs to be visible at a time, but switching between tabs should be extremely fast.

Terminal tabs should be able to surface lightweight state such as:

- running or exited state
- unread activity marker
- pinned state

### Terminal Attention Behavior

When a background terminal receives new output, its tab header should visibly highlight that activity.

For V1, the preferred behavior is:

- pulse the tab for a few seconds when new output arrives
- use that pulse to notify the user without forcing focus changes

If the terminal likely requires user attention or action, the highlight should persist until the user checks it.

This should help the user distinguish between:

- normal background activity
- output that may need intervention

Examples of attention-required output include:

- an agent asking for permission to continue
- an agent asking the user to choose between options
- a command waiting for interactive confirmation

In those cases, the terminal should be treated as waiting on the user rather than merely producing background output.

The action-required state should also be visually stronger than normal unread output.

For example:

- normal new output can use a temporary pulse
- action-required output can use a persistent badge, stronger color state, or both

This helps the user distinguish "something changed" from "this session is blocked waiting on me."

The goal is to make active sessions noticeable without making the interface feel noisy or chaotic.

### Bottom Review Workspace

The lower half of the screen should be structured, not reduced to a single tabbed container.

The recommended layout is:

- left rail for `Files` and `Changes`
- center pane for code or diff viewing
- right rail for compact session context

This is preferred over a fully tabbed lower area because it keeps the most useful context visible at the same time.

The left rail should let the user switch between:

- full file tree
- changed files list

The center pane should show:

- read-only file content
- diff-oriented review for changed files

The right rail should stay compact and contain only lightweight context such as:

- branch
- dirty state
- recent commits
- selected process or session metadata

### Session Visibility Goal

The session view should maximize what the user can understand from one screen without feeling cluttered.

The user should be able to get a quick overview of what is happening in the current worktree and branch, including:

- which terminal sessions are active
- which terminal is currently selected
- whether processes are still running or have exited
- what code or diff is currently under inspection
- the small amount of Git context needed for orientation

The layout should favor fast comprehension over dense information packing.

The user should not need constant panel switching just to answer:

- what is running?
- what changed?
- what file or diff am I looking at?
- what branch is this?

## Architecture Direction

The app should be split into four layers.

### 1. Frontend UI

Responsible for:

- navigation
- layout
- terminal views
- code viewer panes
- Git summary panels
- user interactions

### 2. Desktop bridge

Electron-specific shell logic responsible for:

- secure IPC exposure
- window lifecycle
- process boundary management

This layer should stay thin.

### 3. Local orchestration services

Responsible for:

- repository and worktree discovery
- PTY and process session lifecycle
- Git commands
- file reading and file tree listing
- persistence

This layer should contain the durable product logic.

### 4. Shared contracts

Responsible for:

- command schemas
- event schemas
- typed payload definitions

This keeps the UI separate from shell-specific plumbing.

## Core Domain Model

The product should be designed around these high-level entities:

- `Repository`
- `Worktree`
- `WorktreeSession`
- `ProcessSession`
- `FileViewState`

Important principle:

- a worktree owns process sessions
- process sessions include agent-like commands and non-agent commands
- the UI should not require a special model just for agents in V1

## Spike Goals

Before building the fuller product, the project should validate a narrow spike that proves:

- worktrees can be discovered reliably
- multiple PTY sessions can run at once
- terminal input/output stays stable
- switching among several worktree sessions feels fast
- files can be opened and inspected cleanly in the embedded viewer

The spike should answer one question:

**Does the worktree-session workflow feel better than using separate terminal and editor windows?**

## Success Criteria For The Spike

The spike is successful if:

- 3 to 5 worktrees can be viewed and switched smoothly
- each worktree can host multiple running processes
- terminal output remains responsive under normal use
- the code viewer is good enough for inspection
- the app feels meaningfully better than the current fragmented setup

## Open Questions For Further Brainstorming

These should be refined before scaffolding:

- should the embedded viewer be read-only in V1, or allow minimal editing?
- what should persistence cover in the first working version?

## Current Direction

The current direction is:

- local-first
- macOS first
- Electron for V1
- several repo-scoped workspaces, one active at a time
- worktree-session-first UX
- session-first navigation rather than dashboard-first navigation
- terminal/process orchestration as the core value
- embedded code inspection rather than full IDE behavior

That is the working baseline for the next round of planning and refinement.
