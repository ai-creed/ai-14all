# Cumulative Phase E2E Coverage Design

## Purpose

The project should stop treating end-to-end coverage as a replaceable snapshot of the latest phase.

From this point forward, each phase should preserve prior covered behavior and add coverage for the new user-visible behavior introduced in that phase.

This design does two things:

- makes cumulative e2e coverage an explicit delivery rule
- backfills the missing cumulative coverage for the phases implemented so far

## Problem

The current repo has one Playwright spec, [tests/e2e/app-flow.test.ts](/Users/vuphan/Dev/oneforall/tests/e2e/app-flow.test.ts).

That file started as a Phase 0 validation matrix and was later rewritten as a Phase 2 workflow spec. The result is that older covered behavior was replaced instead of preserved.

This is the wrong testing shape for a phased product plan. A new phase should extend the product-level e2e suite, not erase what prior phases proved.

## Policy Change

The project should adopt this rule in both [docs/shared/plan.md](/Users/vuphan/Dev/oneforall/docs/shared/plan.md) and [AGENTS.md](/Users/vuphan/Dev/oneforall/AGENTS.md):

- a phase is not complete until user-visible behavior introduced in that phase has end-to-end coverage
- end-to-end coverage is cumulative across phases
- newer phase coverage must add to the suite instead of replacing older flow coverage

This should stay lightweight. It is a delivery rule, not a full testing manifesto.

## Scope

This work covers:

- adding the cumulative e2e rule to the project workflow docs
- restructuring the e2e suite so it reflects cumulative phase coverage
- backfilling missing cumulative coverage for the phases currently implemented in the repo

This work does not cover:

- speculative e2e tests for unimplemented behavior
- visual regression tooling
- CI policy changes
- rewriting the product plan around testing

## Current Coverage Boundary

The current implemented product behavior reaches Phase 2.

That means the backfill in this design should cover:

- Phase 0: repository load, worktree discovery, terminal usage, file viewing
- Phase 1: externally visible skeleton behavior worth asserting, without inventing artificial tests for internal architecture
- Phase 2: session-first workflow behavior, including session shell, multiple terminal tabs, per-session note state, changed-files review, and per-file diff viewing

Phases 3, 4, and 5 should not receive speculative tests yet. Instead, their future implementation must extend the cumulative suite when those behaviors are actually built.

## Test Structure

The e2e suite should represent one cumulative product flow from Phase 0 through the current implemented phase.

It may be split into multiple spec files for maintainability, but the suite should still behave as one growing validation matrix under `pnpm test:e2e`.

Recommended shape:

```text
tests/e2e/
  fixtures/
    create-test-repo.ts
  cumulative-flow.phase-0.test.ts
  cumulative-flow.phase-1.test.ts
  cumulative-flow.phase-2.test.ts
```

Why this shape:

- keeps phase responsibilities readable
- avoids one oversized spec file
- makes it obvious that new phases add files or cases rather than replacing older ones

The naming should emphasize cumulative coverage rather than “latest phase only”.

## Coverage Expectations By Implemented Phase

### Phase 0 Coverage

The cumulative suite should continue to prove the original technical spike behavior:

- launch the built Electron app
- load one repository path
- display parsed worktrees
- select a worktree
- create and use a terminal session
- open a file in the embedded viewer

### Phase 1 Coverage

Phase 1 is mostly structural, so e2e coverage should stay conservative.

Only assert externally visible behavior that became durable and meaningful to the user during the Phase 1 skeleton work. Do not create fake browser-level assertions just to say Phase 1 has a dedicated file.

If a small Phase 1 suite only validates stable shell behavior around repository loading and session-oriented structure, that is acceptable.

### Phase 2 Coverage

The cumulative suite should preserve the current session-first behavior:

- show the session shell after repository load
- switch between worktree sessions
- open multiple terminal tabs within the active session
- preserve the per-session note when moving between worktrees
- show changed files for the active worktree
- open a unified diff for a changed file

## Implementation Guidance

When a new phase is implemented:

1. identify the new user-visible behavior introduced by that phase
2. add or extend e2e specs so that behavior is covered
3. keep prior phase behavior represented in the suite
4. do not replace the previous “main flow” file with a new single-phase file

This rule should apply even when the e2e suite is split across multiple files.

The key requirement is cumulative coverage, not a particular file count.

## Acceptance Criteria

This design is complete when all of the following are true:

- [docs/shared/plan.md](/Users/vuphan/Dev/oneforall/docs/shared/plan.md) explicitly requires cumulative e2e coverage for new phase behavior
- [AGENTS.md](/Users/vuphan/Dev/oneforall/AGENTS.md) repeats that rule as local execution guidance
- the e2e suite no longer relies on one latest-phase replacement spec as the only source of truth
- `pnpm test:e2e` runs cumulative coverage for all implemented phases
- future phase work is expected to extend e2e coverage rather than overwrite it

## Non-Goals

This design does not require:

- one giant e2e file for all phases
- full internal-architecture validation through e2e
- prewriting tests for future unimplemented phases
- redefining unit-test strategy

The goal is simple: phase behavior accumulates, and e2e coverage accumulates with it.
