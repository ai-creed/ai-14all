# Bring three TUI traits to the light, dark & warm themes

**Date:** 2026-06-23
**Branch:** `tui-polish-1`
**Status:** DESIGN — approved in brainstorming; awaiting spec review before planning.

## 1. Goal

Apply three characteristics of the `tui` theme to the other three palettes
(`light`, `dark`/`:root`, `warm`) while leaving each theme's identity — its
colors, fonts, shadows, motion, and background gradients — otherwise intact:

1. **No border radius** — sharp, square corners.
2. **Symbol Nerd Font icons** — the monochrome glyph set the `tui` theme already
   uses, in every theme.
3. **Simple separators** — pane-accent borders become solid full-opacity lines
   instead of translucent washes (color-coding kept).

This is a deliberate **subset** of the spec'd "Flatten" (`docs/tui-css-spec.md`
§10.3 PR G). It is **not** the full flatten: the stepped color ladder,
reverse-video active states, motion-kill, shadow removal, mono fonts, and teal
accent are explicitly **out of scope**. Each theme keeps its own colors.

`tui` already has all three traits and is unaffected by this work.

## 2. Non-goals

- No change to the `tui` theme's tokens, `tui.css`, or its scoped rules.
- No change to theme colors, `--foreground`/`--background`/accent palettes, the
  AAA contrast values just landed (`docs/theme-wcag-aaa-spec.md`), fonts, motion,
  shadows, or the dark/warm radial background gradients.
- No squaring of circular status dots (`border-radius: 50%`) or pill badges
  (`border-radius: 999px` / `rounded-full`) — see §3.1.
- `UiGallery.tsx`'s one directly-rendered Lucide icon (`<Settings/>`) is a
  dev-only gallery control and is left as-is.

## 3. Design

Centralized approach: changes live in **tokens, the Icon component, and a small
global CSS sweep** — no per-theme duplicated override blocks (the rejected
alternative was mirroring `tui.css` into light/dark/warm-scoped blocks, which
duplicates rules across three themes and drifts).

Files touched: `src/styles/tokens.css`, `src/app/shell.css`,
`src/components/ui/icon.tsx`. **No `tui.css` changes.**

### 3.1 Trait 1 — No border radius

**a. Zero the radius token.** Set `--radius: 0rem` (currently `0.625rem`) in
`:root` (`tokens.css`). `light` and `warm` inherit `:root`, so this covers all
three; `tui` already declares its own `0rem`. This zeros, automatically:

- the **72** `border-radius: var(--radius*)` declarations in `shell.css`, and
- every `rounded-sm` / `rounded-md` / `rounded-lg` / `rounded` Tailwind utility
  across the ~30 component files (they map to `--radius-*` via `@theme inline`).

**b. Zero the hardcoded rounded-rectangle radii.** `shell.css` has **17**
hardcoded px radii that are not `--radius`-driven; set each to `0`. These are
also still rounded under `tui` today, so this additionally tightens `tui`.
Lines (current value → `0`):

```
1515: 3px   2529: 8px   2670: 6px   2700: 4px   2842: 4px   2855: 4px
2866: 4px   3230: 8px   4092: 2px   4289: 1px   4326: 10px  4426: 6px
4503: 5px   4510: 5px   4526: 3px   4568: 2px   4665: 2px
```

(The grep that produced this list already excluded `0`, `999px`, `50%`,
`inherit`, and `var(--radius*)`, so these 17 are rounded-rectangle corners.
Still eyeball each in context before zeroing — e.g. a deliberately-rounded
`kbd` keycap might be worth keeping.)

**c. Keep deliberate shapes.** Leave `border-radius: 50%` (circular status dots /
avatars) and `border-radius: 999px` + `rounded-full` (pill badges) untouched.
The `tui` theme keeps them; square status dots read as broken. *(Optional
follow-up if desired later: square the pills too — a separate small change.)*

**d. Known residual.** `--radius-xl` clamps to `4px` when `--radius: 0`
(existing `@theme inline` math: `max(0px, calc(var(--radius) + 4px))`). `tui`
runs with this already and is considered sharp, so we match it. No `rounded-xl`
usages exist in `components/ui`; if any surface elsewhere, they render at 4px.
Not forced to 0 unless review asks.

### 3.2 Trait 2 — Symbol Nerd Font icons everywhere

The `<Icon>` component (`icon.tsx`) renders two children: the non-TUI
representation (Lucide SVG or text/emoji glyph) gated `tui:hidden`, and the Nerd
Font glyph span gated `app-nf hidden tui:inline-block`. The glyph is painted by
`[data-theme="tui"] .app-nf::before { content: attr(data-nf); }` in `shell.css`.
Today only `tui` shows the glyph; everywhere else the fallback shows.

**Change — flip the gate so the glyph shows in every theme:**

- `icon.tsx`:
  - Lucide branch: `cn("tui:hidden", className)` → `cn("hidden", className)`
  - text-fallback branch: `cn("tui:hidden", className)` → `cn("hidden", className)`
  - glyph span: `cn("app-nf hidden tui:inline-block", className)` →
    `cn("app-nf inline-block", className)`
  - update the component doc comment (it currently states only `tui` swaps).
- `shell.css`: un-scope the paint rule —
  `[data-theme="tui"] .app-nf::before` → `.app-nf::before`, and update the
  adjacent comment (currently "Only ever visible under data-theme=tui").

**Coverage.** This swaps all **29** `<Icon>` call sites plus the four shadcn
primitives (`dialog`, `dropdown-menu`, `context-menu`, `FilesOverlay`) — all of
which pass their Lucide icon through `<Icon lucide={…}>` — to the Nerd Font set
in every theme. Colorful emoji fallbacks (folder, file, note, comment, eye,
plugins) become monochrome glyphs.

**Risk — icon sizing/alignment.** The glyph-vs-SVG size was tuned under `tui`.
The same components and layout apply to light/dark/warm, so it should carry
over, but glyphs are font-sized text where SVGs were `w-/h-` boxes; a few sites
may shift by a pixel. The screenshot pass (§5) is the check. The Nerd Font face
(`Symbols Nerd Font`, `font-display: block`) is already loaded for `tui`.

### 3.3 Trait 3 — Simple (solid) separators

Redefine the four pane-accent border tokens for `light`, `dark` (`:root`), and
`warm` from translucent `rgba()` to **solid full-opacity** hex of the same hue
(drop the alpha — crisper, still color-coded). `tui`'s neutral
`var(--panel-border)` lines stay. Border width stays **1px** (not `tui`'s 2px) —
"simple," not heavier. Proposed values (alpha removed):

| Token | dark (`:root`) | light | warm |
|---|---|---|---|
| `--pane-border-sessions` | `#4fb3ff` | `#1e78dc` | `#6cbcb8` |
| `--pane-border-session-info` | `#f6a94a` | `#b4781e` | `#e49e50` |
| `--pane-border-terminal` | `#43d39e` | `#1ea064` | `#e28c60` |
| `--pane-border-review` | `#f36b8a` | `#c83c50` | `#dc7a6e` |

(from `rgba(79,179,255,0.5)` etc. → full-opacity hex). These are starting
values; tune per background in the screenshot pass — particularly `light`, where
a saturated full-opacity line on white is strong (acceptable for a region
separator, but confirm it isn't harsh). Pane separators delineate regions, so
aim for clear, legible lines.

## 4. Components & data flow

No new components, no data flow. Three edit clusters, by file:

1. **`tokens.css`** — `:root { --radius: 0rem }` (only this one line). The
   `--pane-border-*` tokens are **not** here.
2. **`shell.css`** — owns everything else: the 4 `--pane-border-*` tokens for all
   three themes (`:root` lines 48–51, `light` 68–71, `warm` 104–107) → solid
   hex per §3.3; the 17 hardcoded radii → `0` (§3.1b); un-scope `.app-nf::before`
   (§3.2).
3. **`icon.tsx`** — flip three `cn()` class strings; update doc comment.

## 5. Verification

1. `corepack pnpm build`.
2. Re-run the gallery screenshot pass
   (`corepack pnpm exec playwright test ui-gallery`) — captures dark/light/warm/
   tui into `tests/__screenshots__/`. Confirm: square corners, Nerd Font glyphs
   render and align, solid pane separators legible, `tui` unchanged.
3. Restore host SQLite ABI if vitest is needed next.
4. Relaunch `electron-vite preview` for a manual smoke test across the three
   themes (toggle via the theme menu).

## 6. Risks & open questions

- **Icon alignment** (§3.2) — primary risk; caught by screenshots.
- **Light separator harshness** (§3.3) — full-opacity saturated lines on white;
  tune if harsh.
- **Pills stay round** (§3.1c) — default; squaring them is a separate opt-in.
- **`--radius-xl` = 4px residual** (§3.1d) — matches `tui`; force to 0 only if
  review wants strict.
- **`tui.css` redundancy** — once radius is globally 0, `tui.css`'s files-overlay
  radius re-pointing (lines ~418–426) becomes a no-op. Harmless; optional cleanup,
  not part of this change.
