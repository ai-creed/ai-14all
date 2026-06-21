# Base Branch Selection for New Sessions — Design

- **Date:** 2026-06-21
- **Project:** ai-14all (desktop app)
- **Status:** Design approved (decisions captured below); pending implementation plan
- **Author:** Vu Phan (with Claude)

## 1. Background & Goal

Creating a new session in ai-14all always branches the new worktree off the repository's default branch — specifically `origin/HEAD` (e.g. `origin/main` or `origin/master`). Contributors who do their work against a long-lived integration branch (e.g. `devel`) and target their merges there cannot base a new session on it; they get a branch forked from `main` and have to re-point it by hand.

**Goal:** let the user pick the base branch when creating a new session, defaulting to the current behavior (`origin/HEAD`), so a contributor can base a session directly off `origin/devel` — with the smallest cohesive change and no regression to the default path.

## 2. How it works today (verified against the repo, 2026-06-21)

The create-session flow, UI → IPC → service → git:

- **Dialog:** `src/features/workspace/components/NewWorktreeDialog.tsx` collects a **Name** (required) and an optional **Session title**. It shows a **read-only preview** panel (branch name, path, `baseRef`, base commit). There is **no branch input today** — `baseRef` is display-only. Opened from `src/features/workspace/components/SessionSidebar.tsx:481` → `App.tsx` (`setCreateDialogOpen(true)`).
- **Preview path (debounced):** `use-create-worktree-preview.ts` → `desktop-client` `previewCreateWorktree(workspaceId, name)` → `electron/preload/index.ts` (`repository:previewCreateWorktree`) → `electron/main/ipc.ts` handler → `WorktreeService.previewCreateWorktree(repo, name)` (`services/worktrees/worktree-service.ts:158`).
- **Create path:** `src/app/hooks/use-worktree-actions.ts:115` `handleConfirmCreateWorktree` → `desktop-client` `createWorktree(workspaceId, name)` → `electron/preload/index.ts` (`repository:createWorktree`) → `electron/main/ipc.ts` handler → `WorktreeService.createWorktree(repo, name)` (`worktree-service.ts:235`).
- **Base resolution (the crux):** `WorktreeService.resolveDefaultBaseRef` (`worktree-service.ts:213-233`) runs `git symbolic-ref --quiet refs/remotes/origin/HEAD`, strips the `refs/remotes/` prefix → e.g. `origin/main`, and **throws** an actionable error if `origin/HEAD` is unset. No hardcoded `main`/`master`; no fallback. The returned base is a **remote-tracking ref**.
- **Git invocation:** `createWorktree` re-calls `previewCreateWorktree` for a fresh `baseRef`, then runs two commands: `git branch <branchName> <baseRef>` (`worktree-service.ts:247-258`), then `git worktree add <path> <branchName>` (`worktree-service.ts:260-265`). If the local branch already exists, the `git branch` step is skipped. A rollback path removes a partially-created worktree on failure.
- **No branch-listing capability exists.** Only `WorktreeService.localBranchExists` (`worktree-service.ts:43`, single-branch check) and `GitService.resolveMergeTargetRef` (`services/git/git-service.ts:136`, tries `origin/main` then `origin/master` for diff context). No `listBranches()`.
- **Types / contracts:** `CreateWorktreePreview` (`shared/models/worktree-lifecycle.ts:3-9` — `{ name, branchName, path, baseRef, baseCommit }`); `Worktree` (`shared/models/worktree.ts:1-8`); IPC Zod schemas `CreateWorktreeSchema` (`shared/contracts/commands.ts:51`, `{ workspaceId, name }`) and `PreviewCreateWorktreeSchema` (`commands.ts:61`). `baseRef` is a creation-time value, **not persisted** per session.
- **Tests:** `tests/unit/services/worktrees/worktree-service.test.ts` (base-ref resolution + create), `tests/unit/components/NewWorktreeDialog.test.tsx`, `tests/unit/app/use-worktree-actions-create.test.tsx`, `tests/unit/electron/ipc.test.ts`.

## 3. Key Decisions (made 2026-06-21)

- **Branch source = remote (`origin/*`), default `origin/HEAD`.** The picker lists remote-tracking branches; the new branch is always based off a canonical pushed tip, matching today's semantics (`base off devel` = `origin/devel`). Local-only branches are not offered. (Rejected: local-only — changes today's remote semantics and risks stale local refs; local+remote — bigger picker and a "local vs origin devel" ambiguity, deferred.)
- **Freshness = auto-fetch on dialog open, non-blocking.** `git fetch origin` runs when the dialog opens so the list and base tips are current. **If the fetch fails, surface a clear non-blocking error/warning and fall back to the already-fetched (`origin/*`) refs; never block session creation.** (Rejected: no-fetch — risks branching off a stale `origin/devel`; manual-only refresh — weaker default for the contributor case.)
- **Picker style = searchable select**, pre-selected the concrete ref `origin/HEAD` resolves to (e.g. `origin/main`) — see §5.1 for the alias-vs-concrete distinction. Filterable so repos with many remotes stay usable; degrades to a short list for small repos.
- **No "remember last base" persistence.** The default pre-selection is the resolved default (the concrete ref `origin/HEAD` points to) every time (faithful to "default still be master/main"). Per-repo memory of the last-used base is a future enhancement (§9).
- **Robust default resolution.** Replace today's hard throw with a fallback chain (see §5.4) so the dialog still opens usefully when `origin/HEAD` is unset.

## 4. Scope

**In scope:**
- List remote branches + refresh-from-origin capability in the main process, exposed over IPC.
- A "Base branch" searchable select in `NewWorktreeDialog` (default `origin/HEAD`), auto-fetch on open with non-blocking fallback, preview recompute on selection.
- Thread an optional `baseBranch` through the preview + create contracts/handlers/service.
- Robust default-base resolution with fallbacks.
- Unit + component tests.

**Out of scope (unchanged / deferred):**
- Local-branch base option; "local vs origin" grouping (§9).
- Remembering the last-used base per repo/workspace (§9).
- Persisting the base ref on the session record (`baseRef` stays creation-time only).
- Any change to the `git worktree add` step shape or the rollback path.
- Changing behavior for callers that do not pass `baseBranch` (back-compatible default).

## 5. Design

### 5.1 UX — `NewWorktreeDialog`

- Add a **"Base branch"** searchable select below the Name field. Options are the repo's concrete `origin/*` branches (e.g. `origin/main`, `origin/devel`), **excluding the `origin/HEAD` symref pseudo-entry** that `git for-each-ref` lists (it is an alias pointing at the default branch, not a branch of its own). The pre-selected value is the **concrete ref the default resolves to**: `origin/HEAD` is resolved to its target via §5.4 (e.g. `origin/main`), and that concrete ref — which is itself one of the listed options — is the selected value. The literal `origin/HEAD` alias is never a selectable option or the stored selection value.
- On dialog open, trigger a **refresh** (fetch origin) with a small inline "refreshing branches…" indicator. On success, the list and base commit reflect the latest remote. On failure, show an **inline non-blocking warning** ("Couldn't refresh from origin — showing last-fetched branches.") and keep the dialog fully usable with cached refs. Creation is never gated on fetch success.
- The existing read-only preview (branch name, path, `baseRef`, base commit) **recomputes for the selected base** — selecting `origin/devel` updates the preview's `baseRef`/`baseCommit`.

### 5.2 Components / data flow

- **Main process (new):**
  - `listRemoteBranches(repository): Promise<string[]>` — `git for-each-ref --format='%(refname:short)' refs/remotes/origin`, excluding `origin/HEAD`. Returns refs in `origin/<branch>` form.
  - `refreshRemote(repository): Promise<{ ok: boolean; error?: string }>` — `git fetch origin` (optionally `--prune`); resolves `{ ok: false, error }` on failure rather than throwing (so the UI can warn without blocking). Placement: `GitService` (these are general git queries) or `WorktreeService` — decided in the plan; `GitService` is the leaning since it has no worktree-creation coupling.
  - New IPC channels (e.g. `repository:listRemoteBranches`, `repository:refreshRemote`) with Zod request/response schemas, wired through `electron/preload/index.ts` and `electron/main/ipc.ts`, exposed on the desktop client.
- **Thread `baseBranch` through the existing path:** add optional `baseBranch?: string` to `PreviewCreateWorktreeSchema` and `CreateWorktreeSchema` (`shared/contracts/commands.ts`), to the preload invoke payloads, to the IPC handlers, and to `WorktreeService.previewCreateWorktree` / `createWorktree`. The renderer hooks (`use-create-worktree-preview.ts`, `use-worktree-actions.ts`) pass the selected base.

### 5.3 Git

- Fetch on open is the only new git side-effect (non-blocking).
- The create path keeps its shape: `git branch <branchName> <chosenBaseRef>` then `git worktree add <path> <branchName>`. `<chosenBaseRef>` is a full `origin/<branch>` ref (same form as today's `origin/main`), so branch-tracking behavior is unchanged.
- Omitting `baseBranch` (old callers / back-compat) yields exactly today's behavior **when `origin/HEAD` is set** (the common case): the base resolves to the same concrete ref as today (e.g. `origin/main`). The **only** intentional departure from today is when `origin/HEAD` is unset — today's hard error becomes the §5.4 fallback chain.

### 5.4 Default base resolution (replaces the hard throw)

`resolveDefaultBaseRef` (and the new selection-aware path) resolves, in order:

1. If the caller passed an explicit `baseBranch`, use it (validated against the known `origin/*` set; clear error if it has vanished — see §6).
2. Else `git symbolic-ref --quiet refs/remotes/origin/HEAD` (today's behavior).
3. Else, if present, `origin/main`, then `origin/master`.
4. Else the first `origin/*` branch (deterministic order).
5. Else (no origin branches at all) fall back to branching off the current local `HEAD`, with a note in the preview; if even that is unavailable, surface the existing actionable error.

This is strictly more robust than today and preserves the `origin/HEAD` default when set.

## 6. Error handling / edge cases

- **Fetch failure:** non-blocking inline warning; list + base fall back to cached `origin/*`; creation stays enabled (per §3).
- **`origin/HEAD` unset:** no longer a hard failure — §5.4 fallback chain.
- **Repo with no `origin` / no remote branches:** picker is empty; fall back to current local `HEAD` with a note. (Rare for this app; today such a repo already errors.)
- **Chosen base disappears between open and create** (e.g. deleted upstream after a refresh): re-validate at create time, surface a clear error, and rely on the existing rollback so no partial worktree is left.
- **Many branches:** searchable select keeps the list navigable.

## 7. Acceptance Criteria

- The new-session dialog shows a "Base branch" searchable select defaulting to the **concrete ref `origin/HEAD` resolves to** (e.g. `origin/main`), not the literal `origin/HEAD` alias; selecting `origin/devel` makes the new session branch off `origin/devel` (verified: `git branch <name> origin/devel` is the command issued).
- Opening the dialog triggers a fetch; on fetch failure a non-blocking warning appears and creation still succeeds off cached refs.
- **When `origin/HEAD` is set:** omitting a base selection (or an old caller not supplying `baseBranch`) reproduces today's behavior exactly — base = the resolved `origin/HEAD` (e.g. `origin/main`). **When `origin/HEAD` is unset:** the §5.4 fallback chain applies instead of today's hard error; this is the one intentional departure from today's behavior (covered by unit tests).
- `resolveDefaultBaseRef` returns the concrete ref `origin/HEAD` resolves to (e.g. `origin/main`) when set, and walks the §5.4 fallback chain otherwise (covered by unit tests).
- The preview's `baseRef`/`baseCommit` reflect the selected base.
- Full suite green: `pnpm lint && pnpm format && pnpm typecheck && pnpm test`.

## 8. Task Breakdown (phased)

1. **Branch listing + refresh (main process + IPC).** `listRemoteBranches` + `refreshRemote` in the service layer; IPC channels + Zod schemas + preload + desktop client. Unit tests for parsing + fetch-failure shape.
2. **Base-aware resolution + threading `baseBranch`.** Extend `previewCreateWorktree`/`createWorktree` and the contracts/handlers/preload with optional `baseBranch`; implement the §5.4 fallback chain. Unit tests: default + each fallback; `baseBranch` reaches `git branch`; back-compat when omitted.
3. **Dialog UI.** "Base branch" searchable select (default `origin/HEAD`), auto-fetch on open with non-blocking warning, preview recompute on selection. Component tests: picker renders + default selected; fetch-fail warning + create still enabled; preview updates on selection.
4. **Integration verification.** End-to-end create-with-selected-base path green; default path unchanged; full suite green.

## 9. Future (not now)

- Remember the last-used base branch per repo/workspace.
- Offer local branches (and/or local+remote grouped) as base options.
- Persist the base ref on the session record for display/history.
