# AGENTS.md

## Product

`oneforall` is an Electron desktop app for managing one local repository through a session-first workflow centered on Git worktrees and embedded terminals.

The product is not trying to become a full IDE. V1 is terminal-first, with embedded read-only code and diff inspection to keep the workflow self-contained.

## Workflow Priorities

The product should optimize for one active worktree session at a time.

Keep these workflow priorities intact:

- the selected worktree session is the main unit of focus
- terminals are the primary interaction surface
- code and Git inspection should stay in the same session workflow
- active branch and worktree context should be hard to miss
- session state should stay simple unless real usage proves otherwise

Do not expand the product scope into:

- multi-worktree comparison
- persistence or restore behavior
- command presets
- terminal attention states
- advanced Git operations
- editable embedded code workflows

## Architecture Rules

Keep these boundaries intact:

- Renderer is unprivileged and must not access Node APIs directly.
- All privileged operations go through preload and typed IPC.
- Electron main stays thin.
- Durable product logic belongs in services, not React components.
- Shared contracts and shared models are the canonical source of truth across renderer and backend.

The frontend should stay session-first:

- model UI state around worktree sessions
- avoid file-first or terminal-first state shapes that bypass the session model
- terminals, Git review, and local note state should belong to the active worktree session

## Product Boundaries

V1 assumptions:

- Electron for the desktop runtime
- one repository first
- interactive terminal sessions as the primary workflow
- embedded viewer is read-only and review-oriented, not a primary editor

Avoid pulling deferred scope into current work unless explicitly requested:

- multi-repository UX
- worktree creation or deletion from the app
- deep agent API integrations
- advanced Git client behavior
- collaboration or sync features
- remote environment support

## Working Rules

- Prefer thin vertical slices over broad infrastructure expansion.
- Follow the existing phase docs before inventing new scope.
- If implementation starts to conflict with the recorded architecture decisions, update the docs deliberately instead of letting the code drift.
- Preserve simple UI and state models until real usage proves more complexity is necessary.

## Documentation Rules

- High-level project planning lives under `docs/shared/`.
- Tracked design specs live under `docs/superpowers/specs/`.
- Local agent execution plans live under `docs/superpowers/plans/` and are intentionally gitignored.
- When adding or changing project direction, update the relevant design or planning doc rather than relying on conversational context only.

## Branch Completion

- After finishing a development branch, merge locally to master and wait for the user to do their own code review before pushing.
- Do not push or create a PR unless specifically asked.

## Verification

- Run targeted tests for the areas you touch before claiming completion.
- Prefer adding or updating tests when behavior changes materially.
- New user-visible behavior for a phase is not done until the e2e suite covers it.
- E2E coverage must accumulate across phases; extend the suite instead of replacing older flow coverage.
- For planning or docs work, keep scope, phase boundaries, and architectural constraints explicit.
