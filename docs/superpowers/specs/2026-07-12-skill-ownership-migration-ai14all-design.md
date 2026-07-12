# Skill Ownership Migration — ai-14all Sub-Spec (Sub-Project 2)

- **Date**: 2026-07-12
- **Status**: Approved 2026-07-12 (decisions D1/D2/D3 resolved — see §11)
- **Parent spec**: `ai-shakespii/docs/superpowers/specs/2026-07-12-skill-ownership-migration-design.md` (authoritative for scope and semantics; this document distills its sections 4, 5, 6 as they apply to ai-14all)
- **Decision owner**: Vu Phan

## 1. Goal

ai-14all becomes the owning source of truth for its two companion skills
(`ai-14all-fix-review`, `ai-14all-session-status`). The repo adopts the
calibrated skill content produced by the M5d campaign (source:
`~/Dev/ai-skills` @ commit `91890bb`), the installer gains a semver version
guard so it never silently downgrades an installed copy, uninstall stops
deleting files the app never wrote, and CI gains a skills QA job. The
sub-project closes with an app re-release so the packaged `.app` carries the
new assets and the guard.

## 2. Verified current state

Every claim below was checked against the repo and live systems on
2026-07-12.

**Assets** — `assets/agent-skills/` holds exactly two files, one per skill:
`<skill>/SKILL.md`. Both are pre-calibration templates with **no `version`
field** in frontmatter.

**Calibrated source** — `ai-skills @ 91890bb` (currently the branch head)
holds per skill: `SKILL.md` (frontmatter `version: 0.1.0` in both),
`evals/evals.json`, `evals/triggers.json`. There are **no `evals/files/`
fixtures** for these two skills (the umbrella spec's mention of fixtures
applies to other skills). Total eval payload: ~11 KB across 4 JSON files.

**Live corpus** — `~/.claude/skills/ai-14all-{fix-review,session-status}`
already hold the calibrated `SKILL.md` (v0.1.0) plus `evals/` directories.
This is the state the acceptance test in §10 assumes.

**Installer** — `services/review/agent-skill-installer/`:

- `skill-asset.ts` loads bundled `SKILL.md` content by id
  (`BUNDLED_SKILL_IDS`); resolution tries `assets/agent-skills/…`, a legacy
  prefix, then a bounded recursive search. Covered by
  `tests/unit/review/skill-asset.test.ts` — behavior must not change.
- `claude-provider.ts`, `codex-provider.ts`, `ezio-provider.ts` each write
  `SKILL.md` unconditionally (tmp file + atomic rename) in `installSkills`,
  then register the MCP server. `uninstall` does
  `rm(dir, { recursive: true, force: true })` on each whole skill directory.
- `index.ts` (`AgentSkillInstaller.install`) returns per-provider
  `{ id, ok, message: string | null }`; `message` is `null` on success.
- Contract: `shared/contracts/agent-install.ts` (`InstallResponseSchema`) —
  shape already accommodates a message string; no contract change needed.

**UI** — `src/features/review/components/AgentInstallModal.tsx` renders a
hardcoded `Installed ✓` whenever `result.ok` is true and **ignores
`result.message`**. Surfacing "up to date" / "skipped" requires a small modal
change (§5.4).

**Tests** — `tests/unit/review/agent-skill-installer.test.ts` (installer
integration through stubbed assets + exec mock), plus per-provider tests
`claude-provider.test.ts`, `codex-provider.test.ts`, `ezio-provider.test.ts`
(each has an uninstall case asserting whole-directory deletion — these will
be rewritten by §6).

**E2E** — `tests/e2e/agent-skill-install.test.ts` exists but is file-wide
skipped ("requires E2E environment — unskip when Playwright/Electron compat
is resolved"). The skip reason is **stale**: the preload-timing issue it
describes is solved in the active e2e suites (33 of 38 e2e files run) via a
`page.waitForFunction(() => "ai14all" in window)` guard after
`firstWindow()` — see `tests/e2e/review-comments.test.ts`. §5.6 revives and
extends this file.

**Packaging** — `electron-builder.yml` line 23–24:

```yaml
extraResources:
  - assets/agent-skills/**/*
```

Copies the tree into `<app>/Contents/Resources/assets/agent-skills/…`.

**Formatting trap** — `pnpm format` runs `prettier --check .` and
`.prettierignore` does not cover `assets/`. Verified empirically: 3 of the 6
calibrated files (`ai-14all-session-status/SKILL.md`, both `triggers.json`)
**fail** `prettier --check` under the repo's prettier (`^3.5.3`). Without a
`.prettierignore` entry, CI breaks the moment the calibrated content lands
bit-for-bit. §7 adds the ignore entry.

**CI** — `master-gate.yml` (push to master + PRs to master): lint, format,
typecheck, unit tests on `macos-14`. `pr-gate.yml` (PRs to devel): same plus
e2e. `release.yml` triggers on `v*.*.*` tags (excluding `v*-*` prereleases)
and on manual dispatch. Existing CI helper scripts live in `scripts/ci/`.

**shakespii** — `shakespii@0.3.1` is published on npm (only 0.3.0 and 0.3.1
exist). CLI verified by probing `0.3.1` directly:
`shakespii lint <path> [--json] [--corpus]`;
`shakespii test <path> [--json] [--run]` where the bare form runs
deterministic harness checks and `--run` executes live LLM stages (out of CI
per the umbrella spec).

**Release tooling** — `pnpm release:stable` (`scripts/release-stable.mjs`,
`patch|minor|major` or `--version X.Y.Z`); latest tag `v1.3.0`; app version
`1.3.0`.

## 3. Scope

Four implementation units + release, in this order (guard lands before the
asset swap so the swap installs gracefully on machines that already hold
calibrated copies):

- **U1** Installer version guard (TDD, incl. reviving + extending the
  agent-install e2e suite for the new visible statuses — §5.6)
- **U2** Uninstall softening (TDD)
- **U3** Calibrated assets into the repo (bit-for-bit) + prettier ignore
- **U4** CI skills QA job + AGENTS.md version-bump rule
- **R** App re-release (closing step)

**Out of scope** (unchanged): MCP server registration behavior in the
installer; `listProviders` detection logic; the ai-whisper and ai-skills
repos (sub-projects 1 and 3); any skill-content edit beyond the bit-for-bit
copy; a downgrade/"force" UI.

## 4. Content mapping (umbrella §4)

| Repo path | Source (`ai-skills @ 91890bb`) | Note |
| --- | --- | --- |
| `assets/agent-skills/ai-14all-fix-review/SKILL.md` | `skills/ai-14all-fix-review/SKILL.md` | replace, bit-for-bit |
| `assets/agent-skills/ai-14all-fix-review/evals/evals.json` | same path | new file |
| `assets/agent-skills/ai-14all-fix-review/evals/triggers.json` | same path | new file |
| `assets/agent-skills/ai-14all-session-status/SKILL.md` | `skills/ai-14all-session-status/SKILL.md` | replace, bit-for-bit |
| `assets/agent-skills/ai-14all-session-status/evals/evals.json` | same path | new file |
| `assets/agent-skills/ai-14all-session-status/evals/triggers.json` | same path | new file |

Version continuity: both skills land at `version: 0.1.0` exactly as
calibrated — no edits of any kind (verified post-copy by `git show
91890bb:<path> | diff - <repo copy>` per file). Evals are dev/CI assets; the
installer never writes them to provider directories.

## 5. Installer version guard (umbrella §5)

### 5.1 Version parsing and comparison

New module `services/review/agent-skill-installer/skill-version.ts` — a
minimal frontmatter scan, no YAML dependency:

- `parseSkillVersion(content: string): string | null` — if the first line is
  `---`, scan lines until the closing `---` for
  `/^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/`; return the capture, else
  `null`. Anything malformed (no frontmatter, no match, non-numeric fields)
  is `null`.
- `compareSemver(a: string, b: string): -1 | 0 | 1` — numeric compare of the
  three fields. No prerelease/build-metadata support (calibrated versions are
  plain `X.Y.Z`; CI asserts parseability of bundled versions, §8).

### 5.2 Guard decision

`decideSkillAction(bundled: string, installed: string | null)` returns one of
`"install" | "up-to-date" | "skipped-newer"`, per the umbrella table adapted
to the app (the app UI has no force concept — no force row):

| Condition | Action | Reported as |
| --- | --- | --- |
| destination `SKILL.md` missing/unreadable | `install` | installed |
| installed copy has no parseable `version` | `install` (treat as older) | installed |
| bundled has no parseable `version`, installed does | `skipped-newer` (protect installed) | skipped — newer installed |
| bundled > installed | `install` (upgrade) | installed |
| bundled == installed | `up-to-date` | up to date |
| bundled < installed | `skipped-newer` | skipped — newer version installed |

The bundled-version-missing row is a defensive edge: CI (§8) asserts every
bundled `SKILL.md` carries a parseable version, so it is unreachable in a
released build; when it somehow occurs, protecting the installed copy is the
guard's whole purpose. Failure honesty rule: a skip is reported as a skip,
never as a successful install.

### 5.3 Provider integration

A shared helper (in `skill-version.ts`)
`guardedWriteSkill(dir: string, skill: BundledSkill): Promise<SkillAction>`
reads `<dir>/SKILL.md` (ENOENT → missing), applies `decideSkillAction`, and
only on `"install"` performs the existing tmp-write + atomic rename. Each
provider (claude, codex, ezio) replaces its unconditional write with this
helper and `installSkills` now returns
`Array<{ id: string; action: SkillAction }>` instead of `void`. MCP
registration still runs unconditionally after the skill loop — unchanged and
out of scope.

`AgentSkillInstaller.install` composes the per-provider `message` from the
outcomes:

| Outcomes | `ok` | `message` |
| --- | --- | --- |
| all `install` | `true` | `null` (UI keeps rendering "Installed ✓") |
| all `up-to-date` | `true` | `"Already up to date"` |
| mixed / any `skipped-newer` | `true` | per-skill list, e.g. `"ai-14all-fix-review: skipped — newer version installed; ai-14all-session-status: installed"` |

### 5.4 UI change

`AgentInstallModal.tsx`: when `result.ok && result.message`, render the
message text (info style) instead of the hardcoded `Installed ✓`; when
`result.ok && !result.message`, keep `Installed ✓` exactly as today. Failure
rendering unchanged.

### 5.5 Tests (written first — TDD)

- New `tests/unit/review/skill-version.test.ts`: parse (frontmatter present /
  absent / malformed / quoted), compare ordering, `decideSkillAction` table.
- Extend `tests/unit/review/agent-skill-installer.test.ts` with the
  guard-table cases end-to-end (stubbed bundled assets now carry version
  frontmatter): missing dest → writes; bundled newer → overwrites; equal →
  skip + "Already up to date" message; bundled older → skip + skipped-newer
  message; installed copy without version field → overwrites. Assert
  file-content outcomes and the composed `message`, and that a skip performs
  zero writes (dest mtime/content unchanged).
- Modal message rendering: extend/add a unit test under
  `tests/unit/review/` for the ok+message branch.

### 5.6 E2E coverage (required)

AGENTS.md: new user-visible behavior is not done until the e2e suite covers
it, and e2e coverage must accumulate. The up-to-date / skipped install
statuses are new user-visible behavior, so
U1 includes reviving and extending `tests/e2e/agent-skill-install.test.ts`:

- **Revive**: remove the stale file-wide `test.skip` from the two describe
  blocks (CLI-present, CLI-absent) and adopt the
  `page.waitForFunction(() => "ai14all" in window)` preload guard used by
  the active suites. The individually-skipped modal micro-tests (Escape /
  overlay / focus) stay as they are — out of this sub-project's scope.
- **Extend** with the guard-status path (temp-HOME fixture, CLI shims as in
  the existing CLI-present block):
  1. Seed the temp HOME with an installed `SKILL.md` whose `version` is
     **higher** than the bundled one → install → per-provider result is
     `ok: true` with a message containing "skipped — newer version
     installed", and the seeded file's content is byte-unchanged.
  2. Seed with a copy **equal** to the bundled version → install → message
     is "Already up to date" and the file is byte-unchanged (zero-write).
  3. Modal path: open the install modal, run install against the seeded
     equal-version HOME, and assert the visible status text shows the
     up-to-date message, not "Installed ✓".
- If revival surfaces a genuine harness blocker even with the guard, fixing
  that harness gap becomes explicit in-phase work — it must not be silently
  re-skipped; e2e coverage accumulates per AGENTS.md.

## 6. Uninstall softening (umbrella §5)

Replace, in all three providers, the whole-directory
`rm(dir, { recursive: true, force: true })` with, per skill id:

1. `rm(join(dir, "SKILL.md"), { force: true })`
2. `rm(join(dir, "SKILL.md.ai-14all.tmp"), { force: true })` (stray tmp from
   an interrupted install — also something install writes)
3. `rmdir(dir)`, swallowing `ENOENT`/`ENOTEMPTY` — the directory disappears
   only when uninstall's own removals emptied it

Symmetric with what install writes; locally installed `evals/` (or any other
user files) survive. MCP deregistration paths unchanged.

**Tests (first)** — rewrite the three provider uninstall tests: (a) dir with
`SKILL.md` + `evals/evals.json` → after uninstall, `SKILL.md` gone, `evals/`
intact, dir present; (b) dir with only `SKILL.md` → dir fully removed; (c)
missing dir → uninstall still succeeds (force semantics preserved).

## 7. Assets update + formatting

- Copy the six files of §4 bit-for-bit (byte-identical; verified by diff
  against `git show 91890bb:<path>`).
- Add `assets/agent-skills/` to `.prettierignore` — required (verified §2:
  calibrated content fails `prettier --check`); the bit-for-bit provenance
  rule outranks repo formatting for these vendored artifacts.
- `skill-asset.ts` untouched; `tests/unit/review/skill-asset.test.ts` must
  stay green (loader reads only `SKILL.md`, so added `evals/` dirs are
  invisible to it).

## 8. CI skills QA + governance (umbrella §6)

**Dependency**: add `shakespii: ^0.3.1` to `devDependencies` (public npm; no
private-repo dependency). Developers get the same binary locally via
`pnpm exec shakespii`.

**Script** `scripts/ci/skills-qa.mjs` (single entry point, runnable locally),
for each of the two bundled skill dirs:

1. `shakespii lint <dir> --json` — any error-severity finding fails; warnings
   printed.
2. `shakespii test <dir> --json` — deterministic harness checks only (bare
   form; **no `--run`**, no live sweeps in CI per the umbrella spec).
3. Assert `SKILL.md` frontmatter has a parseable `version:` (keeps the §5.2
   defensive row unreachable).
4. Changed-content-needs-version-bump: resolve the latest release tag
   (`git describe --tags --abbrev=0 --match "v*"`); if the skill directory's
   content differs from that tag but the `version:` value is unchanged, fail.
   Scope: whole skill directory (umbrella-literal — an evals-only tweak also
   requires a bump; see Open Decision D2). First run passes trivially:
   `v1.3.0` has versionless templates, so content changed **and** version
   changed (none → `0.1.0`).

**Workflow** `.github/workflows/skills-qa.yml`: dedicated workflow,
`on: push: branches [master]` + `pull_request: branches [master, devel]`
(mirrors the union of the two gates; see Open Decision D3);
`runs-on: ubuntu-latest`; `actions/checkout@v4` with `fetch-depth: 0` (tag
resolution for step 4); node 24 + corepack;
`pnpm install --frozen-lockfile --ignore-scripts` (shakespii needs no build
scripts; skips the electron toolchain); `node scripts/ci/skills-qa.mjs`.

**AGENTS.md** — new "Bundled agent skills" section: ai-14all owns these two
skills; content originates bit-for-bit from `ai-skills @ 91890bb`; **any
content change to a bundled skill directory must bump the `version`
frontmatter** (guarded installers silently skip unbumped content);
calibration workflow = edit here → `pnpm exec shakespii lint/test` → bump
version → PR; installed live copies are never hand-edited.

## 9. Packaging (Decision D1: exclude evals — approved)

The built `.app` does **not** ship `evals/` inside
`Resources/assets/agent-skills/`. The installer writes only `SKILL.md`
either way; evals are dev/CI assets.

**Option A — exclude (approved)**: matches the assets' dev/CI nature; the
app carries only what it can install. Mechanism (verified against
electron-builder file-pattern docs: FileSet `filter` supports `!` negation;
the `${/*}` macro excludes the directory itself, avoiding empty dirs):

```yaml
extraResources:
  - from: assets/agent-skills
    to: assets/agent-skills
    filter:
      - "**/*"
      - "!*/evals${/*}"
```

Acceptance: build once, inspect
`<app>/Contents/Resources/assets/agent-skills/` — two skill dirs, one
`SKILL.md` each, no `evals/`; `skill-asset` resolution still hits the
canonical prefix.

**Option B — ship evals (rejected)**: keep the one-line glob unchanged;
~11 KB extra; zero packaging-config risk. Harmless but blurs the runtime/dev
asset line.

## 10. Release (closing step) and acceptance

**Release**: after U1–U4 are merged and verified — full verification before
tagging per standing release rules (full e2e suite to green; CHANGELOG.md
updated **before** `pnpm release:stable`). Bump: **minor → v1.4.0** (behavior
change: guard + softened uninstall + new assets). `release.yml` builds and
publishes from the tag.

**Sub-project acceptance** (live corpus already calibrated):

1. From the released `.app`, run the install action for claude-code: both
   skills report **up to date**; zero writes (each installed `SKILL.md`
   mtime unchanged and bit-identical to `ai-skills @ 91890bb`).
2. Uninstall semantics: verified by the §6 unit tests, plus a manual check
   against a sandbox `HOME` (not the live corpus — a live uninstall would
   remove the real `SKILL.md`): `evals/` survives, `SKILL.md` removed,
   directory retained.
3. Packaged asset audit per §9's chosen option.
4. `tests/e2e/agent-skill-install.test.ts` runs unskipped in the full e2e
   suite and covers the up-to-date / skipped-newer status paths (§5.6) —
   the "full e2e green before tagging" gate therefore exercises the new
   user-visible behavior, satisfying the AGENTS.md e2e rule.

**Accepted risk carried from the umbrella spec**: already-released app
versions keep clobbering until users update — this release is the mitigation,
and flags the sub-project as closed only once shipped.

## 11. Resolved decisions (approved 2026-07-12)

- **D1** Packaging: **exclude `evals/`** from the `.app` (Option A) via the
  FileSet filter in §9.
- **D2** Version-bump CI scope: **whole skill directory** (umbrella-literal)
  — any change under `assets/agent-skills/<skill>/`, evals included,
  requires a `version` bump.
- **D3** CI placement: **dedicated `.github/workflows/skills-qa.yml`** —
  push to master + PRs to master/devel, ubuntu-latest,
  `pnpm install --frozen-lockfile --ignore-scripts`.
