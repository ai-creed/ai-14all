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

## Service And IPC Implications

The largest structural change is in the privileged layer.

Today the main process keeps one `currentRepository`. That must be replaced by a workspace registry.

Recommended backend model:

- workspace registry keyed by `workspaceId`
- each registry entry owns the active repository identity and discovered worktrees for that workspace
- repository-oriented operations become explicitly workspace-scoped

Examples:

- `repository:setRoot` becomes create-or-register workspace behavior
- `repository:listWorktrees(workspaceId)`
- `repository:previewCreateWorktree(workspaceId, name)`
- `repository:createWorktree(workspaceId, name)`
- `repository:previewRemoveWorktree(workspaceId, worktreeId)`
- `repository:removeWorktree(workspaceId, worktreeId)`

File and Git read operations can remain path-based for now because they already operate on explicit worktree paths rather than a singleton current repository.

The terminal service can keep its global PTY session map, but runtime metadata should carry both:

- `workspaceId`
- `worktreeId`

That avoids hidden app-wide uniqueness assumptions and keeps event routing correct when several repository workspaces are alive at once.

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

## Migration Strategy

This work should be staged so the current app continues to function while the model expands.

Recommended sequence:

1. introduce top-level `WorkspaceShell` types and app state
2. replace main-process `currentRepository` with a workspace registry
3. scope repository IPC commands by `workspaceId`
4. nest the current repo-scoped renderer shell under an active workspace
5. add sidebar workspace switching
6. expand persistence from one workspace snapshot to many
7. add migration logic from the existing single-snapshot file shape

The key principle is to preserve the existing repo-scoped shell as a reusable inner unit rather than rewriting its internals too early.

## Data Migration

The current persisted schema is versioned and stores one snapshot.

A new schema version should:

- preserve restore preference
- convert the old single snapshot into a one-entry `workspaces` collection
- assign a stable `workspaceId`
- set `activeWorkspaceId` to that entry

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

## Risks

The main risks are structural, not visual.

### Risk 1: hidden singleton assumptions

The current main process keeps one active repository. Similar assumptions may also exist in renderer flows that expect only one repo-scoped shell at a time.

### Risk 2: global ID collisions

The current app often keys runtime state by `worktreeId` or `processId`. Multi-workspace support must verify which identifiers are only repo-local and which are app-global.

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
