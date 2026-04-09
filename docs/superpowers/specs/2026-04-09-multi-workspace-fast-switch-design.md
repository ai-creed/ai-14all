# Multi-Workspace Fast-Switch Design

## Purpose

This spec explores how `ai-14all` could expand from one repository-scoped workspace to several repository-scoped workspaces without abandoning the product's session-first model.

The intended use case is that the user may need to work across two or three repositories during the same app session and wants to switch between them quickly from one shell, while still keeping only one active session in view at a time.

## Goals

This design should achieve five things together:

- let the app register and reopen several repository-scoped workspaces
- let the user switch between those workspaces quickly from the sidebar
- keep only one workspace visible and active in the main shell at a time
- allow terminal sessions in inactive workspaces to continue running in the background during the current app session
- preserve the existing worktree-session-first workflow inside each repository workspace

The intended outcome is not a multi-repo dashboard. It is a thin top-level workspace switcher wrapped around the existing repo-scoped shell.

## Non-Goals

This design should not introduce:

- simultaneous multi-workspace editing or review surfaces in one window
- side-by-side repository comparison
- a global terminal dashboard across all repositories
- advanced cross-repository Git operations
- background PTY resurrection across full app restarts
- collaboration, sync, or remote environment support

The app should still feel like one focused session shell, not an IDE workspace manager.

## Product Direction

The current product model remains the center of gravity:

- one active worktree session at a time
- terminals remain the primary interaction surface
- code and Git review stay attached to the selected worktree session
- worktree sessions remain repo-scoped

The proposed change is one level above that model:

- add several repository-scoped workspaces
- make one of them active at a time
- preserve the existing shell structure inside the active workspace

This keeps the existing session-first shape intact instead of replacing it with a repository-first admin screen.

## Approaches Considered

### Approach 1: Hard switch with full unload and reload

This approach would keep the app fundamentally single-repo and simply unload the current repository shell before loading another one.

Pros:

- small UI change
- small renderer-state change

Cons:

- background terminal continuity becomes impossible or misleading
- switching discards active runtime context unless additional persistence is added
- does not satisfy the requirement that work continue in the background

This approach is not suitable for the target use case.

### Approach 2: Top-level workspace switcher over repo-scoped shells

This approach introduces a top-level workspace registry while keeping each repository shell internally session-first and repo-scoped.

Pros:

- matches the desired UX closely
- preserves one visible active workspace at a time
- allows inactive workspaces to keep running live terminals in the background during the current app session
- minimizes disruption to the existing worktree session model

Cons:

- requires removing single-repo assumptions from main-process orchestration
- adds a second level of state and persistence

This is the recommended approach.

### Approach 3: Fully concurrent multi-workspace renderer model

This approach would load all repository workspaces into the renderer at once and treat them as equal first-class shells in one large app state tree.

Pros:

- enables richer future cross-workspace surfaces

Cons:

- much larger state rewrite
- stronger pressure toward dashboard or IDE-like behavior
- greater UI complexity than the use case requires

This approach is intentionally deferred.

## Recommended Approach

The recommended direction is a top-level workspace switcher that wraps the existing repository-scoped shell.

This means:

- the app maintains a list of saved repository workspaces
- the sidebar exposes a fast-switch list of those workspaces
- selecting a workspace swaps the visible shell to that repository
- inside the active workspace, the existing worktree-session shell remains the same
- inactive workspaces are not fully rendered, but their runtime terminal sessions continue to run in the background during the current app session

This approach gives the user one place to move between projects while keeping the product intentionally focused.

## UX Shape

The UI should add a workspace layer above the current worktree sidebar, not replace the worktree sidebar with a flatter mixed list.

Recommended shell shape:

```text
+----------------------------------------------------------------+
| Workspace List |        Active Workspace Shell                 |
|                | +-------------------------------------------+ |
| repo A         | | Current worktree sidebar                  | |
| repo B         | | Session header                            | |
| repo C         | | Terminal area                             | |
|                | | Review area                               | |
|                | | Context panel                             | |
+----------------------------------------------------------------+
```

The workspace list should stay intentionally lightweight.

Minimum workspace-list contents:

- repository name
- selection state

Explicitly deferred from the workspace list:

- detailed health dashboards
- cross-workspace file or diff previews
- per-workspace process inspectors

The user asked for fast switching, not broad at-a-glance monitoring. The product should stay honest to that.

## State Model

The new top-level unit should be `WorkspaceShell`.

Each `WorkspaceShell` should own:

- `workspaceId`
- `repository`
- discovered `worktrees`
- repo-scoped `workspaceState`
- restore, loading, and local error metadata

Top-level app state should then become:

- `activeWorkspaceId`
- `workspaceOrder`
- `workspacesById`

The current repo-scoped `WorkspaceState` should remain mostly intact inside each workspace shell.

This is an important boundary. The existing `WorkspaceState` already models one repository shell well:

- selected worktree
- worktree sessions
- process sessions
- command presets
- review state

That inner model should not be generalized prematurely across repositories. Instead, the app should wrap it in a new workspace layer.

One important detail should stay explicit:

- `WorkspaceState.processSessionsById` remains a flat map inside one repo-scoped workspace state
- it does not need to become per-worktree
- it also does not need to become app-global if `WorkspaceState` stays nested under `WorkspaceShell`

The current process IDs are UUID-based and should remain sufficient as process-session keys. The important boundary is that the flat process map stays workspace-local.

## Renderer Hydration Model

The renderer should not eagerly hydrate every saved workspace into a full live shell on startup.

Recommended behavior:

- the previously active workspace hydrates fully at startup
- any workspace opened during the current app run stays hydrated in memory even after becoming inactive
- saved workspaces that have not yet been opened in the current run stay as lightweight dormant entries

A dormant workspace entry should contain enough data for the workspace list and later activation:

- `workspaceId`
- repository identity and path
- persisted repo-scoped snapshot
- availability or load-error metadata

This gives the renderer a mixed model:

- active workspace: fully hydrated
- previously opened inactive workspace: still hydrated, so background terminal output can continue updating state
- never-opened restored workspace: snapshot-only until first activation

That distinction is necessary because background terminal continuity only applies to workspaces that already have live runtime state in the current app session.

## Service And IPC Implications

The largest structural change is in the privileged layer.

Today the main process keeps one `currentRepository`. That must be replaced by a workspace registry.

Recommended backend model:

- workspace registry keyed by `workspaceId`
- each registry entry owns the active repository identity and discovered worktrees for that workspace
- repository-oriented operations become explicitly workspace-scoped

Workspace opening should become explicit rather than overloading the old single-repo contract implicitly.

Recommended contract:

- add `workspace:openRepository(path)`
- it returns a `workspaceId` plus repository metadata
- if the same repository is already registered, the call is idempotent and reuses the existing `workspaceId` instead of creating a duplicate workspace
- matching should prefer `repoId` when available and fall back to canonicalized root path when needed

Examples for existing repository-scoped operations:

- `workspace:openRepository(path)`
- `repository:listWorktrees(workspaceId)`
- `repository:previewCreateWorktree(workspaceId, name)`
- `repository:createWorktree(workspaceId, name)`
- `repository:previewRemoveWorktree(workspaceId, worktreeId)`
- `repository:removeWorktree(workspaceId, worktreeId)`

File and Git read operations can remain path-based for now because they already operate on explicit worktree paths rather than a singleton current repository.

The terminal service can keep its global PTY session map, but runtime metadata should carry both:

- `workspaceId`
- `worktreeId`

This should be explicit in the shared model rather than hidden in a side registry. `TerminalSession` should grow a `workspaceId` field, and terminal creation IPC should become `terminals:create(workspaceId, worktreeId, cwd)`.

That keeps the singleton `TerminalService` simple:

- one global PTY map keyed by terminal session id
- terminal metadata itself is sufficient to route events back to the owning workspace and worktree

It also avoids hidden side-map drift between terminal lifecycle and renderer state.

Worktree identifiers also need one explicit statement here. The current `Worktree.id` values are absolute filesystem paths returned by `git worktree list --porcelain`. Those should continue to be treated as globally unique enough across repositories during one app session.

The more important risk is not cross-repository collision. It is path staleness after repository moves or renames, which the app already partially handles during restore by rebasing saved paths.

## Background Runtime Behavior

The user requirement is that inactive workspaces must keep working in the background during the current app session.

That means workspace switching must not:

- stop PTYs
- clear process-session runtime records
- unload backend terminal ownership

Instead, switching should only:

- change which workspace shell is rendered in the foreground
- change which worktree session is currently interactive
- continue routing background terminal output into the owning inactive workspace state

This keeps the app aligned with long-running agent or script workflows across multiple repositories.

## Persistence And Restore

The current persisted model stores one repository-scoped snapshot. That is no longer sufficient.

The new persisted top-level shape should include:

- `activeWorkspaceId`
- `workspaceOrder`
- `workspaces`
- restore preference

Each persisted workspace should include:

- `workspaceId`
- repository path
- repoId
- repo-scoped snapshot
- optional lightweight metadata such as last-opened timestamp if needed

The existing repo-scoped `WorkspaceSnapshot` can remain mostly unchanged as the nested per-workspace snapshot.

This is preferable to flattening every session from every repository into one global snapshot because it preserves the current mental model and reduces migration risk.

The persistence file should remain one JSON file at the current location:

- `workspace-state.json`

Keeping one file is preferable for this phase because:

- it preserves the current persistence service shape
- it keeps restore and migration atomic
- it avoids adding a per-workspace file-coordination problem before there is evidence that file size is becoming a real issue

## Restore Boundary

The product boundary from Phase 5 still matters:

- switching workspaces during one running app session keeps live terminals alive
- full app restart still does not provide true PTY resurrection

For startup restore, the safest V1-compatible behavior is:

- restore the previously active workspace into the foreground
- restore its selected worktree session as today
- keep other saved workspaces registered but dormant until opened

Dormant here means:

- their repository entry exists in the workspace list
- their repo-scoped snapshot is available for later hydration
- their process tabs are descriptors only until the user opens that workspace

This keeps startup lighter and avoids overpromising continuity that the PTY model cannot provide across restarts.

The dormant-to-active transition should be explicit:

1. the user selects a dormant workspace from the sidebar
2. the renderer asks the backend to activate or reopen that workspace by `workspaceId`
3. the backend validates that the repository path still exists and refreshes worktree discovery
4. the renderer hydrates the saved repo-scoped `WorkspaceState`
5. persisted process descriptors for that workspace are recreated as fresh shells

If the repository path no longer exists, the workspace should remain listed but enter a local unavailable state until the user repoints or removes it.

Once a workspace has been hydrated in the current app session, switching away from it should not demote it back to dormant. It remains a live inactive workspace.

## Workspace Removal

The app should also support unregistering a saved workspace from the fast-switch list.

This flow should stay narrow:

- remove the workspace from the saved workspace registry
- clear its persisted repo-scoped snapshot
- if the workspace is currently active, move selection to another saved workspace or to the empty-state shell
- if the workspace still has live terminal sessions, require explicit confirmation before unregistering and terminate those app-owned sessions as part of removal

This is not repository deletion. It is app-level workspace removal.

## Migration Strategy

This work should be staged so the current app continues to function while the model expands.

Recommended sequence:

1. introduce top-level `WorkspaceShell` types and app state
2. replace main-process `currentRepository` with a workspace registry
3. scope repository IPC commands by `workspaceId`
4. nest the current repo-scoped renderer shell under an active workspace
5. add sidebar workspace switching
6. expand persistence from one workspace snapshot to many
7. add version-aware migration logic from the existing single-snapshot file shape

The key principle is to preserve the existing repo-scoped shell as a reusable inner unit rather than rewriting its internals too early.

## Data Migration

The current persisted schema is versioned and stores one snapshot.

A new schema version should:

- preserve restore preference
- convert the old single snapshot into a one-entry `workspaces` collection
- assign a stable `workspaceId`
- set `activeWorkspaceId` to that entry

The persistence service therefore needs a version router during reads:

- parse raw JSON first
- inspect `version`
- migrate older versions forward in memory
- validate only after migration against the latest schema

The current restore service does not yet do this. That change should be part of the persistence migration work rather than treated as an implementation detail.

If migration cannot be performed safely, the app should fail soft by keeping no restored workspaces rather than corrupting state.

## Testing

This feature should not be considered done without tests that prove runtime continuity and persistence boundaries.

Minimum unit coverage:

- top-level workspace registry reducer behavior
- workspace selection behavior
- persistence schema migration from single-workspace to multi-workspace state
- repository IPC scoping by `workspaceId`

Minimum e2e coverage:

- register two repositories and switch between them
- start terminal work in repository A, switch to repository B, then return and confirm repository A session continuity
- verify inactive workspace switching does not terminate running terminals
- verify restart restores the previously active workspace while keeping other workspaces listed for later reopening

Test harness expectations should stay aligned with the existing project setup:

- e2e coverage should continue using Playwright launching the real Electron app
- repository behavior should be exercised against temporary real git repositories, following the current e2e fixture pattern
- service and reducer edge cases should stay in Vitest unit coverage rather than being pushed into Playwright

## Risks

The main risks are structural, not visual.

### Risk 1: hidden singleton assumptions

The current main process keeps one active repository. Similar assumptions may also exist in renderer flows that expect only one repo-scoped shell at a time.

### Risk 2: global ID collisions

The current app often keys runtime state by `worktreeId` or `processId`. The real risk is inconsistent scoping assumptions, not likely worktree-path collisions. Process ids should remain explicit runtime ids, and terminal metadata must carry `workspaceId` so event routing does not depend on incidental uniqueness.

### Risk 3: restore confusion

If background terminals continue during one app session but not across full restart, the UI and documentation must stay clear about that boundary.

### Risk 4: scope drift

There will be pressure to add cross-workspace dashboards, monitoring, and review summaries once multiple repositories exist in one app. Those should remain explicitly deferred unless real usage proves they are necessary.

## Success Criteria

This design is successful when:

- the user can keep two or three repository workspaces registered in one app
- switching between them is fast and predictable from the sidebar
- only one workspace is foregrounded at a time
- background terminal work keeps running while another workspace is open
- the existing worktree-session shell still feels focused rather than diluted by multi-repo management UI

## Summary

The right way to support several projects in `ai-14all` is not to make the inner shell multi-repo. It is to add one thin workspace layer above the existing repo-scoped shell.

That preserves the strongest part of the current architecture:

- repository-scoped worktree sessions
- session-first interaction
- terminal-first workflow

while allowing the user to move between multiple projects inside one app session.
