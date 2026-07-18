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
@import "./base.css";                       /* modules are imported PLAIN (no
                                               layer(...)) — each file assigns
                                               its own rules to the top-level
                                               layers, see anatomy below */
@import "./modules/primitives.css";
@import "./modules/sidebar.css";
@import "./modules/terminals.css";
@import "./modules/review.css";
@import "./modules/files.css";
@import "./modules/viewer.css";
@import "./modules/dialogs.css";
@import "./modules/usage.css";
@import "./modules/plugins.css";
@import "./modules/md-preview.css";
@import "./hljs-tokens.css" layer(app.components);  /* sole layer() import:
                                               file stays verbatim and contains
                                               no @layer blocks, so nothing can
                                               nest (see pitfall below) */
```

**Module file anatomy** — every module assigns its rules to the top-level
layers explicitly; component rules first, theme overrides in a trailing
sibling block:

```css
/* modules/terminals.css */
@layer app.components {
	.shell-terminal-tab { /* ... */ }
}
@layer app.themes {
	[data-theme="tui"] .shell-terminal-tab { /* ... */ }
}
```

(`base.css` uses `@layer app.base { ... }` + `@layer app.themes { ... }` the
same way.)

**Why plain imports, not `layer(...)` imports:** `@import "x.css"
layer(app.components)` wraps the whole file in `app.components`, so an
`@layer app.themes` block inside the file would become the **nested** layer
`app.components.app.themes` — not the top-level `app.themes`. Per
css-cascade-5, a layer's direct declarations beat all of its nested sublayers,
so co-located theme overrides would lose to that module's component rules —
the exact inversion of the guarantee this design exists to provide. In-file
`@layer` blocks attach to the top-level layers declared in index.css, which
keeps co-location (D4) and sibling-layer semantics together.

Verified facts this relies on:

- Tailwind v4's entry (`node_modules/tailwindcss/index.css`) begins with
  `@layer theme, base, components, utilities;` — our statement lists the same
  four names first, in the same order, so whichever file the bundler emits
  first fixes an identical order.
- Layer order beats specificity for normal declarations. `app.*` layers come
  after `utilities`, so app rules keep beating Tailwind utilities — the same
  effective result as today's unlayered-beats-layered relationship.
- `app.base < app.components < app.themes` — **as sibling top-level layers**
  (guaranteed by the in-file `@layer` block anatomy above) — means theme
  overrides always win over component rules regardless of specificity or
  import order. Import order stops being load-bearing.

### 3.2 Module map

Carved along shell.css's existing section comments; target ~300–800 lines per
module. Every rule lands in exactly one module.

| Module | Content (current shell.css regions) |
|---|---|
| `base.css` | `@font-face` rules, body/root layout, **theme-invariant** root vars only (`--font-ui`, `--font-terminal`, `--font-reading`, `--font-size-*`), Icon/Nerd Font glyph rules — theme-varying tokens from shell.css's `:root` move to tokens.css instead (§4.1) |
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
§4.2 rule 2.

**Defaults move with their overrides.** shell.css's own `:root` block
(lines 40–72) currently defines the *default* values of tokens that themes
override — moving it verbatim into base.css would split the dark theme's
definition across two files and break the "dark = `:root` in tokens.css"
contract. The split is:

- **Theme-varying → tokens.css `:root` (dark) block:** `--shell-border-width`
  (tui overrides it, tui.css:41), `--pane-border-sessions` /
  `--pane-border-session-info` / `--pane-border-terminal` /
  `--pane-border-review` (light/warm/tui override them, shell.css:76–79,
  115–118, tui.css:34–37), `--sha-color` and the five `--provider-*` colors
  (light/warm override them, shell.css:80–85, 119–124).
- **Theme-invariant → base.css:** `--font-ui`, `--font-terminal`,
  `--font-reading`, `--font-size-body`, `--font-size-label`, and the
  `font-family` declaration — no theme overrides any of these.
- tui.css's token redefinitions (tui.css:34–41) go to tokens.css's
  `[data-theme="tui"]` block, not to a module's `app.themes` block.

After that, tokens.css is the complete answer to "what makes a theme a theme":
every custom property that varies by theme has its default **and** all its
per-theme values there. Theme-invariant design vars (fonts, font sizes) live
in base.css and are outside the theme contract precisely because no theme may
vary them without first moving them to tokens.css.

Theme switching mechanism is unchanged:
`document.documentElement.setAttribute("data-theme", palette)`
(`src/lib/use-theme.ts`).

### 4.2 The four rules

1. **Color / spacing / typography / radius variance → tokens only.** Component
   rules never hardcode a per-theme value; they reference `var(--*)`. Corollary:
   a custom property overridden by **any** theme is a theme token, and its
   default (dark) value must be declared in tokens.css's `:root` block — never
   in base.css or a module (§4.1 "defaults move with their overrides").
2. **Structural variance** (layout toggles, borders that appear/disappear,
   tui chrome quirks) lives in a `[data-theme]` block at the **bottom of the
   owning feature module**, wrapped in a top-level `@layer app.themes { ... }`
   block (sibling to the module's `@layer app.components` block — never nested
   inside it, and never via a `layer(...)` import; see §3.1 anatomy). Editing
   a feature file shows every theme's quirks for that feature in one screen.
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

- Create `index.css` as a pure entry-point indirection: the `@layer` order
  statement plus **all four current stylesheets imported unlayered, in
  today's exact `main.tsx` order** (`tokens → shell → tui → hljs-tokens`,
  per src/main.tsx:14–20). tui.css is load-bearing until its rules are
  absorbed — omitting it here would poison the baselines with a regression
  recorded as the "before" state.

  ```css
  /* index.css during Slice 0 — behavior-identical indirection */
  @layer theme, base, components, utilities, app.base, app.components, app.themes;
  @import "./tokens.css";
  @import "../app/shell.css";  /* unlayered — temporary until slices empty it */
  @import "./tui.css";         /* unlayered — temporary until slices empty it */
  @import "./hljs-tokens.css"; /* unlayered — switches to layer(app.components) in Slice 10 */
  ```

  The bare `@layer` order statement declares empty layers and moves no rule,
  so the rendered cascade is unchanged.
- `main.tsx` drops its four CSS imports for the single `styles/index.css`.
- Add the visual-regression harness (§6.1) and record baselines
  (`--update-snapshots`) **after** this no-op conversion, committed as the
  "before" set.

### Slices 1–9 — one module each

Order: base → sidebar → terminals → review → files/viewer → dialogs → usage →
plugins → md-preview/primitives (leftovers).

The **base slice** additionally executes the §4.1 token split in full: the
theme-varying defaults from shell.css's `:root` move into tokens.css's `:root`
(dark) block, the light/warm blocks (shell.css:74–86, 113–125) into their
tokens.css blocks, and tui.css's token redefinitions (tui.css:34–41) into the
`[data-theme="tui"]` block — so tokens.css is the complete theme core from the
first slice onward, and only theme-invariant vars land in base.css.

Per-slice recipe:

1. Cut the feature's rules **verbatim** from shell.css into the module file's
   `@layer app.components { ... }` block; add a plain (un-`layer()`-ed)
   `@import` for the module to index.css, before the temporary unlayered
   shell.css/tui.css imports.
2. Pull that feature's tui.css rules into the module's trailing top-level
   `@layer app.themes { ... }` block — except token redefinitions, which go
   to tokens.css's `[data-theme="tui"]` block (§4.1).
3. Apply the §4.3 criterion to `[data-theme]` one-offs in the moved region.
4. Verify (§6): visual spec if it covers the surface, manual theme-cycle spot
   check otherwise, plus that feature's behavioral e2e specs.

### Slice 10 — teardown + guardrails

- shell.css and tui.css reach zero lines → delete both (and their temporary
  unlayered imports in index.css). The token consolidation itself already
  happened in the base slice (§5, slices 1–9 intro).
- hljs-tokens.css's import switches from unlayered to
  `layer(app.components)` — the file itself stays verbatim.
- Guardrail script + architecture doc (§7) land.
- Full verification gates (§6.3).

### Known risk — cross-module source order and mid-migration layering

Within a module, relative rule order is preserved (verbatim moves). Two
cascade shifts are still possible:

- **Across modules** order changes: two same-specificity rules targeting the
  same element from different former sections can flip winners.
- **During migration**, not-yet-moved shell.css/tui.css rules are unlayered
  and therefore beat already-moved (layered) rules on any conflict — a rule
  that previously won by source order within shell.css can temporarily lose
  after its competitor moves.

The visual harness catches both on covered surfaces, per slice. Fix policy:
raise the intended winner into `app.themes` or make its specificity explicit —
never fix by re-shuffling import order; for mid-migration flips, moving the
conflicting leftover rule in the same slice is also acceptable.

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
  outside tokens.css / `@layer app.themes` blocks; fails when a module file
  (base.css or `modules/*.css`) contains top-level rules outside
  `@layer app.base` / `app.components` / `app.themes` blocks; fails when
  index.css uses a `layer(...)` import for anything other than
  hljs-tokens.css (the nested-layer pitfall, §3.1); fails when a
  **theme-varying custom property leaks out of tokens.css** — collect every
  `--*` name declared inside any `[data-theme]` block, then fail if any such
  name also has a declaration outside tokens.css (catches both a stranded
  default in base.css/a module and a future theme override added for a var
  whose default lives elsewhere — the §4.1/§4.2-rule-1 invariant); warns when
  a module exceeds ~800 lines. Wired into the lint step so master-gate
  enforces it.
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
    modules are imported plainly and wrap their own rules in top-level
    `@layer` blocks — never `layer(...)` imports (nested-layer pitfall,
    §3.1);
  - `check-css-architecture.mjs` enforces the invariants; if it fails, fix the
    placement, don't relax the script.

## 8. Success criteria

1. `src/app/shell.css` and `src/styles/tui.css` deleted; no CSS file in
   `src/styles/` exceeds ~800 lines except a justified outlier.
2. `[data-theme` grep invariant holds, and no theme-varying custom property
   is declared outside tokens.css (both enforced by script).
3. All four themes render without regression: visual harness green on covered
   surfaces, manual spot checks clean elsewhere, `theme-tui-traits` green.
4. Adding a hypothetical fifth theme requires: one token block + structural
   overrides only in modules that need them (validated by inspection, not by
   actually shipping a theme).
5. Full e2e, lint, format, typecheck green.
6. `AGENTS.md` carries the styling-architecture section (§7) so future agent
   sessions place styles correctly instead of regrowing a monolith.
