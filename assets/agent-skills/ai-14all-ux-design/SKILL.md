---
name: ai-14all-ux-design
description: "Use when designing, restyling, polishing, or reviewing ai-14all app UI — a new screen, panel, dialog, dashboard, or visual rework ('design the dashboard panel', 'this dialog looks unpolished', 'does this follow the app design theme?') — enforces the terminal/TUI design language across all four themes, gates major UI work behind a live HTML mockup before any spec or code, and researches internally first. In-app charts compose with dataviz via app tokens; not for mobile apps or non-14all pages."
version: 0.1.0
---

# ai-14all-ux-design

## Intent

New 14all features have repeatedly shipped with under-designed UI, costing
several polish-and-retest rounds before reaching production quality. This
skill closes that gap: it enforces the app's terminal/TUI design language on
every UI change and gates major UI work behind a user-approved live HTML
mockup before any spec is finalized or implementation written — design
converges before code, not after.

## Inputs

- The UI request: a new surface (screen, panel, dialog, dashboard), a visual
  rework of an existing one, a polish pass, or a design review of proposed UI.
- For the mockup gate: the user available to review the prototype — or, in an
  autonomous run, approval granted in the prompt up to a stated point.
- Optional: area context (feature name, target files); for chart work, the
  data shape to visualize.

## Preconditions

- cwd is inside an ai-14all worktree: `src/styles/tokens.css`,
  `src/styles/base.css`, `src/app/shell.css`, `src/styles/modules/`, and
  `docs/design-specs/` resolve. Without them the design language cannot be
  verified — stop and say so rather than designing from memory. One
  exception: when the requester explicitly supplies token values as the
  verified live values (a design discussion outside the worktree, a
  sandbox), proceed on exactly those values and record their provenance in
  the output.
- Prototypes are plain self-contained HTML the user opens in a browser: no
  build step, no external assets, system-font fallbacks for SF Mono/Meslo.
- For in-app chart work: the dataviz skill is loadable; when it is not,
  apply the chart addendum in
  [references/design-language.md](references/design-language.md) alone and
  say so.
- ai-cortex memory tools are optional: when present, phases 2–3 recall
  area-scoped design rules; when absent, the reference files and
  `docs/design-specs/` carry the floor.

## Procedure

1. **Classify.** Major = any new user-visible surface or a visual rework of
   an existing one (screen, panel, dialog, dashboard). Minor = copy, spacing,
   or single-control fix that changes no layout or hierarchy. Major → phases
   2–6; minor → phases 2 and 6 only. Borderline cases are major — a wrong
   "minor" skips the gate this skill exists for.
2. **Ground.** Read
   [references/design-language.md](references/design-language.md), then
   verify its claims against the live sources: `src/styles/tokens.css`,
   `src/styles/base.css` (fonts, glyphs), `src/app/shell.css`, and the
   relevant `src/styles/modules/*.css`. The
   reference orients; the live files decide. When memory tools are
   available, recall design rules scoped to the touched area (tags like
   `ui`, `design`, `charts`, or the feature name) — app-specific rules such
   as "week-mode charts render at least seven days" live there, not in CSS.
   For chart work, also load the dataviz skill now.
3. **Research, internal-first.** Follow
   [references/research-playbook.md](references/research-playbook.md):
   inventory internal precedents (surfaces already solving a similar
   problem, `docs/design-specs/`, prior `*-design.md` specs). Adapt a
   precedent when one covers the interaction pattern. Only when none does,
   study two or three external references and translate *patterns* — never
   visual identity — into app tokens and traits.
4. **Mockup hard gate (major only).** Build a self-contained prototype per
   [references/mockup-contract.md](references/mockup-contract.md) at
   `docs/design-specs/YYYY-MM-DD-<topic>-prototype.html`: token blocks
   mirrored verbatim from `tokens.css` for all four themes (dark, light,
   warm, tui), a theme switcher, and interactions stubbed just enough to
   judge hierarchy and states. Present it, iterate until the user approves.
   **Do not finalize a spec and do not write implementation code before the
   mockup is approved.**
5. **Consolidate the spec.** Write the design doc beside the prototype
   (`docs/design-specs/` for UI-scoped work, or the feature's spec location
   when the UI is part of a larger spec): reference the approved prototype,
   record decisions, and include a current-state → target table. Note the
   approval date. If the session carries a user preference for mirroring
   generated docs to a central location, apply it to the design doc too.
6. **Implement and verify conformance.** Apply the conformance checklist at
   the end of
   [references/design-language.md](references/design-language.md) — square
   corners, solid separators, no shadows, monospace chrome, glyphs not
   emoji, ladder-step states, existing tokens only, designed
   empty/loading/error states, confirmed destructive actions, WCAG AA — and
   confirm every item **in all four themes** before claiming the work done.

## Output

- **Major work:** a committed prototype
  (`docs/design-specs/YYYY-MM-DD-<topic>-prototype.html`), a design doc
  referencing it with recorded approval, and — when implementation is part
  of the task — code that passes the conformance checklist in all four
  themes, stated explicitly in the final message.
- **Minor work:** the conforming change plus a one-line conformance
  confirmation (tokens used, themes checked) in the final message.
- **Design review:** a verdict listing each violation with the specific
  design-language rule it breaks, or an explicit pass.

## Examples

Real occurrence — the workspace panel rework (2026-06-24).

Input: rework the left Workspace sidebar from a flat worktree-card list into
a collapsible repo → worktree git tree, based on a user mockup image.

Actions taken: tokens read from `src/styles/tokens.css` and provider colors
from `src/app/shell.css`; a self-contained prototype was built at
`docs/design-specs/2026-06-24-workspace-panel-rework-prototype.html` with
token blocks mirrored verbatim per theme (`[data-theme="dark"] {
--background: oklch(0.129 0.042 264.695); … }`) and iterated interactively
with the user; only then was the spec
`docs/design-specs/2026-06-24-workspace-panel-rework-design.md` written.

Output (spec excerpt): "**Status:** Design approved (2026-06-24) via an
interactive prototype iterated with the user. Not yet implemented." — with a
current-state → target table (flat cards → 2-depth tree on a solid 2px rail,
one `--ws-fs-*` typography ladder) and a new `--rail` token defined once per
theme. All four themes benefit from one structural change.

## Anti-patterns

- **Mocking the app as generic IDE/SaaS chrome** — rounded panels, drop
  shadows, dashed pill chips, emoji callouts. A 2026-07-02 design-critique
  mockup did exactly this and was rejected for losing the terminal spirit.
  Read the tokens before drawing anything.
- **Implementing before mockup approval.** The user's stated reason for the
  gate: drift found after implementation costs far more to fix than drift
  found in a prototype.
- **Inventing tokens or raw values** when a ladder token exists —
  `gap: 3px` instead of `var(--space-1)`, a new gray instead of a
  `--muted-foreground` step.
- **Alpha-blended hovers or dashed borders.** State changes step the color
  ladder; separators are solid and full-opacity.
- **Verifying only the dark theme.** Every surface ships in dark, light,
  warm, and tui; light-theme contrast breaks are the common casualty.
- **Forking dataviz's chart craft into this skill.** For in-app charts,
  dataviz stays authoritative for chart form, marks, and interaction; this
  skill adds the 14all surface, theming, and app-specific chart rules on
  top. Neither replaces the other.
- **Using this skill outside the app** — mobile screens (mobile-design),
  charts outside 14all (dataviz alone), non-app web pages (frontend-design).
