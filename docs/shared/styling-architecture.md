# Styling Architecture

All app CSS flows through `src/styles/index.css`, which declares the cascade:

    @layer theme, base, components, utilities, app.base, app.components, app.themes;

(first four = Tailwind v4's own layers). `app.themes` beats `app.components`
beats `app.base` beats Tailwind utilities — later layer wins regardless of
specificity or import order.

## Rules

1. **Where styles go:** the feature module that owns the selector, under
   `src/styles/modules/` (sidebar, terminals, review, files, viewer, dialogs,
   usage, plugins, md-preview, primitives) or `base.css` for fonts/resets/app
   frame. Never a new catch-all file; never a CSS import in `main.tsx`.
2. **Module anatomy:** every module wraps ALL rules in top-level
   `@layer app.components { … }` (or `app.base`) with per-theme structural
   overrides in a trailing sibling `@layer app.themes { … }`. Modules are
   imported PLAIN in index.css — a `layer(...)` import would nest the inner
   `@layer app.themes` under it and invert the cascade (css-cascade-5:
   a layer's direct rules beat its nested sublayers). Sole exception:
   `hljs-tokens.css` (no `@layer` blocks inside) is imported with
   `layer(app.components)`.
3. **Theming:** `tokens.css` is the complete theme core — dark defaults in
   `:root`, overrides in `[data-theme="light"|"warm"|"tui"]`. A custom
   property overridden by ANY theme lives only there. Component-local
   parameters (e.g. `.tui-box`'s `--box-border-width`) stay in their module
   and must never appear in a `[data-theme]` block — the moment a theme wants
   to vary one, move all its declarations to tokens.css.
4. **New theme recipe:** add one token block to tokens.css → capture the
   ui-gallery screenshots across palettes → add structural overrides in
   `app.themes` blocks only where something breaks.
5. **Enforcement:** `scripts/ci/check-css-architecture.mjs` (runs in
   `pnpm lint`) checks all of the above. If it fails, fix the placement —
   do not relax the script. Pixel guardrail:
   `pnpm test:e2e -- css-refactor.visual` (baselines are intentional-change
   only: regenerate with `--update-snapshots` and say why in the commit).
