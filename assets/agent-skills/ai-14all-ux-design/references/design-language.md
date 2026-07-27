# Design language — terminal/TUI on the shadcn token system

This file orients; the live files decide. Before designing anything, verify
every value you rely on against the sources below — values drift, and this
reference does not.

## Sources of truth

- `src/styles/tokens.css` — color, radius, spacing, and type-ladder tokens.
  Theme blocks: `:root` (dark, the default), `[data-theme="light"]`,
  `[data-theme="warm"]`, `[data-theme="tui"]` — search the block headers,
  line numbers drift.
- `src/styles/base.css` — font tokens (`--font-ui`, `--font-terminal`,
  `--font-reading`) and the Nerd Font glyph utility
  (`.app-nf::before { content: attr(data-nf) }`).
- `src/app/shell.css` and `src/styles/modules/*.css` — surface-specific
  rules per feature area (dialogs, sidebar, terminals, review, plugins,
  usage, viewer, files, md-preview, primitives).
- `docs/design-specs/tui-css-spec.md` — the TUI technique reference
  (character grid, stepped color ladder, box-drawing borders).
- `docs/design-specs/theme-wcag-aa-spec.md` — the accessibility floor;
  `theme-wcag-aaa-spec.md` is the aspirational reference.

## The four themes

`dark` (`:root`, no attribute), `light`, `warm`, and `tui`, selected via
`data-theme`. The TUI traits below deliberately apply to **all four** — the
`tui` theme is the purest expression, not the only carrier.

## TUI traits — the non-negotiables

| Trait | Rule | Deliberate exceptions |
|---|---|---|
| Corners | `--radius: 0rem`; every `var(--radius*)` and utility radius resolves to 0 | circular status dots (`border-radius: 50%`), explicit `999px` pills |
| Separators | solid, full-opacity token colors (dark base `--border` is white/10%); never dashed | — |
| Elevation | none: no `box-shadow`, no glossy cards; "elevation" = a surface-token step plus a solid border | dark/warm keep subtle radial *background* gradients (page background only, never component decoration) |
| Chrome type | `--font-ui` (SF Mono stack); terminal content `--font-terminal` (Meslo Powerline stack) | the markdown document body uses `--font-reading` (Hanken Grotesk) in ALL themes including tui — user-approved; code inside the preview stays `--font-terminal`; all other chrome stays monospace |
| Icons | Symbols Nerd Font monochrome glyphs via `.app-nf` | — (never emoji, never colorful badges) |
| Color | oklch blue-tinted palette from tokens (dark bg ≈ `oklch(0.129 0.042 264.7)`, card ≈ `0.208`, muted-fg ≈ `0.704`); provider accents `--provider-claude/-codex/-ezio/-cursor/-antigravity`; status tokens `--success/--warning/--danger/--info/--ready` | — |
| States | hover/emphasis move a ladder step or swap tokens — never alpha-blend (`rgba(255,255,255,.08)`-style hovers do not exist here) | — |
| Sizing | spacing ladder `--space-1..6` (4–24px); per-surface type ladders (e.g. `--ws-fs-*`); the tui theme sizes in character cells (`--cell-w: 1ch`, `--cell-h: 1lh`) | — |

## Accessibility floor

- WCAG AA contrast per `docs/design-specs/theme-wcag-aa-spec.md`, verified
  per theme — light-theme text-on-surface pairs are the common casualty.
- Motion restrained; `prefers-reduced-motion` respected.

## Quality bar — what "production grade" means at review

- One visual anchor per surface; hierarchy comes from the type ladder and
  spacing ladder, never from novel one-off sizes.
- Empty, loading, and error states are designed, not left to defaults.
- Keyboard reachability for every interactive element.
- Destructive actions confirm before acting, with a persistent
  "don't ask again" preference (established app pattern: terminal
  restart/close confirmation).
- Mockups and screenshots use realistic content, never lorem ipsum.

## In-app charts addendum — composing with dataviz

- The dataviz skill owns chart-form craft: form choice, marks, axes,
  legends, interaction rules. Load it for any chart work; never restate or
  fork its guidance here.
- This skill owns the integration layer:
  - Swap dataviz's brand-neutral placeholder palette for app tokens:
    provider series use `--provider-*`; status series use
    `--success/--warning/--danger/--info`; neutrals come from the muted
    ladder.
  - Chart chrome follows the TUI traits: solid full-opacity gridlines and
    axes on border tokens, monospace axis/legend/tooltip type
    (`--font-ui`), square legend swatches, no shadows, no rounded plot
    frames.
- App-specific chart rules apply on top of both skills. Known example:
  week-mode activity charts always render at least seven days with the
  current day of week indicated, even when the data spans fewer days —
  a partial week reads as visually broken. When memory tools are present,
  recall chart rules (tags `charts`, `usage-analytics`) before designing a
  chart surface; rules like these live in memory, not in CSS.

## Conformance checklist (procedure phase 6)

Confirm every line in **all four themes** before claiming the work done:

- [ ] Corners square via the radius tokens; only status dots and pills round
- [ ] Borders and separators solid, full-opacity, token-sourced; none dashed
- [ ] No `box-shadow`; no gradient decoration on components
- [ ] Chrome on `--font-ui`; terminal content on `--font-terminal`;
      `--font-reading` only on the markdown document body
- [ ] Icons are Nerd Font glyphs (`.app-nf`); no emoji anywhere
- [ ] Every color from tokens; states step the ladder; no alpha-blend hovers
- [ ] Spacing from `--space-*`; type sizes from the surface's ladder
- [ ] Empty, loading, and error states present
- [ ] Destructive actions confirmed, with a don't-ask-again preference
- [ ] Keyboard reachable; `prefers-reduced-motion` respected
- [ ] WCAG AA contrast verified against the theme spec
- [ ] Rendered and checked in dark, light, warm, AND tui
