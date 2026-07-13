# AGENTS.md

## Product

`ai-14all` is an Electron desktop app for managing several local repository-scoped workspaces through a session-first workflow centered on Git worktrees and embedded terminals.

The product is not trying to become a full IDE. V1 is terminal-first, with embedded read-only code and diff inspection to keep the workflow self-contained.

## Workflow Priorities

The product should optimize for one active worktree session at a time within the selected workspace.

Keep these workflow priorities intact:

- the selected worktree session is the main unit of focus
- terminals are the primary interaction surface
- code and Git inspection should stay in the same session workflow
- active branch and worktree context should be hard to miss
- session state should stay simple unless real usage proves otherwise
- agent handoff during review may flow through generic agent-pull surfaces (e.g. local MCP tools the agent calls); the app does not push to vendor APIs

Do not expand the product scope into:

- multi-worktree comparison
- advanced Git operations beyond lightweight review
- editable embedded code workflows

## Architecture Rules

Keep these boundaries intact:

- Renderer is unprivileged and must not access Node APIs directly.
- All privileged operations go through preload and typed IPC.
- Electron main stays thin.
- Durable product logic belongs in services, not React components.
- Shared contracts and shared models are the canonical source of truth across renderer and backend.
- **XBP protocol contract:** `docs/shared/XBP-PROTOCOL.md` (secret, gitignored — synced mirror; owner is ai-xavier). Read it before touching bridge/pairing/acting/capability/audit code. Do not edit the mirror.

The frontend should stay session-first:

- model UI state around worktree sessions
- avoid file-first or terminal-first state shapes that bypass the session model
- terminals, Git review, and local note state should belong to the active worktree session

## Frontend Structure And Naming

Feature code should be organized by feature domain first, then by file role.

Within a feature folder, prefer this shape as the feature grows:

- `components/` for React components
- `hooks/` for React hooks
- `logic/` for app-specific pure logic, reducers, selectors, state builders, and workflow helpers
- `types/` only when feature-local types become large enough to justify separation

Keep filenames visually scannable by role:

- React component files use `PascalCase.tsx` and live under `components/`.
- React hook files use `kebab-case.ts` and live under `hooks/`, even when the exported hook is camelCase.
- Non-component logic files use `kebab-case.ts` and live under `logic/` or an established non-component folder.
- Shared contracts, shared models, services, Electron main/preload files, and utility modules use `kebab-case.ts`.
- Test filenames should match the source filename plus `.test`, and tests should live in a folder that mirrors the source domain when practical.

Avoid mixing component files and non-component modules in the same feature folder once there is more than one role present. A small feature may start flat, but when adding the second role, split it into role folders as part of the same change.

Do not put renderer implementation types into `shared/`. The `shared/` layer must not import from `src/`; move renderer-only state and view models into the relevant feature folder.

### Privileged IPC Trust Boundary

- IPC handlers in `electron/main/ipc.ts` MUST accept identifiers (`workspaceId`, `worktreeId`) and resolve filesystem paths server-side via `WorkspaceRegistryService.get` + `WorktreeService.findWorktree`.
- Raw filesystem paths from the renderer are forbidden in `ipc.ts`. Exception: MCP agent-pull tool surfaces in `services/mcp/` and the `WorktreePathResolver`, where the path is part of the tool's external contract.
- Both resolvers throw on unknown ids — do not add `if (!x)` checks; thrown errors propagate as rejected promises to the renderer.

### Diagnostics Logging

- `ShellEventLogService` runs in one of three modes: `off` (production / packaged builds by default), `sampled` (dev / beta builds — logs 1 of every 50 `terminal-output` events plus the first event of each burst), `full` (every event, expensive under load).
- Override via `AI14ALL_DEBUG=1` (sampled) or `AI14ALL_DEBUG=full` (verbose). Tests requiring complete event logs should construct the service with `mode: "full"` explicitly.
- Sampled mode drops events; do not use diagnostic logs as authoritative state.

### Test File Layout

- New feature-owned tests live under `tests/unit/<domain>/` or `tests/unit/features/<domain>/`, where `<domain>` is the feature folder name (`review`, `workspace`, `terminals`, `viewer`, `git`, `files`, `editor`, `app`).
- Do not add new test files to `tests/unit/components/`. That folder is a legacy catch-all and will be drained opportunistically when its tests' source code is touched.
- Test file names mirror their source: `SessionSidebar.tsx` → `tests/unit/workspace/SessionSidebar.test.tsx`, `use-theme.ts` → `tests/unit/lib/use-theme.test.ts`.
- For pure-logic modules, place the test next to its source domain.

## Product Boundaries

V1 assumptions:

- Electron for the desktop runtime
- multiple repository-scoped workspaces with fast switching
- interactive terminal sessions as the primary workflow
- embedded viewer is read-only and review-oriented, not a primary editor
- workspace and session persistence across restarts
- basic worktree removal from the app

Avoid pulling deferred scope into current work unless explicitly requested:

- vendor-specific or push-direction agent API integrations (generic agent-pull surfaces such as local MCP tools are in scope when they support the review workflow)
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
- Non-superpowers design specs live under `docs/design-specs`.
- Local agent execution plans live under `docs/superpowers/plans/` and are intentionally gitignored.
- When adding or changing project direction, update the relevant design or planning doc rather than relying on conversational context only.

## Bundled Agent Skills

- `assets/agent-skills/` is the owning source of truth for the
  `ai-14all-fix-review` and `ai-14all-session-status` skills. The content
  originated bit-for-bit from `ai-skills @ 91890bb` (M5d calibration).
- Any content change inside a bundled skill directory (SKILL.md or evals)
  MUST bump the `version` field in that skill's SKILL.md frontmatter —
  version-guarded installers silently skip unbumped content. CI enforces
  this (`scripts/ci/skills-qa.mjs`, `skills-qa.yml`).
- Calibration workflow: edit the skill here → `pnpm exec shakespii lint
  <dir>` and `pnpm exec shakespii test <dir>` → bump `version` → PR. Live
  trigger/grading sweeps (`shakespii test --run`) are manual campaigns,
  never CI.
- Evals (`evals/`) are dev/CI assets: the installer never writes them to
  provider directories, and the packaged app excludes them.
- Installed live copies (e.g. `~/.claude/skills/...`) are never hand-edited.

## Branch Completion

- After finishing a development branch, merge locally to master and wait for the user to do their own code review before pushing.
- Do not push or create a PR unless specifically asked.

## Verification

- Run targeted tests for the areas you touch before claiming completion.
- Prefer adding or updating tests when behavior changes materially.
- New user-visible behavior for a phase is not done until the e2e suite covers it.
- E2E coverage must accumulate across phases; extend the suite instead of replacing older flow coverage.
- For planning or docs work, keep scope, phase boundaries, and architectural constraints explicit.
