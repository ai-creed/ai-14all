# Discard Changes & Push Branch — Design Spec

**Date:** 2026-04-13
**Status:** Approved

---

## Overview

Two features for the git panel:

1. **Discard changes** — right-click any file in the changes list to discard its staged and/or unstaged changes, with a confirmation dialog.
2. **Push branch** — status strip at the top of the commit list showing ahead/behind counts relative to the tracking remote, with a push button and a force-push confirmation dialog when needed.

---

## Feature 1: Discard Changes

### Context Menu

`ChangesList.tsx` currently shows a context menu only for `.md` files (Preview). The context menu is extended so **all files** get one, with two possible items:

- **Preview** (`.md` files only, existing)
- **Discard changes** (all files, new) — styled with `shell-toolbar-menu__item--danger`

### Git Operation

New service method: `discardChange(worktreePath: string, relativePath: string)`

- Tracked files: `git restore --source=HEAD --staged --worktree <path>` — discards both staged and unstaged changes in one command.
- Untracked files (`??` status): delete the file from disk.

Exposed via:
- IPC handler: `git:discardChange`
- Preload API: `git.discardChange(worktreePath, relativePath): Promise<void>`

### Confirmation Dialog

New component: `DiscardChangeDialog.tsx`

Follows the `RemoveWorktreeDialog` pattern:
- Radix `Dialog.Root` with overlay + centered modal
- Title: `"Discard changes"`
- Body: `"Discard changes to <filename>? This cannot be undone."`
- Actions: `"Discard"` (danger-styled) and `"Cancel"`
- Inline error banner if the git op fails
- On success: close dialog + trigger `setRefreshKey(k => k + 1)` to re-fetch git summary and changes list

### Props Change

`ChangesList` gains one new prop:
```ts
onDiscardChange: (relativePath: string) => void
```

App.tsx wires this to open `DiscardChangeDialog` with the selected path.

---

## Feature 2: Push Branch

### Remote Status

New service method: `getRemoteStatus(worktreePath: string)`

Returns:
```ts
type RemoteStatus = {
  hasRemote: boolean;
  ahead: number;   // local commits not on remote  (git rev-list @{u}..HEAD --count)
  behind: number;  // remote commits not local      (git rev-list HEAD..@{u} --count)
};
```

If no tracking remote: `{ hasRemote: false, ahead: 0, behind: 0 }`.

Exposed via:
- IPC handler: `git:getRemoteStatus`
- Preload API: `git.getRemoteStatus(worktreePath): Promise<RemoteStatus>`

Fetched in `App.tsx` alongside `readCommitHistory`, keyed on `[activeWorktree?.id, activeWorktree?.path, refreshKey]`.

### Push Operation

New service method: `pushBranch(worktreePath: string, force: boolean)`

- Normal: `git push`
- Force: `git push --force-with-lease`

Exposed via:
- IPC handler: `git:pushBranch`
- Preload API: `git.pushBranch(worktreePath, force): Promise<void>`

On success: trigger `setRefreshKey(k => k + 1)`.

### Push Status Strip

Rendered at the top of `CommitList`, above commit rows. Visible only when `remoteStatus` is provided.

Layout (flex row):
```
↑3 to push   ↓1 to pull   [Push]
```

- Counts shown in muted text; `↑` / `↓` in primary text.
- Push button disabled when `ahead === 0` or `!hasRemote`.
- When `behind === 0`: clicking Push calls `onPush(false)` directly.
- When `behind > 0`: clicking Push opens `ForcePushDialog`.

New CSS block: `.shell-commit-push-strip`

### Force Push Dialog

New component: `ForcePushDialog.tsx`

- Title: `"Force push?"`
- Body: `"Remote has {behind} commit(s) your branch doesn't have. Push anyway with --force-with-lease?"`
- Actions: `"Force Push"` (danger-styled) and `"Cancel"`
- Inline error banner on failure
- On confirm: calls `onPush(true)` → close + refresh

### Props Change

`CommitList` gains two new props:
```ts
remoteStatus: RemoteStatus | null;
onPush: (force: boolean) => Promise<void>;
```

---

## Refresh Behaviour

Both operations trigger a full refresh via `setRefreshKey(k => k + 1)` on success. This re-fetches:
- `git.readSummary` → updates changes list
- `git.readCommitHistory` → updates commit list
- `git.getRemoteStatus` → updates push strip counts

---

## Error Handling

- Git op failures surface as an inline error banner inside the relevant dialog (not a separate toast).
- Dialog stays open on error so the user can retry or cancel.
- Network/remote errors on push (e.g., no remote access) shown inline in `ForcePushDialog` / push strip area.

---

## Files Touched

| File | Change |
|------|--------|
| `services/git/git-service.ts` | Add `discardChange`, `getRemoteStatus`, `pushBranch` |
| `electron/main/ipc.ts` | Add 3 new IPC handlers |
| `electron/preload/index.ts` | Expose 3 new methods on `git` API |
| `shared/contracts/commands.ts` | Add schemas for new commands |
| `shared/models/git-change.ts` | No change |
| `src/features/git/ChangesList.tsx` | Extend context menu; add `onDiscardChange` prop |
| `src/features/git/CommitList.tsx` | Add push strip; add `remoteStatus` + `onPush` props |
| `src/features/git/DiscardChangeDialog.tsx` | New component |
| `src/features/git/ForcePushDialog.tsx` | New component |
| `src/app/App.tsx` | Wire new props, fetch remote status, handle discard/push |
| `src/app/shell.css` | Add `.shell-commit-push-strip` styles |

---

## Testing

Edge cases to cover:

- Discard tracked file (staged) → file reverts to HEAD
- Discard tracked file (unstaged) → file reverts to HEAD
- Discard untracked file (`??`) → file deleted
- Discard fails (e.g., permission error) → error shown inline, file unchanged
- Push with `ahead > 0`, `behind === 0` → direct push, no dialog
- Push with `ahead > 0`, `behind > 0` → force push dialog appears
- Push with `ahead === 0` → push button disabled
- No tracking remote → push button disabled, counts not shown
- Push fails (network error) → error inline in dialog
- Remote status fetch fails → treat as `hasRemote: false`
