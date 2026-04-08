# Phase 7 Basic Worktree Lifecycle And Reactivity Design

## Purpose

This spec defines the next product phase after the completed Phase 6 shell hardening work.

Up to Phase 6, `ai-14all` assumes the repository already contains the worktrees the user wants to manage. The app can discover those worktrees, switch across them, and host session-first terminal and review workflows inside them, but it cannot create or remove worktrees itself and it does not always stay accurate when Git state changes outside the app.

Phase 7 should make the app capable of managing the basic worktree lifecycle while keeping the session shell trustworthy when branch or worktree state changes externally.

## Goals

Phase 7 should deliver four linked outcomes:

- create a new worktree from the app by creating a new branch from `origin/master`
- remove a non-main worktree and its associated local branch from the app
- keep the active session identity accurate when the active worktree branch changes
- keep the visible worktree list accurate when worktrees are added or removed outside the app

The intended outcome is that the app no longer behaves like a passive viewer of an already-prepared worktree set. It should become a reliable local control surface for the basic create/remove lifecycle while preserving the session-first workflow.

## Non-Goals

Phase 7 should not include:

- renaming worktrees
- arbitrary branch-base selection for new worktrees
- full Git branch management beyond the create/remove flows defined here
- merge, rebase, cherry-pick, checkout, or other advanced Git actions
- batch worktree operations
- multi-repository lifecycle management
- full filesystem watcher infrastructure for every worktree simultaneously

This phase should stay intentionally narrow. It is about basic worktree lifecycle support and session correctness, not becoming a general-purpose Git client.

## Product Direction

The core product model remains unchanged:

- one active worktree session at a time
- terminals remain the primary interaction surface
- code and Git inspection stay inside the selected worktree session
- the sidebar remains the place where the user understands the available worktree sessions

Phase 7 should extend that model rather than replace it.

The app should still feel session-first, not admin-panel-first. Create and remove worktree actions should live close to worktree navigation and should feed back into the existing shell immediately after success.

## Recommended Approach

The recommended approach is a sidebar-managed lifecycle flow with reactive active-worktree refresh.

This means:

- add `New worktree` at the bottom of the sidebar
- open a small preview-oriented modal for creation
- expose remove as a per-worktree sidebar action only for non-main worktrees
- open a destructive confirmation modal for removal
- refresh and reconcile the active repository worktree list after in-app lifecycle actions
- also refresh worktree discovery and active branch identity on lightweight runtime triggers such as focus regain and the existing active-worktree refresh cycle

This approach is preferable to a dedicated worktree-management screen because it keeps lifecycle actions attached to the same session navigation model the app already uses.

## Create Worktree Flow

Creation should be explicit, previewable, and low-risk.

### Entry Point

The create action should live at the bottom of the sidebar as `New worktree`.

This placement is important because creation adds a new worktree session to the same navigation surface the user already uses to switch worktrees. It should not be hidden in the top band or moved into a separate management page.

### Create Modal

Clicking `New worktree` should open a small modal that explains what the app will do.

The explanation should make it clear that the action creates both:

- a new local branch
- a linked worktree for that branch

The modal should preview the worktree information that will be created:

- name
- path
- branch
- current merge-target latest commit from `origin/master`

The merge-target preview should identify the current latest commit clearly enough for the user to verify what they are branching from before they confirm.

### Inputs And Derived Values

Required input should stay minimal:

- worktree name

The app should derive and preview:

- normalized branch name
- normalized worktree path
- latest `origin/master` commit

For V1, the branch name and worktree name can be treated as the same normalized value. The app does not need separate name and branch inputs unless real usage proves that necessary later.

For app-created worktrees, the default path convention should be explicit and predictable:

- create the linked worktree under `<repo-root>/.worktrees/<normalized-name>`

The create preview should show that exact derived path before confirmation.

### Validation

The app should validate before creation:

- worktree name is present
- derived branch name is valid enough for Git branch creation
- local branch does not already exist
- target worktree path does not already exist
- `origin/master` resolves successfully

If validation fails, the modal should present the failure locally and should not attempt the Git operation.

### Success Behavior

On success, the app should:

1. create the new branch from `origin/master`
2. create the linked worktree for that branch
3. refresh worktree discovery
4. select the newly created worktree session

The new worktree should then behave like any other discovered session:

- visible in the sidebar immediately
- selectable immediately
- subject to the same default shell behavior as any other selected worktree

## Remove Worktree Flow

Removal should be narrower and more defensive than creation.

### Eligibility

Removal should be allowed only for non-main worktrees.

The main worktree should never expose a remove action in the UI.

### Entry Point

Remove should be a per-worktree sidebar action rather than a global shell action.

This keeps the destructive action attached to a specific worktree session entry and avoids turning the main shell header into a general destructive-control zone.

### Remove Confirmation Modal

Triggering remove should open a confirmation modal that previews:

- worktree name
- worktree path
- branch name
- dirty status
- whether there are active running app-owned terminal sessions for that worktree

The modal should clearly state that the action will remove both:

- the linked worktree
- the associated local branch

The destructive nature of the branch removal should also be explicit:

- the app is allowed to force-delete the associated local branch after the user confirms removal

Dirty worktrees should require explicit confirmation before proceeding.

If the worktree still has active running terminal sessions inside the app, the modal should warn the user that those sessions will be terminated as part of the removal.

### Runtime Session Handling

If the user confirms removal for a worktree that still has active app-owned sessions, the app should:

- stop those running sessions
- drop the runtime session state for that worktree
- continue with worktree and branch removal

The app does not need a separate pre-cleanup workflow. The confirmation is the safety gate.

### Success And Failure Behavior

If the removed worktree was currently selected, the app should:

- refresh discovery
- move selection to a safe remaining worktree, preferably the main worktree

If removal fails partway, the app should refresh discovery and show the actual resulting state rather than assuming success.

For V1, confirmed removal should prefer forceful completion over a multi-step recovery flow:

1. terminate app-owned sessions for that worktree
2. remove the linked worktree
3. force-delete the associated local branch

## Active Branch Reactivity

The shell should remain trustworthy if the active worktree’s branch changes after the session is already open.

This matters because the branch can change:

- from an embedded terminal inside the app
- from another external terminal
- from another tool operating on disk

### Scope

V1 should scope reactive branch correctness to the active worktree only.

The app does not need to continuously monitor every worktree branch in the background. It only needs to keep the selected session accurate and trustworthy.

### Behavior

When the active worktree branch identity changes, the app should refresh the visible identity surfaces tied to that worktree:

- branch name
- active session summary/header
- any remove-action eligibility that depends on main vs non-main status

If a branch change flips the worktree’s effective status between main and non-main, the availability of the remove action should update promptly.

### Triggers

Detection should prefer lightweight refresh triggers instead of broad continuous watchers:

- completion of in-app create/remove operations
- app/window focus regain
- the existing periodic active-worktree refresh path while the app is focused

This is a correctness feature, not an invitation to add a large new background monitoring subsystem.

## Reactive Worktree Discovery

The visible worktree list should also stay accurate if worktrees are created or removed outside the app.

### Scope

Phase 7 should refresh repository worktree discovery reactively for the current repository, but it should not introduce a full deep filesystem watching system.

### Behavior

When the current repository’s discovered worktree set changes:

- newly added worktrees should appear in the sidebar without requiring a full repository reload
- externally removed worktrees should disappear from the sidebar
- stale session state for missing worktrees should no longer be presented as active or available

If the currently selected worktree disappears externally, the app should move selection to a safe remaining worktree and keep the shell usable.

### Triggers

Discovery refresh should happen on:

- completion of in-app create/remove actions
- app/window focus regain
- the existing focused periodic refresh path

This keeps discovery reactive enough for real usage while staying aligned with the product rule to avoid unnecessary background complexity.

## Architecture Boundaries

Phase 7 should preserve the existing architecture rules.

### Backend Responsibilities

Privileged lifecycle operations belong in backend services and IPC, not in React components.

This phase will require new backend support for:

- previewing creation inputs against the current repository
- creating a branch and linked worktree
- previewing remove eligibility and metadata for a target worktree
- removing a linked worktree and branch
- refreshing worktree discovery after lifecycle actions

Renderer code should orchestrate modal state and user interaction only. Git and filesystem operations should remain behind typed IPC and service boundaries.

### Renderer Responsibilities

Renderer state should remain session-first.

The new UI state should stay lightweight and runtime-oriented:

- create modal open or closed
- create form input and preview state
- remove modal open or closed
- remove preview and confirmation state

The app should not introduce a separate management dashboard or a parallel non-session data model for worktrees.

## Error Handling

Phase 7 should fail locally and clearly.

Creation failures should include cases such as:

- `origin/master` missing or unresolved
- invalid or conflicting branch name
- conflicting worktree path
- Git create command failure

Removal failures should include cases such as:

- trying to remove the main worktree
- local branch remove failure
- linked worktree remove failure
- inability to stop app-owned sessions cleanly before proceeding

The UI should report actionable error text and should refresh discovery after failure when the repository state may have changed partially.

## Testing

Phase 7 should add coverage for both lifecycle behavior and reactive correctness.

### Unit And Service Coverage

Tests should prove:

- create validation and preview behavior
- remove validation and preview behavior
- main-worktree remove prevention
- dirty-worktree confirmation requirements
- stopping app-owned sessions before confirmed removal
- active-worktree branch reactivity updates shell identity correctly
- external worktree discovery reconciliation updates available sessions correctly

### E2E Coverage

The cumulative e2e suite should extend to prove at least:

- creating a worktree from the sidebar modal creates a new worktree session and selects it
- removing a non-main worktree removes both the session entry and associated branch
- dirty removal requires explicit confirmation
- branch changes made outside the app are reflected in the active session after a supported refresh trigger
- externally added worktrees appear after a supported refresh trigger
- externally removed worktrees disappear and selection recovers safely if needed

## Completion Criteria

Phase 7 is complete when:

- the user can create a new worktree and branch from `origin/master` inside the app
- the user can remove a non-main worktree and its local branch from inside the app
- dirty removal always goes through explicit confirmation
- running app-owned sessions for a removed worktree are clearly warned about and terminated on confirmed removal
- the active session header and branch identity stay accurate after branch changes
- the sidebar worktree list stays accurate when worktrees are added or removed outside the app
- the shell remains session-first rather than turning into a generalized Git management screen
