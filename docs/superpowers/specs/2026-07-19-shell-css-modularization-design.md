# shell.css Modularization + Shared Theme Core — Design

- **Date:** 2026-07-19
- **Status:** Approved (brainstorm with Vu, session `splitting-styling-css`)
- **Execution:** single spec, single SDD run, strangler slice-by-slice
- **Canonical copy:** `~/.ai-pref-nsync/local-docs/ai-14all/specs/2026-07-19-shell-css-modularization-design.md` (this in-repo file is the synced mirror)

## 1. Problem

`src/app/shell.css` has grown to **6,658 lines** — a monolith of handwritten
`.shell-*` component classes. Theme correctness depends on fragile mechanics:

- Theme variance mostly flows through tokens (good), but structural theme
  overrides scatter across shell.css (14 `[data-theme]` rules) **and**
  `src/styles/tui.css` (77 rules, a separate file that must load after
  shell.css).
- The cascade depends on import order in `src/main.tsx`
  (`tokens.css → shell.css → tui.css → hljs-tokens.css`) and on ad-hoc
  specificity battles. Editing shell.css silently misses tui.css overrides —
  the observed drift pattern.
- Light/warm theme blocks squat inside shell.css (lines 74–135): token
  redefinitions (74–86, 113–125) that belong in `tokens.css`, interleaved with
  structural overrides (body backgrounds, tab hovers) that belong with their
  features.

Adding a new theme today means auditing 6.6k lines. This design splits the
monolith into feature modules over an explicit `@layer` cascade, with a single
token core as the theme contract.

## 2. Decisions (from brainstorm)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | Split into modules **and** consolidate theme/cascade architecture (not a byte-identical mechanical move) |
| D2 | Tooling | **Plain modern CSS.** No Sass/Less: Electron = fixed modern Chromium (native nesting, `@layer`, `oklch`); runtime theming requires custom properties anyway (Sass vars compile away); Tailwind v4 is the build pipeline and is not designed to pair with preprocessors |
| D3 | Module location | Central `src/styles/` with one entry (`index.css`) declaring layer order + imports; class names stay global `.shell-*` — zero TSX/e2e churn |
| D4 | Theme structural overrides | Co-located **inside the owning feature module** in an `app.themes` layer block — not in per-theme files (kills the shell.css↔tui.css blind-spot drift) |
| D5 | Migration | Strangler, slice-by-slice, but one spec resolved in **one SDD run** |
| D6 | Verification | Playwright pixel-diff (`toHaveScreenshot`) as best-effort per-slice guardrail; slices that can't use it verify manually instead |

## 3. Target architecture

### 3.1 Entry point and cascade authority

`src/main.tsx` imports exactly one stylesheet: `src/styles/index.css`
(the `@fontsource-variable/hanken-grotesk` and `xterm.css` imports are
unrelated vendor CSS and stay where they are).

```css
/* src/styles/index.css — THE cascade authority */
@layer theme, base, components, utilities, app.base, app.components, app.themes;

@import "./tokens.css";                     /* pulls tailwindcss; its own
                                               `@layer theme, base, components, utilities;`
                                               statement is a no-op re-declaration */
@import "./base.css" layer(app.base);
@import "./modules/primitives.css" layer(app.components);
@import "./modules/sidebar.css" layer(app.components);
@import "./modules/terminals.css" layer(app.components);
@import "./modules/review.css" layer(app.components);
@import "./modules/files.css" layer(app.components);
@import "./modules/viewer.css" layer(app.components);
@import "./modules/dialogs.css" layer(app.components);
@import "./modules/usage.css" layer(app.components);
@import "./modules/plugins.css" layer(app.components);
@import "./modules/md-preview.css" layer(app.components);
@import "./hljs-tokens.css" layer(app.components);
```

Verified facts this relies on:

- Tailwind v4's entry (`node_modules/tailwindcss/index.css`) begins with
  `@layer theme, base, components, utilities;` — our statement lists the same
  four names first, in the same order, so whichever file the bundler emits
  first fixes an identical order.
- Layer order beats specificity for normal declarations. `app.*` layers come
  after `utilities`, so app rules keep beating Tailwind utilities — the same
  effective result as today's unlayered-beats-layered relationship.
- `app.base < app.components < app.themes` means theme overrides **always**
  win over component rules regardless of specificity or import order. Import
  order stops being load-bearing.

### 3.2 Module map

Carved along shell.css's existing section comments; target ~300–800 lines per
module. Every rule lands in exactly one module.

| Module | Content (current shell.css regions) |
|---|---|
| `base.css` | body/root layout, fonts (incl. `--font-reading` note), Icon/Nerd Font glyph rules |
| `modules/primitives.css` | shared pills/chips, inline input+button row, tooltips |
| `modules/sidebar.css` | workspace/session tree, collapsed rail, rollups, status tags, workflow lens |
| `modules/terminals.css` | terminal frame, tabs, slot grid, empty-slot launchpad, floating shell, collab status, hybrid focus indicator, provider identity glyph |
| `modules/review.css` | review chipbar, inline threads, viewed rows |
| `modules/files.css` | scoped file tree, files overlay, symbol search |
| `modules/viewer.css` | viewer chrome, context panel git sections |
| `modules/dialogs.css` | app dialog, confirm dialog, settings, terminal layout, phone bridge, command presets |
| `modules/usage.css` | usage chip, charts, popover, provider brand colors |
| `modules/plugins.css` | plugins panel + cards |
| `modules/md-preview.css` | `.shell-md-body` reading surface |

Exact rule-to-module assignment is finalized during implementation; ambiguous
rules go to the module that owns the primary selector's feature.

End state: `src/app/shell.css` and `src/styles/tui.css` are **deleted**.
`src/features/updater/UpdateBanner.css` (33 lines, co-located) is left as-is —
out of scope. `hljs-tokens.css` is unchanged apart from being imported via
index.css.

## 4. Theme core contract

### 4.1 Single token core

`src/styles/tokens.css` stays THE theme definition file. Each theme is one
block: dark = `:root` (default), plus `[data-theme="light"]`,
`[data-theme="warm"]`, `[data-theme="tui"]`. The light/warm **token** blocks
currently in shell.css (lines 74–86 and 113–125) move into their tokens.css
blocks; the structural rules interleaved with them (body backgrounds at 92 and
127, tab hovers at 97–107 and 132) co-locate into their owning modules per
§4.2 rule 2. After that, tokens.css is the complete answer to "what makes a
theme a theme" for color/typography/spacing.

Theme switching mechanism is unchanged:
`document.documentElement.setAttribute("data-theme", palette)`
(`src/lib/use-theme.ts`).

### 4.2 The four rules

1. **Color / spacing / typography / radius variance → tokens only.** Component
   rules never hardcode a per-theme value; they reference `var(--*)`.
2. **Structural variance** (layout toggles, borders that appear/disappear,
   tui chrome quirks) lives in a `[data-theme]` block at the **bottom of the
   owning feature module**, wrapped in `@layer app.themes`. Editing a feature
   file shows every theme's quirks for that feature in one screen.
3. **No `[data-theme]` selectors anywhere else.** Grep-checkable invariant:
   `[data-theme` appears only in tokens.css and inside `app.themes` blocks.
4. **New-theme recipe:** add one token block to tokens.css → run the
   ui-gallery screenshot capture across palettes → add structural overrides
   only where screenshots show breakage. No 6k-line audit.

### 4.3 Tokenize-vs-structural criterion

For each scattered `[data-theme]` rule encountered during a slice: *could a
fifth theme reuse this by setting a token?* If yes (pure color/value swap,
e.g. the light inline-thread overrides at shell.css:4186) → convert to a
token. If no (genuinely structural) → co-locate per rule 2.

### 4.4 Out of scope

- Legacy bridge token names (`--app-bg`, `--panel-bg`, `--text-primary`, …)
  **stay**. Renaming to shadcn names churns thousands of lines for zero
  behavior; tokens.css keeps its bridge section.
- No class renames, no CSS Modules, no co-location per feature dir.
- The TUI-aesthetic constraint (square corners, mono fonts, flat surfaces —
  see `docs/superpowers/specs/2026-06-23-tui-traits-to-all-themes-design.md`)
  is untouched; this refactor moves rules, it does not restyle.

## 5. Migration plan (strangler slices)

### Slice 0 — skeleton + baselines

- Create `index.css` with the `@layer` statement and imports; shell.css is
  temporarily imported from index.css **unlayered** so nothing changes.
- `main.tsx` drops its four CSS imports for the single `styles/index.css`.
- Add the visual-regression harness (§6.1) and record baselines
  (`--update-snapshots`), committed as the "before" set.

### Slices 1–9 — one module each

Order: base → sidebar → terminals → review → files/viewer → dialogs → usage →
plugins → md-preview/primitives (leftovers). Per-slice recipe:

1. Cut the feature's rules **verbatim** from shell.css into the module file,
   imported under `layer(app.components)`.
2. Pull that feature's tui.css rules into the module's trailing
   `@layer app.themes` block.
3. Apply the §4.3 criterion to `[data-theme]` one-offs in the moved region.
4. Verify (§6): visual spec if it covers the surface, manual theme-cycle spot
   check otherwise, plus that feature's behavioral e2e specs.

### Slice 10 — teardown + guardrails

- shell.css and tui.css reach zero lines → delete both; light/warm token
  blocks merged into tokens.css (may also land earlier, in the base slice).
- Guardrail script + architecture doc (§7) land.
- Full verification gates (§6.3).

### Known risk — cross-module source order

Within a module, relative rule order is preserved (verbatim moves). Across
modules it changes: two same-specificity rules targeting the same element from
different former sections can flip winners. The visual harness catches this on
covered surfaces. Fix policy: raise the intended winner into `app.themes` or
make its specificity explicit — never fix by re-shuffling import order.

## 6. Verification

### 6.1 Visual regression harness (new, best-effort guardrail)

Current screenshot specs (`ui-gallery.screenshots.spec.ts`,
`workspace-panel.screenshots.spec.ts`) are **capture-only** — PNGs for manual
review, no assertions. Playwright's native pixel-diff is the cheap upgrade:

- New assertion spec `tests/e2e/css-refactor.visual.spec.ts`: walks the same
  deterministic surfaces — ui-gallery screens (main / dialog / dropdown /
  context) + workspace panel sidebar — across all four palettes, asserting
  `expect(page).toHaveScreenshot()` with a small anti-aliasing tolerance
  (`maxDiffPixels`), animations disabled.
- Slice 0 records committed baselines; every later slice re-runs the spec —
  pixel-identical = no drift on covered surfaces.
- **Best-effort policy (D6):** if a slice's surfaces aren't reachable by the
  harness (deep runtime states: live terminal grids, populated review
  threads, usage popover with data), skip pixel-diff for that slice and
  verify manually (theme-cycle spot check in the running app) plus the
  feature's behavioral e2e specs. Optionally extend UiGallery with a missing
  section — decided per slice, not upfront.
- The spec outlives the refactor as a standing theme-drift guardrail. It runs
  with the local e2e suite only — **not** master-gate (screenshot baselines
  are machine-rendered; master-gate stays lint/format/typecheck).
- Existing capture specs stay untouched (they serve eyeball review of theme
  PRs).

### 6.2 Per-slice gates

- Visual spec green (or documented manual verification for uncovered slices).
- Feature's behavioral e2e specs green.
- `theme-tui-traits.spec.ts` green (standing theme-contract assertions).

### 6.3 Final gates (repo policy)

- Full e2e suite to green (`pnpm test:e2e` — never bare
  `pnpm exec playwright test`).
- `pnpm lint` + `pnpm format` + `pnpm typecheck` (master-gate checks prettier;
  lint alone does not cover it).

## 7. Guardrails against re-drift

- `scripts/ci/check-css-architecture.mjs`: fails when `[data-theme` appears
  outside tokens.css / `@layer app.themes` blocks; warns when a module exceeds
  ~800 lines. Wired into the lint step so master-gate enforces it.
- Architecture note in `docs/shared/` documenting the layer taxonomy, the four
  theme rules, and the new-theme recipe.
- **`AGENTS.md` styling section** (currently has zero CSS guidance): a short
  "Styling architecture" section telling future agents where styles live and
  how not to regress the split —
  - new styles go in the owning module under `src/styles/modules/` (module map
    reference → the `docs/shared/` note), never a new catch-all file;
  - theme variance follows the four rules (§4.2): tokens first, structural
    overrides only in the owning module's `@layer app.themes` block;
  - never reintroduce unlayered app CSS or add CSS imports to `main.tsx` —
    `src/styles/index.css` is the only entry and the cascade authority;
  - `check-css-architecture.mjs` enforces the invariants; if it fails, fix the
    placement, don't relax the script.

## 8. Success criteria

1. `src/app/shell.css` and `src/styles/tui.css` deleted; no CSS file in
   `src/styles/` exceeds ~800 lines except a justified outlier.
2. `[data-theme` grep invariant holds (enforced by script).
3. All four themes render without regression: visual harness green on covered
   surfaces, manual spot checks clean elsewhere, `theme-tui-traits` green.
4. Adding a hypothetical fifth theme requires: one token block + structural
   overrides only in modules that need them (validated by inspection, not by
   actually shipping a theme).
5. Full e2e, lint, format, typecheck green.
6. `AGENTS.md` carries the styling-architecture section (§7) so future agent
   sessions place styles correctly instead of regrowing a monolith.
