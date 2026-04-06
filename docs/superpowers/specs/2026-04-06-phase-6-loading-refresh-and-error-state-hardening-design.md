# Phase 6 Hardening — Loading, Refresh, And Error-State Design

## Purpose

This spec defines the next focused hardening slice under Phase 6 personal MVP hardening.

The goal is to make repository entry and in-session review reads dependable enough for repeated daily use without disrupting the session-first workflow.

This spec is intentionally narrow. It addresses startup and repository-load failures, in-session refresh and read failures, and focused auto-refresh for active review data. It does not broaden the product into external editor integration, new Git operations, or a general-purpose background sync system.

## Problem

The current shell already distinguishes between setup flow and the main session UI, but its loading and failure behavior is still uneven in ways that matter during daily use.

Current problems include:

- repository entry failures can feel generic instead of clearly explaining what failed and what the user can do next
- in-session review data reads may clear or thrash state rather than preserving the last useful view
- manual refresh is still doing too much of the work to keep review context current
- transient Git failures can feel more disruptive than they should because review surfaces are secondary to the terminal session but do not always degrade that way

The product promise for Phase 6 is not that every Git read always succeeds. It is that failures should be understandable, proportionate, and not collapse the user’s active session.

## Goals

This hardening slice should:

- make startup and repository-open failures explicit and recoverable
- keep the user on a clear blocking setup flow until a trustworthy repository session is established
- preserve the last successful review data when refresh or read requests fail in-session
- mark degraded review data as stale instead of clearing it immediately
- introduce lightweight automatic refresh for active review context while the app window is focused
- keep terminal and active worktree context stable when review reads fail

## Non-Goals

This spec should not include:

- external editor integration
- broader workspace recovery redesign beyond already-approved behavior
- automatic repo discovery or background scanning
- polling for file contents, diffs, or terminal state
- background refresh while the app window is unfocused
- large visual redesign unrelated to these states
- new advanced Git operations

## Product Direction

The session-first product shape remains unchanged:

- one repository first
- one active worktree session at a time
- terminals remain primary
- review data remains supporting context around the active session

This means the app should block only when it cannot establish a trustworthy repository session at all.

Once the shell is open, failures in review reads should degrade locally and preserve continuity rather than bouncing the user back into setup or clearing useful context.

## Recommended Approach

The recommended approach is:

1. treat repository-entry failures and in-session review failures as two different classes of state
2. use blocking setup states only when no trustworthy repository session exists yet
3. preserve last successful review data per surface and add stale metadata when refresh fails
4. add focused auto-refresh for the active worktree’s summary and commit history while the app window is focused
5. keep retry behavior local to the affected surface wherever possible

This is preferable to a single global app error model because the shell has two different reliability needs:

- repository identity and open-path correctness are foundational
- review surfaces are supporting context and can degrade without taking down the session

It is also preferable to patching each panel independently without shared rules because the product should behave consistently across summary, history, and detail reads.

## State Model

This slice should distinguish between `blocking repository states` and `degraded review states`.

### Blocking Repository States

These are states where the app cannot yet trust that it has a valid repository session:

- startup restore state cannot be read
- a saved repository cannot be reopened from its saved path and no valid repo has been loaded yet
- a manually entered path is invalid or does not resolve to a Git repository
- repository metadata cannot be read well enough to establish the session

These states may block entry into the main shell and keep the user in setup UI.

### Degraded Review States

These are states where the shell is open and the active session is still valid, but one review surface cannot refresh or read successfully:

- changed-files summary refresh fails
- commit history refresh fails
- commit detail fetch fails
- file or diff reads fail for the selected item

These states should not tear down the session. Each affected surface should keep its last successful data, record that it is stale, and show a local warning or error message with a retry path.

## Repository Entry Behavior

### Startup

Startup should continue to use a blocking setup screen until the app either:

- restores a valid repository session
- reaches the repository picker after a failed restore
- or determines that there is no prior snapshot to restore

If startup restore fails:

- explain the failure plainly
- keep the user on a clean recovery path
- preserve any restorable snapshot data according to the recovery spec
- avoid dropping the user into an ambiguous half-loaded shell

### Manual Repository Load

If manual repository load fails:

- keep the user in the setup screen
- preserve the entered path so they can fix or retry it
- show a specific error message rather than a generic failure string

The setup screen should distinguish at least these cases in practical language:

- path does not exist
- path is not a Git repository
- repository metadata could not be read
- previous workspace could not be reopened from its saved path

## Review Surface Behavior

The review surfaces should use the same behavior model:

- changed-files summary
- commit history
- commit detail
- selected file or diff content

For each surface:

- do not clear current data immediately when a refresh starts
- if refresh succeeds, replace the data and clear stale metadata
- if refresh fails and there is prior successful data, keep showing it and mark the surface stale
- if refresh fails and there has never been successful data, show a local empty or error state instead

Recommended stale copy pattern:

- “Couldn’t refresh changes. Showing last successful result.”
- “Couldn’t refresh commit history. Showing last successful result.”

The message should stay small and local to the affected surface.

## Stale Data Rules

Each review surface should track:

- whether it has ever loaded successfully
- whether a request is currently in flight
- whether the currently displayed data is stale due to the latest failure
- a local message for the current degraded state

The app should not repeatedly spam new warnings while a surface stays stale.

Instead:

- the surface becomes stale after the first failed refresh
- it remains quietly marked stale until the next success
- the stale marker clears automatically when a later request succeeds

This keeps the user informed without turning transient Git failures into a banner storm.

## Retry Behavior

Retry should stay close to the failed surface whenever possible.

Recommended behavior:

- summary and changes retry from the existing refresh action
- commit history retry from the review panel
- commit detail retry from the detail area
- file or diff read retry from the viewer area

Manual refresh remains available as an explicit override and should trigger an immediate fetch for the active worktree review surfaces.

## Auto-Refresh

The app should no longer rely primarily on manual refresh to keep review context current.

### Scope

Auto-refresh should be intentionally narrow:

- poll only for the active worktree
- poll only review surfaces that benefit from passive freshness
- keep terminal/session state completely outside this loop

### Polled Surfaces

Poll by default:

- changed-files summary
- commit history

Do not poll by default:

- commit detail
- file contents
- file diffs

Commit detail should refresh when:

- the selected commit changes
- or the parent history refresh invalidates or removes the selected commit

File and diff reads should remain selection-driven or user-triggered.

### Focus Rules

Auto-refresh should run only when all of these are true:

- the app window is focused
- startup is past blocking setup
- a valid repository is open
- an active worktree session exists

When the app window regains focus:

- trigger an immediate refresh of polled surfaces
- do not wait for the next interval tick

When the app window loses focus:

- suspend polling

### Interval

Use a modest interval, roughly 10 to 20 seconds.

The exact value should optimize for practical freshness without creating obvious churn or request noise.

Manual refresh should still force an immediate update and reset the polling timer.

## Error Presentation

This hardening slice should use error presentation proportional to the failure.

Blocking setup failures:

- setup-screen message
- actionable wording
- no entry into the main shell until a valid repo is loaded

In-session degraded reads:

- inline warning near the affected surface
- stale indicator on the preserved data
- local retry path
- no blocking modal or global shell reset

This preserves the hierarchy of importance:

- repository context is foundational
- review context is supportive

## Data Consistency Rules

This slice should prefer continuity, but not at the cost of obvious contradiction.

Important rules:

- if a new summary succeeds, replace the old summary immediately and clear stale state
- if commit history refresh removes the selected commit, clear the selected commit detail rather than showing an impossible detail view
- if file summary changes remove the selected changed file, clear that selection rather than showing a stale file target that no longer exists in the current summary
- if a read fails but the current displayed data is still logically compatible with the latest known parent state, keep it marked stale

This keeps preserved data useful without making the UI internally inconsistent.

## Testing Expectations

This hardening slice should add or expand coverage for:

- startup restore failures that remain in blocking setup with clear messaging
- invalid manual repo load paths with preserved input and specific errors
- summary refresh failure preserving last successful data and marking it stale
- commit history refresh failure preserving last successful data and marking it stale
- commit detail failure showing local degraded behavior without collapsing the session
- focus-gated polling for active worktree review data
- focus-return immediate refresh behavior
- stale markers clearing after a later successful fetch
- selection clearing when refreshed parent data invalidates the previous selection

Phase 6 user-visible behavior is not complete until the cumulative e2e flow covers the new steady-state behavior for auto-refresh and degraded review reads.

## Open Questions Resolved By This Spec

This spec makes the following decisions explicit:

- the app window, not the review panel, controls whether polling runs
- stale review data should stay visible instead of clearing on refresh failure
- blocking screens are reserved for startup and repository-entry correctness
- commit detail is not part of passive polling in V1 hardening
- manual refresh remains available but is no longer the primary freshness mechanism
