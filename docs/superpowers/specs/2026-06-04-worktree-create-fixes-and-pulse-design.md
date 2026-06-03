# Worktree creation: base-ref fix, title fix, and creating-pulse

Date: 2026-06-04
Status: Approved — implementing

## Problem

Creating a new session/worktree has three issues:

1. **Hardcoded base ref.** `previewCreateWorktree` resolves the base from a
   literal `origin/master` (`services/worktrees/worktree-service.ts`). Repos
   whose default branch is not `master`, or that lack `origin/master`, fail to
   create with "Could not resolve origin/master".
2. **Session title dropped.** `handleConfirmCreateWorktree`
   (`src/app/hooks/use-worktree-actions.ts`) dispatches `session/setTitle`
   *before* `refreshWorktreeInventory` runs the `workspace/reconcileWorktrees`
   reducer that actually creates the session. `updateSession` no-ops when the
   session does not yet exist (`workspace-state.ts:433`), so the typed title is
   silently lost.
3. **No progress feedback.** Creation can take seconds (multiple git calls).
   The dialog only disables its buttons via `busy`; the user sees a frozen
   dialog and assumes the app hung.

## Decisions

- Base ref: auto-detect the repo default branch via
  `git symbolic-ref --quiet refs/remotes/origin/HEAD`. If it cannot be
  resolved, fail with a clear, actionable error (do not guess).
- Title: fix ordering — set the title after the session exists.
- Pulse: in-dialog. The primary button becomes a pulsing "Creating session…"
  with an animated dot while busy; both buttons stay disabled; dialog stays
  open. Mirrors existing `shell.css` pulse rhythm and respects
  `prefers-reduced-motion`.

## Design

### Concern A — base ref auto-detect
`services/worktrees/worktree-service.ts`
- Add `resolveDefaultBaseRef(repository)`: run
  `git symbolic-ref --quiet refs/remotes/origin/HEAD`, strip the
  `refs/remotes/` prefix to yield `origin/<branch>`. On non-zero exit or empty
  output throw:
  `Could not resolve a base branch — origin/HEAD is not set. Run: git remote set-head origin -a`
- `previewCreateWorktree` uses the resolved ref for both `baseRef` and the
  `git log` base-commit lookup.
- `createWorktree` already branches off `preview.baseRef`; no change.
- Test helper `makeTestRepo` also sets `refs/remotes/origin/HEAD`; existing
  `baseRef === "origin/master"` assertions still hold. New tests: non-master
  default resolves; unset origin/HEAD throws the clear error.

### Concern B — title not dropped
`src/app/hooks/use-worktree-actions.ts`
- Move the `session/setTitle` dispatch to after
  `await refreshWorktreeInventory({ preferredSelectedWorktreeId: created.id })`.

### Concern C — in-dialog creating pulse
`src/features/workspace/components/NewWorktreeDialog.tsx`, `src/app/shell.css`
- When `busy`: primary button shows `<span class="shell-button__pulse-dot"/>
  Creating session…`, disabled; Cancel disabled.
- `shell.css`: `@keyframes shell-button-pulse` + `.shell-button__pulse-dot`,
  with a `prefers-reduced-motion` guard.

## Edge cases / tests
- origin/HEAD unset → clear error (Concern A).
- Default branch != master resolves correctly (Concern A).
- Empty/whitespace title → no dispatch (unchanged).
- busy → "Creating session…" + pulse-dot, both buttons disabled; not busy →
  "Create worktree" (Concern C).
- reduced-motion → no animation.
- Create failure → busy clears, error shown, no pulse (existing `finally`).

## Scope
4 files, 3 independent commits (A, B, C). TDD for each.
