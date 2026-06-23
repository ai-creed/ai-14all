# PR e2e gate for `devel` — design

- **Date:** 2026-06-23
- **Status:** Approved (pending spec review)
- **Author:** Vu Phan (with Claude Code)
- **Topic:** Require a green end-to-end (e2e) gate on every pull request before it can merge to `devel`.

## Problem

There is no continuous-integration gate on pull requests into `devel`. The three
existing workflows (`release.yml`, `release-windows.yml`, `build-windows.yml`)
are all release-oriented and tag/dispatch-triggered; none run on `pull_request`.
As a result a PR can merge to `devel` while lint, typecheck, unit, or e2e checks
are red. We want a required, automated gate so that work cannot land on `devel`
unless the full quality suite — including e2e — is green.

## Goals

- Run the full quality gate on every PR whose base branch is `devel`.
- Make the e2e result a **required** status check, so a red run blocks merge.
- Reuse the already-proven CI path; introduce as little new, unproven machinery
  as possible.

## Non-goals (YAGNI)

- No gating on `master` (only `devel` is in scope for this change).
- No Windows e2e (the repo has no Windows e2e suite).
- No pnpm/Electron dependency caching in v1 (see Trade-offs).
- No e2e sharding / suite trimming in v1 (see Trade-offs).

## Key facts verified against the repo

These were confirmed by reading the actual files rather than assumed:

- **The gate already runs green in `release.yml`** on `macos-14` + Node 24. Its
  steps are: `actions/checkout@v4` → `actions/setup-node@v4` (node 24) →
  `corepack enable` → `pnpm install --frozen-lockfile` →
  `node scripts/ensure-electron.mjs` → `pnpm lint` / `pnpm format` /
  `pnpm typecheck` → `pnpm test` (unit) → `pnpm test:e2e`.
- **`scripts/ensure-electron.mjs` exists** and is required on Node 24/macOS: the
  Electron 41 bundled `extract-zip` leaves `Electron.app` incomplete, breaking
  Playwright's `_electron.launch`. The script re-extracts the cached zip.
- **e2e is self-sufficient for native modules.** `tests/e2e/global-setup.ts`
  rebuilds `better-sqlite3` to the Electron ABI before launching, and
  `tests/e2e/global-teardown.ts` restores the host ABI afterward. So
  `pnpm test:e2e` needs no extra rebuild plumbing in the workflow (the explicit
  `electron-rebuild` step in `release.yml` exists only for *packaging*).
- **e2e shape:** Playwright driving Electron, `testDir: ./tests/e2e`, ~33 spec
  files, `fullyParallel: false`, `workers: 1`, `retries: 2` when `CI` is set,
  per-test `timeout: 60_000`.
- **Package manager / runtime:** `pnpm@10.33.0` via corepack, Node 24.
- **Existing `devel` branch protection** (read via `gh api`, admin access
  confirmed for account `vuphanse`):
  - `required_pull_request_reviews.required_approving_review_count: 1`
  - `required_status_checks.strict: true`, but `contexts: []` (no required
    checks yet — this is the gap to fill)
  - `enforce_admins: false`, `allow_force_pushes: true`

## Design (Approach A — single job on `macos-14`)

### New workflow: `.github/workflows/pr-gate.yml`

A single job that mirrors the proven `release.yml` gate exactly, with the
cheap checks ordered first so they fail fast before e2e burns runner time.

```yaml
name: pr-gate
on:
  pull_request:
    branches: [devel]
concurrency:
  group: pr-gate-${{ github.ref }}
  cancel-in-progress: true
jobs:
  gate:
    runs-on: macos-14
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: node scripts/ensure-electron.mjs
      - name: Lint + format + typecheck
        run: |
          pnpm lint
          pnpm format
          pnpm typecheck
      - name: Unit tests
        run: pnpm test
      - name: E2E tests
        run: pnpm test:e2e
```

Design notes:

- **Trigger:** `pull_request` with `branches: [devel]` runs on the default
  activity types (`opened`, `synchronize`, `reopened`), i.e. on PR open and on
  every push to the PR head.
- **Concurrency:** superseded runs for the same ref are cancelled so rapid
  pushes don't pile up macOS minutes.
- **`timeout-minutes: 45`** matches `release.yml`'s budget and bounds runaway
  runs.
- **Status-check context:** the job id `gate` (no custom `name:`) produces a
  check-run named `gate`; that exact string is what branch protection will
  require.

### Enforcement (branch protection)

`devel` already has a protection object; we surgically add the required context
using the granular `required_status_checks` endpoint so the existing 1-review
requirement is **not** disturbed:

```bash
gh api -X PATCH \
  repos/ai-creed/ai-14all/branches/devel/protection/required_status_checks \
  -F strict=true \
  -f 'contexts[]=gate'
```

`strict: true` is retained (already the current setting): a PR must be
up-to-date with `devel` before it can merge, guaranteeing the e2e run reflects
the latest base.

### Rollout sequencing (avoids a chicken-and-egg lock)

1. Land `pr-gate.yml` on `devel` first, via a PR from `ci/pr-e2e-gate`. For a
   `pull_request` event, the workflow definition is taken from the PR's merge
   ref, so the introducing PR itself exercises `pr-gate` — a real first run.
2. Verify that first run is green, then merge the PR to `devel` (admin merge;
   `enforce_admins: false`).
3. **Only after** the workflow exists on `devel`, add `gate` to the required
   status checks. Adding it earlier would have nothing to satisfy on existing
   open PRs.

## Trade-offs

- **Runtime:** with `workers: 1` + `retries: 2` over ~33 specs, a green e2e run
  is expected to take roughly 15–30 minutes per PR. This is the accepted cost of
  a genuine e2e gate; sharding or suite trimming is deferred.
- **Runner cost:** running the whole gate on `macos-14` means even a 2-second
  lint failure spins a macOS runner. Accepted in exchange for exactly matching
  the proven path (Approach B — fast checks on Linux — was rejected because it
  runs unit/native-module code on an unproven platform).
- **No caching in v1:** `release.yml` proves the gate works without dependency
  caching, and `actions/setup-node` cache ordering interacts awkwardly with
  `corepack enable`. Caching is a clearly-scoped future optimization, not part
  of this change.

## Rejected alternative (Approach B)

Split into a `fast-checks` job on `ubuntu-latest` (lint/format/typecheck/unit)
and an `e2e` job on `macos-14` gated by `needs: fast-checks`. Cheaper minutes on
cheap failures, but it runs unit tests and native modules (`better-sqlite3`,
`node-pty`) on Linux, which is **unproven** for this app, and requires wiring two
required contexts. Rejected in favor of the lowest-risk mirror of the existing
green path.

## Acceptance criteria

- Opening a PR with base `devel` triggers the `pr-gate` workflow.
- The workflow runs lint, format, typecheck, unit, and e2e; any failure fails
  the run.
- `gate` appears as a required status check on `devel`, and a PR with a red
  `gate` cannot be merged (subject to the existing 1-review requirement).
- The existing `required_pull_request_reviews` (1 approval) remains intact.

## Edge cases to keep in mind during implementation/verification

- **First-run chicken-and-egg:** enforcement is added only after the workflow is
  on `devel` (see Rollout sequencing).
- **`strict: true` staleness:** when `devel` advances, open PRs must update their
  branch before merge; this is expected, not a bug.
- **Forks:** PRs from forks run with a read-only `GITHUB_TOKEN`; this gate needs
  no secrets, so fork PRs are gated normally. (Today contributions are
  internal/branch-based, so this is informational.)
- **`pnpm format`** is `prettier --check`; unformatted files fail the gate, same
  as in `release.yml`.
- **Native-module ABI flip:** e2e's global-setup/teardown flips `better-sqlite3`
  ABI; since unit tests run *before* e2e in the same job and on a fresh runner,
  there is no ordering hazard.
```
