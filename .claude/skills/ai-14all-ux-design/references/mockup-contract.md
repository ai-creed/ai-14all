# Mockup contract — live HTML prototypes

The mockup is the design decision record the user approves before any spec
is finalized or code written. Its format is fixed so every prototype is
comparable and every approval unambiguous.

## File

- Path: `docs/design-specs/YYYY-MM-DD-<topic>-prototype.html`; the companion
  design doc shares the stem (`…-design.md`).
- Single self-contained file: no external assets, CDNs, or build step. Font
  stacks use system fallbacks (`"SF Mono", Menlo, monospace`; mock terminal
  text with the same stack).

## Tokens

- Token blocks are mirrored **verbatim** from `src/styles/tokens.css` into
  `[data-theme="dark"]`, `[data-theme="light"]`, `[data-theme="warm"]`, and
  `[data-theme="tui"]` blocks, with a comment citing the source. Copy real
  values — never eyeball or invent them. Pull provider accents and any
  surface-specific tokens from `src/styles/tokens.css` / `src/app/shell.css`
  the same way.
- A new token the design introduces (like the workspace rework's `--rail`)
  is declared once per theme in the prototype and called out in the design
  doc as a token addition.

## Behavior

- A visible theme switcher (buttons setting
  `document.documentElement.dataset.theme`); default `dark`.
- Stub interactions just enough to judge hierarchy and states: hover,
  active/selected, and the empty/loading/error states the surface actually
  has. Fake data must read as realistic.
- TUI traits hold in the mockup exactly as in the app: square corners,
  solid separators, no shadows, glyphs not emoji, monospace type.

## Iteration and approval

- Present the prototype, collect feedback, revise the same file — do not
  fork variants into new files unless the user asks for a side-by-side.
- Record approval and its date in the companion design doc; the prototype
  stays committed as the canonical design reference.
- Precedent to copy:
  `docs/design-specs/2026-06-24-workspace-panel-rework-prototype.html`.
