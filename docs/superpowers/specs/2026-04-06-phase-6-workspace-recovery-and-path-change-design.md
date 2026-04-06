# Phase 6 Hardening — Workspace Recovery And Path Change Design

## Purpose

This spec defines the first focused hardening slice under Phase 6 personal MVP hardening.

The goal is to make workspace restore dependable when the underlying repository path changes but the logical repository is still the same workspace.

This spec is intentionally narrow. It addresses restore recovery for moved or renamed repositories and partially missing worktrees. It does not broaden the product into multi-repository management, migration tooling, or external editor integration.

## Problem

The current restore model treats the saved repository path as the primary identity of a workspace snapshot.

That is too fragile for real use. If the repository directory is renamed or moved:

- startup restore fails even though the same Git repository still exists
- the app falls back to clean startup behavior
- saved session context appears lost until the user manually reconstructs it
- path changes are treated like workspace deletion rather than workspace relocation

This failure mode is especially visible during early product iteration, where repository names and directory structures still change.

## Goals

This hardening slice should:

- preserve saved workspace context when the same repository is reopened at a new path
- stop treating repository path as the durable identity of a workspace
- restore automatically and silently when the user reopens the same repo manually
- preserve unresolved snapshots instead of clearing useful recovery data on path failure
- keep partially unavailable worktree sessions from being dropped immediately
- explain recovery locally with lightweight banners rather than blocking prompts

## Non-Goals

This spec should not include:

- external editor integration
- full migration tooling for old snapshots
- cross-machine or cross-clone repository identity
- multi-repository recovery flows
- background filesystem scans to locate moved repositories automatically
- advanced Git operations
- broader shell or UI polish unrelated to recovery

## Product Direction

The session-first model remains unchanged:

- one repository first
- one active worktree session at a time
- terminals remain primary
- restore should return the user to a familiar session workflow, not to a separate recovery product

Recovery should feel like practical continuity, not like data import.

## Recommended Approach

The recommended approach is:

1. create a stable app-owned repository identity on first successful load
2. persist that identity in the workspace snapshot
3. keep unresolved snapshots intact when restore fails because a saved path is stale
4. silently reattach saved state when the user later opens a repository with the same identity
5. rewrite the snapshot to the new path after successful recovery

This is preferable to path-based identity because path is location, not identity.

It is preferable to a dedicated recovery mode because the existing startup and repository-open flows are already sufficient if the app preserves the right restore data.

## Repository Identity

### Stable Repo ID

The app should define a persistent local repository identifier stored in Git local config:

- key: `ai14all.repoId`

Behavior:

- when a repository is loaded successfully, the app reads `ai14all.repoId`
- if missing, the app generates a UUID and writes it silently into local Git config
- that value becomes the primary durable identifier for workspace persistence and recovery

This ID is local-only:

- it is not committed
- it is not intended to identify the same remote repository across different clones
- it exists only to identify the same local workspace across path changes

### Why Local Git Config

Local Git config is the right storage location for V1 because:

- it survives repository folder renames and moves
- it stays associated with the shared Git metadata used by worktrees
- it avoids writing app metadata into tracked project files
- it does not require a separate app-owned sidecar file inside the repository

## Snapshot Model Changes

The persisted workspace snapshot should gain a repo identity field in addition to the current repository path.

Recommended shape:

- `repoId: string | null`
- keep `repositoryPath: string`

Rules:

- new snapshots should always persist `repoId`
- older snapshots without `repoId` remain readable
- `repositoryPath` remains the latest known location, not the durable identity

`selectedWorktreeId` and saved worktree session identifiers remain path-based for now, because worktrees are still represented by filesystem paths in the current model.

## Restore Behavior

### Normal Startup Restore

If the saved `repositoryPath` still opens successfully:

- load the repository normally
- read worktrees
- restore the selected session
- preserve current Phase 5 and Phase 6 behavior

### Stale Path Restore Failure

If startup restore fails because the saved repository path no longer exists or cannot be opened:

- do not clear the saved snapshot
- do not replace it with a special recovery-state snapshot
- keep the unresolved snapshot intact in persistence
- fall back to the normal repository picker
- show a local recovery message explaining that the previous workspace could not be reopened from its saved path

This preserves the best available recovery data and keeps state handling simple.

## Manual Reopen Reattachment

When the user manually opens a repository from the repository picker or workspace-open flow:

1. load the repo normally
2. read or create its `repoId`
3. compare that `repoId` to the unresolved saved snapshot
4. if the IDs match, silently reattach the saved workspace state
5. rewrite the saved snapshot with the new `repositoryPath`
6. show a small non-blocking banner explaining that the previous workspace was recovered after a path change

The app should not ask for confirmation in this case. Matching repo identity is sufficient for automatic recovery in V1.

## Older Snapshot Fallback

Older snapshots may not include `repoId`.

For those snapshots, the fallback should stay intentionally simple:

- preserve the unresolved snapshot if startup restore fails
- when the user manually opens a repository, the app may attempt a lightweight fallback match using the saved repository directory name against the reopened repository directory name
- if that fallback does not clearly match, do nothing special and continue with normal load

This fallback exists only to avoid making older snapshots unrecoverable after the repo ID feature lands.

This spec deliberately does not add broader heuristics such as remote comparison, branch graph comparison, or filesystem scanning.

## Missing Worktrees

The repository may reopen successfully while some saved worktrees no longer exist.

Behavior:

- restore the repository and any sessions that still map to existing worktrees
- keep unavailable saved worktree sessions preserved in persistence rather than dropping them immediately
- show a local warning banner that some saved worktrees were unavailable
- keep the active workspace usable without blocking restore of the valid sessions

This preserves the user’s saved context even when only part of the old workspace can be reattached immediately.

## Banner And Messaging Behavior

This hardening slice should use lightweight local banners rather than modal recovery UX.

Recommended banner cases:

- startup restore failed because the saved repository path is unavailable
- a previous workspace was successfully recovered after the repo was reopened at a new path
- one or more saved worktrees were unavailable during restore
- repo identity could not be written, so future path-change recovery may be limited

These banners should be:

- visible but non-blocking
- dismissible
- phrased in practical language rather than error-heavy language

## Failure Handling

### Repo ID Read Failure

If the app cannot read repo identity from local Git config:

- repository load should still continue if the repository itself is otherwise valid
- recovery falls back to path-based behavior for that session
- show a lightweight warning banner

### Repo ID Write Failure

If the app cannot write `ai14all.repoId` on first load:

- repository load should still succeed
- persistence should store `repoId: null` for that snapshot if no ID is available
- automatic path-change recovery is limited until the ID can be written later

### Malformed Snapshot

If the persisted snapshot is malformed:

- preserve the current fail-safe behavior
- ignore the invalid snapshot
- continue with clean startup

This spec should not weaken existing schema-safety behavior.

## Service Responsibilities

### Git Service

The Git service should add repository identity operations:

- read local repo config value for `ai14all.repoId`
- write a generated value when missing
- expose a small typed result back to the app layer

These operations should stay in the privileged service layer, not the renderer.

### Workspace Persistence Layer

The persistence layer remains responsible for:

- reading and writing the snapshot schema
- preserving unresolved snapshots
- storing the latest known repository path after successful reattachment

It should not perform matching logic by itself.

### App Orchestration

The renderer-orchestration layer should own:

- deciding whether a saved snapshot is unresolved
- matching reopened repositories to unresolved snapshots
- triggering silent reattachment
- deciding which banners to show

This keeps durable storage, Git interrogation, and workflow orchestration separate.

## Testing

This hardening slice should add:

### Unit Coverage

- repo ID read when present
- repo ID generation and write when missing
- snapshot parsing with and without `repoId`
- matching reopened repo identity to unresolved snapshot identity
- preserving unresolved snapshot data after stale-path restore failure

### Component/App Coverage

- startup restore failure keeps the snapshot instead of clearing it
- manually reopening the same repo silently reattaches saved state
- recovery banner appears after silent reattachment
- missing saved worktrees remain preserved and generate a warning

### End-To-End Coverage

Extend the cumulative e2e suite with a flow like:

1. load a repository
2. create session context worth restoring
3. close the app
4. rename or move the repository directory
5. relaunch the app and observe restore failure without snapshot loss
6. reopen the moved repository manually
7. verify automatic workspace recovery and recovery banner

This coverage should accumulate on top of the existing restore suite rather than replacing it.

## Acceptance Criteria

This hardening slice is complete when:

- repo load silently creates and persists `ai14all.repoId` when missing
- snapshots persist both `repoId` and latest known `repositoryPath`
- stale saved repository paths no longer cause immediate snapshot loss
- reopening the same repo at a new path automatically restores the previous workspace state
- successful recovery rewrites the snapshot to the new path
- missing worktrees are preserved and reported locally rather than dropped
- cumulative automated coverage includes the renamed-or-moved-repository recovery flow
