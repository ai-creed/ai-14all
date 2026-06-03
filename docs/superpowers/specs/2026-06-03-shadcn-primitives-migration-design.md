# Design: Migrate UI primitives to canonical shadcn/ui

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Goal

Replace the app's custom UI primitive layer — custom components, hardcoded
design values, and the bespoke CSS-variable design system — with the canonical
**shadcn/ui** standard stack, pulled through the **shadcn.io MCP**.

Constraints set by the user:

- **No functions / features / layout changes.** Structural layout (pane
  arrangement, what renders where, every feature) stays identical.
- **Only the shadcn components actually required by the current repo** — not the
  whole catalog.
- **Full shadcn stack** (Tailwind + `cn()` + `cva`), **shadcn default palette**
  (slate/zinc), components fetched via the shadcn.io MCP.

### Interpretation of "no layout changes"

Structural layout and all features are preserved exactly. However, because the
user explicitly chose **shadcn default styling**, component-level restyling
(shadcn's button heights, padding, radius, focus rings, default slate palette)
is expected and accepted. We do **not** pixel-match the previous look.

## Current state (as mapped)

- Electron + React 19 + TypeScript, built with `electron-vite` (Vite under the
  hood). Renderer entry: `src/main.tsx` (imports `src/app/shell.css`).
- **No Tailwind, no shadcn, no `cn()`/`clsx`/`cva`, no `components.json`.**
- Design system = ~30 CSS custom properties in `src/app/shell.css` (`:root`),
  with three themes via `data-theme`: default (dark), `light`, `warm`.
- Radix primitives are used **directly inline** in feature files, not wrapped.
- Only two custom primitive components exist: `src/components/AppDialog.tsx`
  (Radix Dialog wrapper) and `src/ui/ToggleSwitch.tsx`.
- Buttons/inputs are className-based: `.shell-button` (+ variants) and
  `.shell-input`.
- No `@/` path alias is configured.

## Required component set (driven by real usage)

| shadcn component   | Replaces                                              | Call sites (files / uses) |
| ------------------ | ----------------------------------------------------- | ------------------------- |
| `button`           | `.shell-button` + `--primary/--danger/--icon/--compact/--xs/--round` | 17 / 52 |
| `input`            | `.shell-input` (text inputs)                          | (subset of 8 / 18)        |
| `textarea`         | `.shell-input` (textareas)                            | (subset of 8 / 18)        |
| `dialog`           | `AppDialog` wrapper + raw `@radix-ui/react-dialog`    | 9 + 6                     |
| `switch`           | `ToggleSwitch`                                        | 2                         |
| `dropdown-menu`    | raw Radix in `TerminalActions`                        | 1                         |
| `context-menu`     | raw Radix (SessionSidebar, WorktreeTree, CommitList, ChangesList) | 4             |
| `tabs`             | raw Radix in `ReviewArea`                             | 1                         |
| `scroll-area`      | raw Radix in `ReviewArea`                             | 1                         |

**Explicitly excluded:** `@radix-ui/react-tooltip` and `@radix-ui/react-separator`
are declared in `package.json` but have **zero usages in `src/`**. Per "only
what's required," they are skipped. The unused deps are left in `package.json`
(removing them is out of scope).

## Toolchain additions (the shadcn stack)

- **Tailwind v4** via `@tailwindcss/vite`, added to `renderer.plugins` in
  `electron.vite.config.ts`.
- New deps: `tailwindcss`, `@tailwindcss/vite`, `clsx`, `tailwind-merge`,
  `class-variance-authority`, `tw-animate-css`, `lucide-react`.
- `src/lib/utils.ts` exporting `cn()`.
- `components.json` — style `new-york`, RSC off, TSX on, base color `slate`,
  aliases pointing at `@/components`, `@/components/ui`, `@/lib/utils`,
  `@/lib`, `@/hooks`.
- **Path alias `@/` → `src/`** added in BOTH:
  - `tsconfig.json` → `compilerOptions.paths` (`"@/*": ["src/*"]`) plus
    `baseUrl`.
  - `electron.vite.config.ts` → `renderer.resolve.alias`.
- Components fetched via shadcn.io MCP (`get_item_source` per component) into
  `src/components/ui/`.

## Token strategy (cheap default adoption)

The 91 KB `shell.css` layout reads legacy variables (`--panel-bg`,
`--text-primary`, `--accent`, `--panel-border`, `--radius-*`, `--space-*`…)
throughout. Those rules are **not** edited individually. Instead:

1. Add shadcn's default **slate** token layer (`--background`, `--foreground`,
   `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`,
   `--ring`, `--card`, `--popover`, `--destructive`, `--radius`, plus chart
   tokens) for `:root` and `.dark`, in the shadcn v4 format. Map them into
   Tailwind via `@theme inline`.
2. **Re-point the legacy variable names at shadcn tokens** in a single bridge
   block, e.g.:
   - `--app-bg: var(--background);`
   - `--panel-bg: var(--card);`
   - `--panel-bg-elevated: var(--popover);`
   - `--panel-border: var(--border);`
   - `--text-primary: var(--foreground);`
   - `--text-secondary: var(--muted-foreground);`
   - `--accent: var(--primary);`
   - `--danger: var(--destructive);`
   - radii/spacing mapped to nearest shadcn/Tailwind scale values.

   The entire layout then adopts shadcn defaults automatically with no per-rule
   edits.

### Dark mode wiring

shadcn keys dark mode off a `.dark` class; the app currently uses the **absence**
of `data-theme` for its (dark) default and `data-theme="light"`/`"warm"` for the
others. The bridge defines:

- `:root` (default) → shadcn **dark** token values (app default is dark).
- `[data-theme="light"]` → shadcn **light** token values.
- `[data-theme="warm"]` → the existing warm palette, re-expressed through the
  shadcn token names (warm has no shadcn default; the theme + switcher feature
  is preserved per "no feature changes").

The theme switcher and all three themes remain functional.

Note: shadcn components read their colors from the CSS variables
(`--background`, `--primary`, …), not primarily from `dark:` utility variants.
Because `:root` is set directly to dark token *values*, the components render
dark by default without needing a `.dark` class on `<html>`. Any `dark:`
variants inside fetched components are minor; if a specific one matters, a
`.dark` class can be toggled alongside the default theme during implementation.

## Migration approach (low-risk ordering)

Each phase ends with `pnpm typecheck && pnpm lint && pnpm test` green.

1. **Toolchain + tokens.** Install deps, wire Tailwind into electron-vite, add
   `@/` alias, `cn()`, `components.json`, the shadcn token layer, and the legacy
   bridge block. Verify the app boots and looks like shadcn defaults with no
   broken layout. No component swaps yet.
2. **Add `ui/` components** via shadcn.io MCP: button, input, textarea, dialog,
   switch, dropdown-menu, context-menu, tabs, scroll-area.
3. **`AppDialog`**: rewrite its internals to compose shadcn `dialog` parts while
   **preserving its public API** (`AppDialog`, `.Title`, `.Description`, `.Body`,
   `.Footer`, `size` prop). Its 9 importers stay unchanged.
4. **Raw-Radix call sites** → `ui/` wrappers: `TerminalActions` (dropdown),
   the 4 context-menu files, `ReviewArea` (tabs + scroll-area), and the 6 raw
   `@radix-ui/react-dialog` files (NoteSheet, MarkdownPreviewModal,
   TerminalLayoutDialog, ShortcutsHelp, FilesOverlay; AppDialog handled in #3).
5. **`.shell-button` / `.shell-input`** call sites → `<Button>` / `<Input>` /
   `<Textarea>`. Largest surface (17 + 8 files); done feature-by-feature with a
   variant/size mapping table:
   - `.shell-button` → `variant="secondary"` (default chrome button)
   - `.shell-button--primary` → `variant="default"`
   - `.shell-button--danger` → `variant="destructive"`
   - `.shell-button--icon` / `--round` → `size="icon"` (+ `variant="ghost"` where
     it was a bare icon)
   - `.shell-button--compact` / `--xs` → `size="sm"`
   Exact mapping refined against each call site during implementation.
6. **`ToggleSwitch`** → shadcn `switch` (wrap to keep the `label` + `aria-label`
   affordance its 2 callers rely on). Fix the 4 hardcoded colors in
   `WorktreeList.tsx` (`#555`, `#777`, `#666`, `#f0f0f0`) to shadcn tokens.
7. **Cleanup.** Remove now-dead `.shell-button*`, `.shell-input*`,
   `.shell-app-dialog*`, `.shell-toggle-switch*` rules from `shell.css`. Keep all
   layout/pane/terminal CSS.

## Risks & mitigations

- **Button surface (52 uses)** is the main regression vector. Mitigation:
  migrate feature-by-feature, typecheck/lint between batches, rely on the
  variant mapping table.
- **Tailwind preflight** could reset base element styles the layout CSS assumes.
  Mitigation: load Tailwind, then `shell.css` after it (so layout wins where it
  must); verify the app visually after Phase 1 before any swaps.
- **electron-vite + Tailwind v4** integration is the riskiest setup step;
  isolating it as Phase 1 (no component changes) keeps the blast radius small.
- **e2e suite** has known stale selectors (memory: terminal DOM renamed to
  `terminal-grid`/`.xterm`; onboarding wizard must be dismissed in `beforeAll`).
  Target the live selectors; don't chase pre-existing e2e breakage.

## Verification

- Per phase: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- End: `pnpm test:e2e` (build + Playwright), dismissing onboarding in
  `beforeAll`, using `terminal-grid`/`.xterm` selectors.
- Manual smoke: launch app, exercise a dialog, dropdown, context menu, the
  review tabs, a button-heavy flow, and toggle each of the 3 themes.

## Out of scope

- Rewriting `shell.css` layout/inline styles into Tailwind utilities.
- Tooltip/Separator components (unused).
- Removing unused Radix deps from `package.json`.
- Any feature, behavior, or structural layout change.
