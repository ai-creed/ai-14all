# Spec: `ai-14all-ux-design` Agent Skill

**Status:** Design approved (2026-07-27) interactively with Vu, including the
in-app-charts scope amendment. Not yet drafted.
**Scope:** A new agent skill, authored in `assets/agent-skills/ai-14all-ux-design/`,
that governs all ai-14all desktop-app UI/UX work: design-language enforcement,
a mockup-first hard gate for major UI updates, internal-first UX research, and
in-app dashboard/chart design.
**Process:** Implementation follows the authoring-skills phases (draft → critique →
refine → present) — no separate writing-plans doc, per memorized resolution
`mem-2026-07-27-skill-authoring-authoring-skills-phases-00dcc1`.

## 1. Problem

New 14all features routinely ship with under-designed or unpolished UI/UX,
forcing multiple UI/UX testing rounds before production quality is reached.
The design knowledge that would prevent this exists — the TUI design language,
token system, WCAG theme specs, mockup-first precedent, and design memories —
but nothing forces an agent to consult it before building UI. The skill turns
that scattered knowledge into an enforced workflow.

## 2. Grounding (what the skill builds on)

- **Design language:** terminal/TUI aesthetic on the shadcn token system, applied
  to ALL four themes (`dark`/`:root`, `light`, `warm`, `tui`). Square corners
  (`--radius: 0rem`), solid full-opacity separators, zero elevation (no shadows),
  monospace chrome (`--font-ui` SF Mono, `--font-terminal` Meslo), Symbols Nerd
  Font glyphs (never emoji), oklch palette + per-provider accent tokens,
  character-grid sizing (`ch`/`lh`) where the tui theme applies. One approved
  exception: `--font-reading` (Hanken Grotesk) on the markdown document body only.
  Sources: `src/styles/tokens.css`, `src/app/shell.css`, `src/styles/modules/*.css`,
  `docs/design-specs/tui-css-spec.md`, memory
  `mem-2026-07-02-ai-14all-ui-honors-a-terminal-tui-b2fde5`.
- **Mockup-first precedent:** `docs/design-specs/2026-06-24-workspace-panel-rework-design.md`
  + `-prototype.html` — a self-contained prototype with token blocks mirrored
  verbatim per theme, iterated with the user before the spec was approved.
  Preference memory `mem-2026-07-18-i-would-prefer-seeing-the-mockup-in-d148c1`.
- **Accessibility bars:** `docs/design-specs/theme-wcag-aa-spec.md` (the floor),
  `theme-wcag-aaa-spec.md` (aspirational reference).
- **Chart-scope example rule:** `mem-2026-06-29-users-vuphan-desktop-screenshot-2026-06-6aea4e`
  (week-mode charts render ≥7 days, current weekday on top) — the kind of
  in-app chart rule the skill's Ground phase must surface.

## 3. Skill identity

- **Name:** `ai-14all-ux-design` (repo `ai-14all-` prefix convention; scope explicit
  in the installed corpus next to generic design skills).
- **Location:** `assets/agent-skills/ai-14all-ux-design/`; installed to
  `~/.claude/skills` only via `shakespii install` with explicit approval.
- **Description (trigger-first, drives firing):**

  > Use when designing, restyling, polishing, or reviewing ai-14all desktop app
  > UI — a new screen, panel, dialog, dashboard, or a visual rework of an existing
  > surface ("design the usage dashboard panel", "this dialog looks unpolished",
  > "add a settings screen", "does this follow our design theme?") — enforces the
  > app's terminal/TUI design language across all four themes, gates every major
  > UI update behind a live HTML mockup consolidated into the design spec before
  > implementation, and runs internal-first UX research with external references
  > only when no internal precedent exists. In-app 14all dashboards and charts are
  > in scope (compose with the dataviz skill for chart-form craft, app tokens as
  > the palette). Not for mobile app UI (mobile-design), charts outside the app
  > (dataviz alone), or non-14all web pages (frontend-design).

  Exact wording may be tuned during the trigger-accuracy loop; scope must not drift.

## 4. Structure

Option B — lean SKILL.md workflow + `references/` depth (progressive disclosure):

- `SKILL.md` — the 6-phase loop (§5), examples, anti-patterns.
- `references/design-language.md` — distilled TUI traits, token map, theme list,
  reading-font exception, WCAG pointers, in-app chart addendum (§6).
- `references/research-playbook.md` — internal inventory procedure; criteria and
  method for external reference research.
- `references/mockup-contract.md` — prototype file conventions.

Rejected: (A) monolithic SKILL.md (fails progressive disclosure); (C) separate
design + research skills (research is one phase; doubles trigger-boundary surface).

## 5. Procedure (SKILL.md core loop)

1. **Classify.** Major = any new user-visible surface (screen, panel, dialog,
   dashboard) or a visual rework of an existing one → full gate (phases 2–6).
   Minor = copy, spacing, or single-control fix → phases 2 and 6 only.
2. **Ground.** Read `references/design-language.md`, then verify against the live
   sources (`src/styles/tokens.css`, `src/app/shell.css`, relevant
   `src/styles/modules/*.css`) and `recall_memory` for design rules scoped to the
   touched area. Never design from the reference alone — the 2026-07-02 mockup
   rejection happened because tokens weren't read first.
3. **Research (internal-first).** Inventory internal precedents: similar existing
   surfaces, `docs/design-specs/`, prior `docs/superpowers/specs/*-design.md`.
   Only when no internal precedent covers the interaction pattern, study 2–3
   external references (terminal-aesthetic tools, modern IDE/dev apps) per the
   playbook; record options with trade-offs.
4. **Mockup hard gate (major only).** Build a self-contained live prototype at
   `docs/design-specs/YYYY-MM-DD-<topic>-prototype.html`: token blocks mirrored
   verbatim from `tokens.css` for all four themes, a theme switcher, interactions
   stubbed enough to judge hierarchy and states. Iterate with the user until
   approved. **No finalized spec and no implementation before mockup approval.**
5. **Consolidate spec.** Write the design doc referencing the approved prototype:
   decisions, current-state → target tables (workspace-panel-rework doc is the
   template). Honor the local-docs mirror preference for generated docs.
6. **Implement + conformance checklist.** Square corners; solid full-opacity
   separators; no shadows or gradient decoration; monospace chrome
   (reading-font exception only on markdown body); Nerd Font glyphs, not emoji;
   ladder-step hovers, not alpha blends; existing spacing/type tokens — never
   invented values; loading/empty/error states designed; destructive actions
   confirmed; WCAG AA per theme specs; verified in ALL four themes.

## 6. In-app charts and the dataviz boundary (amendment)

The skill also serves 14all's internal dashboard work (current WIP in the
`dashboard-design` worktree), so in-app charts are first-class scope:

- **This skill governs** the dashboard surface: layout, panel chrome, theming,
  tokens, TUI traits, the mockup gate, and app-specific chart rules surfaced from
  memory (e.g. week-mode ≥7 days).
- **dataviz stays authoritative** for chart-form craft: form choice, marks, axes,
  legends, interaction rules. When actually building a chart, the agent loads
  dataviz TOO and composes: dataviz's brand-neutral placeholder palette is
  swapped for 14all tokens (dataviz explicitly supports this), and its chart
  guidance is applied inside this skill's surface/theming constraints.
- **No interference rule:** this skill must not restate or fork dataviz's chart
  guidance; it only adds the 14all integration layer. Charts outside the 14all
  app are out of scope entirely.

## 7. Examples and anti-patterns (SKILL.md content plan)

- **Worked example:** the real workspace-panel-rework pair — request → prototype
  (`2026-06-24-workspace-panel-rework-prototype.html`) → approved spec.
- **Anti-patterns** (each from a real failure): generic SaaS-chrome mockups
  (rounded panels, shadows, emoji callouts — rejected 2026-07-02); implementing
  before mockup approval; inventing tokens instead of using the ladder; dashed
  borders; checking only the dark theme; restating dataviz chart craft inline.

## 8. Eval plan

`evals/evals.json` — 5 behavior branches:
1. Major-classification: new panel request → mockup-first plan on real tokens,
   all four themes, before any spec/implementation.
2. Minor tweak: spacing fix → conformance checklist only; no mockup demanded.
3. Review branch: a non-conforming design (rounded corners, emoji, shadows) →
   flags concrete token violations with file-level citations.
4. Research branch: novel interaction pattern → internal inventory first,
   external references only after no precedent found.
5. Dashboard/chart branch: in-app chart request → composes with dataviz for
   chart form, applies app tokens as palette + surface rules from this skill.

`evals/triggers.json` — ~18 labeled queries: positives across design/polish/
review/dashboard phrasings; near-miss negatives routing to mobile-design
(Expo screen), dataviz alone (chart outside the app), frontend-design (non-app
web page), plain CSS refactoring, and test authoring.

**Gates (token spend approved 2026-07-27):** `shakespii lint` to exit 0;
`shakespii test --run --triggers` iterated to accuracy ≥ 0.8 without regressions;
`shakespii bench` for the with/without capability delta.

## 9. Out of scope / decisions log

- Not a generic design skill: content is 14all-specific by construction.
- Installation is a separate explicitly-approved act (`shakespii install`).
- Mockup-gate threshold: "any new/reworked surface" (chosen over multi-surface-only
  and agent-judgment variants).
- Research mode: internal-first (chosen over always-benchmark and internal-only).
- Skill-authoring process: authoring-skills phases govern; no writing-plans doc
  (memorized, global).
