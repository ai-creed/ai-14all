# Research playbook — internal-first UX research

Order is fixed: internal inventory → gap check → external references.
External research never comes first; consistency with the app beats novelty.

## 1. Internal inventory

- **Existing surfaces:** find screens already solving a similar *design
  problem* (dense list, status board, wizard, configuration form) —
  `src/features/<area>/components/` and the running app. Name candidates by
  the problem they solve, not their domain.
- **Design docs:** `docs/design-specs/` (UI-scoped specs and their
  `-prototype.html` files) and prior `docs/superpowers/specs/*-design.md`
  (feature specs whose UI sections were approved).
- **Memory:** when ai-cortex tools are present, recall design rules scoped
  to the area (tags `ui`, `design`, `charts`, the feature name) and fetch
  any hit you will apply.
- Output: a short list — precedent → what it solves → the reusable pattern.

## 2. Gap check

- A precedent covers the interaction pattern → adapt it and cite it in the
  design doc. Skip external research entirely.
- No precedent covers the *pattern* (a new domain alone is not a gap — a
  list of new things is still a list) → proceed to external references.

## 3. External references — only on a real gap

- Pick two or three references from the terminal-aesthetic / developer-tool
  space. The app's TUI base already studied WebTUI
  (`docs/design-specs/tui-css-spec.md`); other proven candidates: lazygit,
  btop, Warp, Zed, Linear — plus anything the user explicitly asks to mimic.
- Use WebSearch/WebFetch when available; without network access, work from
  existing knowledge and say so in the design doc.
- Capture **patterns**: hierarchy, information density, state handling,
  affordances, navigation — the reason the reference works.
- Never import **identity**: foreign radii, shadows, fonts, palettes, or
  illustration styles. Every borrowed pattern is translated into app tokens
  and TUI traits before it reaches the mockup.

## 4. Recording

- Condense findings into at most three design options with trade-offs and a
  recommendation; the user picks at (or before) mockup iteration.
- Name the references used in the design doc so the provenance of the
  pattern survives review.
