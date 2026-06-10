# Spec: Terminal UI Aesthetic on the shadcn Token System

**Status:** Draft
**Branch context:** follow-up to `feat/shadcn-primitives-migration`
**Source studied:** [WebTUI](https://webtui.ironclad.sh/start/intro/) (`@webtui/css` v0.1.7 — actual shipped CSS, not just docs)

## 1. Goal

The shadcn migration gave us a clean token + primitive layer, but the styling is stock
"new-york" — soft radii, layered shadows, alpha-blended hovers, zoom/fade animations.
This spec restyles the app to a Terminal UI aesthetic **without leaving the shadcn
standard**: same token names (`--background`, `--primary`, `--radius`, …), same
`components.json`, same cva-variant component structure, same Tailwind v4 `@theme inline`
block. WebTUI is the reference for *what terminal aesthetics actually are in CSS*; shadcn
remains the architecture.

## 2. What WebTUI actually does (findings)

Reading `@webtui/css` source, the TUI look reduces to six concrete techniques:

### 2.1 The character grid: `ch` and `lh` are the only units
Everything is sized in character cells: padding `1lh 1ch`, control heights `1lh` / `3lh`,
input `min-width: 24ch`, dialog `max-width: 64ch; max-height: 24lh`. Nothing is sized in
px/rem except border widths. This — more than color — is what makes it read as a terminal:
elements snap to a text grid.

### 2.2 A stepped color ladder, no alpha
```css
:root {
  --background0: #fff; --background1: #ddd; --background2: #bbb; --background3: #999;
  --foreground0: #000; --foreground1: #444; --foreground2: #888;
}
```
Four background steps, three foreground steps. State changes (hover, emphasis) move one
step on the ladder — they never blend with alpha (`bg-primary/90`-style hovers don't
exist). Borders are full-opacity ladder colors, never `rgba(255,255,255,0.1)`.

### 2.3 Zero elevation: no shadows, no blur, no gradient decoration
There is not a single `box-shadow` in the library. "Elevation" is a background ladder
step plus a solid border. Gradients appear only as a *drawing tool* (see 2.4), never as
decoration.

### 2.4 Box-drawing borders: the border lives in the middle of the padding cell
The signature `box-="square|round|double"` utility pads the element by one cell
(`padding: 1lh 1ch`) and draws the border on a centered pseudo-element inset by half a
cell — exactly where a `┌─┐` box-drawing character would render:

```css
[box-] { position: relative; isolation: isolate; padding: 1lh 1ch; }
[box-]::before {
  content: ""; position: absolute; top: 50%; left: 50%; translate: -50% -50%;
  width: calc(100% - 1ch - var(--box-border-width));
  height: calc(100% - 1lh - var(--box-border-width));
  border: solid var(--box-border-width) var(--box-border-color);
  z-index: -1;
}
[box-][shear-="top"] { padding-top: 0; }  /* lets a child <span> sit ON the border line */
```
`shear-` collapses the padding so a title row overlaps the border — the classic
`┌─ Title ─────┐` framed-pane look. `double` adds a second pseudo-element border.

### 2.5 State changes are typographic or inversion, never glow
- Button focus: `font-weight: 700; text-decoration: underline` — no ring, no glow.
- Button active: **swap** foreground/background variables (`--mapped-primary` ↔
  `--mapped-secondary`) — the terminal reverse-video effect.
- Disabled: `text-decoration: line-through`.
- Selection/highlight = an inverted block of color, like a TUI cursor bar.

### 2.6 Half-line tricks and powerline caps
Default buttons/`<pre>` paint their fill with a `linear-gradient` that leaves the top and
bottom `0.5lh` transparent, so a 3-line-tall button reads as one text row with breathing
room. Badges get powerline-style end caps with `clip-path`
(`triangle`, `ribbon`, `slant-*`) — the same shapes as powerline glyphs `` ``.

**Not adopted:** WebTUI's attribute-selector API (`is-="badge"`, `box-="square"` as
authoring interface) and its `data-webtui-theme` switch. We keep cva variants, `cn()`,
and our `data-theme` switch. We borrow the *CSS techniques*, not the framework.

## 3. Design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Radius → 0 across the board | Terminals have no rounded cells. Single token flip. |
| D2 | Kill all shadows and decorative gradients | WebTUI finding 2.3. Elevation = ladder step + border. |
| D3 | Borders become solid ladder colors (no alpha) | Crisp 1px lines read as box-drawing; alpha borders read as "web". |
| D4 | Map the shadcn palette onto an explicit bg0–3 / fg0–2 ladder | Keeps shadcn names; gives every surface/state a deterministic step. |
| D5 | `--primary` per theme = the xterm cursor color | Chrome and embedded terminal share one accent: dark `#67d4b0` (teal), light `#1a7fc1` (blue), warm `#e58a5e` (already matches). Source: `src/features/terminals/logic/terminal-themes.ts`. |
| D6 | Keep `focus-visible` rings (a11y) but restyle as a solid 1px offset outline; add reverse-video for `active`/selected | WebTUI drops focus rings entirely; we won't regress keyboard a11y in an Electron app. |
| D7 | Animations become discrete: `steps()` timing or none | Terminals don't tween. Zoom/fade/slide on menus and dialogs is the single biggest "web app" tell. |
| D8 | New-control sizing in `ch`/`lh`; existing px spacing tokens stay | Full grid retrofit of 4,205-line `shell.css` isn't worth it; new surfaces adopt the grid. |

## 4. Token spec — `src/styles/tokens.css`

### 4.1 Ladder mapping (shadcn names ⇄ WebTUI roles)

| WebTUI role | shadcn token | Used for |
|---|---|---|
| `background0` | `--background` | App/window base |
| `background1` | `--card`, `--popover` | Panes, menus, dialogs |
| `background2` | `--muted`, `--secondary`, `--accent` | Hover step, inactive fills, input fill |
| `background3` | `--border`, `--input` | All borders (solid, no alpha) |
| `foreground0` | `--foreground`, `--card-foreground`, … | Primary text |
| `foreground2` | `--muted-foreground` | Secondary text, placeholders |
| cursor accent | `--primary`, `--ring`, `--accent` (interactive) | Selection bar, focus, links |

### 4.2 Dark theme (`:root`) — before → after

```css
:root {
	--radius: 0rem;                                  /* was 0.625rem */

	/* ladder: near-neutral charcoal, slight blue cast to match xterm bg #06090d */
	--background: oklch(0.16 0.015 240);             /* bg0 — was 0.129 0.042 264 (slate-blue) */
	--foreground: oklch(0.96 0.01 200);              /* fg0 */
	--card: oklch(0.20 0.015 240);                   /* bg1 — pane surface */
	--card-foreground: var(--foreground);
	--popover: oklch(0.20 0.015 240);                /* bg1 — flat, not "elevated" */
	--popover-foreground: var(--foreground);
	--muted: oklch(0.26 0.015 240);                  /* bg2 — hover/inactive step */
	--muted-foreground: oklch(0.68 0.02 230);        /* fg2 */
	--secondary: oklch(0.26 0.015 240);              /* bg2 */
	--secondary-foreground: var(--foreground);
	--accent: oklch(0.26 0.015 240);                 /* bg2 — menu-item hover stays a ladder step */
	--accent-foreground: var(--foreground);
	--primary: oklch(0.78 0.13 175);                 /* ≈ #67d4b0 — xterm dark cursor teal */
	--primary-foreground: oklch(0.16 0.015 240);     /* reverse-video pair */
	--destructive: oklch(0.704 0.191 22.216);        /* keep */
	--border: oklch(0.34 0.015 240);                 /* bg3 — was oklch(1 0 0 / 10%) ← no more alpha */
	--input: oklch(0.26 0.015 240);                  /* input FILL (bg2), not border alpha */
	--ring: var(--primary);                          /* focus = accent, was gray-blue */
}
```

### 4.3 Light theme (`[data-theme="light"]`)
Same ladder, inverted: `--background: oklch(0.985 0.005 240)` (paper, not pure white —
pure `#fff` + 1px dark borders moirés), `--card: oklch(0.955 …)`, `--muted: oklch(0.92 …)`,
`--border: oklch(0.80 …)`, `--primary: oklch(0.55 0.13 240)` (≈ `#1a7fc1` xterm light
cursor), `--ring: var(--primary)`.

### 4.4 Warm theme
Already 90% there (terracotta primary = warm xterm cursor). Only changes:
`--border: #4a3f31` stays (already solid ✓); set `--popover: var(--card)` (drop the
elevated `#342c22` step — D2); `--ring: var(--primary)` (was `#6d5b46`).

### 4.5 Radius guard (required, not optional)
With `--radius: 0rem`, the derived tokens go negative:
`--radius-sm: calc(var(--radius) - 4px)` → `-4px`, which is *invalid* `border-radius` and
falls back unpredictably. Clamp them in the `@theme inline` block:

```css
--radius-sm: max(0px, calc(var(--radius) - 4px));
--radius-md: max(0px, calc(var(--radius) - 2px));
--radius-lg: var(--radius);
--radius-xl: max(0px, calc(var(--radius) + 4px));
```
(Also fix the legacy-bridge copies at `tokens.css:42-44`.) This keeps `rounded-md`
classes in `ui/*.tsx` valid — they all collapse to square — and preserves the option to
ship a "soft-TUI" mode later by flipping `--radius` back to `0.25rem`.

### 4.6 Grid + font tokens (new)
```css
:root {
	line-height: 1.4;            /* pin it so 1lh is deterministic everywhere */
	--cell-w: 1ch;
	--cell-h: 1lh;
	--box-border-width: 1px;
}
```
`--font-ui` is already monospace (SF Mono stack in `shell.css`) — the hardest TUI
prerequisite is already met. Move `--font-ui`/`--font-terminal` declarations from
`shell.css:1-30` into `tokens.css` so the token file is the single theming surface, and
register them as `--font-mono` in `@theme inline` for Tailwind's `font-mono` utility.

## 5. Component spec — `src/components/ui/*.tsx`

Class-string edits only; no structural/API changes. Variants keep their names so call
sites don't change.

### 5.1 `button.tsx`
Base string, before:
```
… rounded-md text-sm font-medium transition-colors focus-visible:ring-1 focus-visible:ring-ring …
```
After:
```
… rounded-none text-sm font-medium transition-none
focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-ring
active:bg-foreground active:text-background
disabled:pointer-events-none disabled:opacity-50 …
```
Per-variant: strip every `shadow`/`shadow-sm`; replace alpha hovers with ladder steps —
`default`: `hover:bg-primary/90` → keep `bg-primary text-primary-foreground`, hover via
brightness step is fine to keep as `/90` *only if* D2-strictness loses; preferred:
`hover:underline`. `outline`: `border border-border bg-transparent hover:bg-muted`.
`ghost`: `hover:bg-muted`. Sizes `sm`/`lg`: drop the redundant `rounded-md`.

Optional WebTUI flourish (behind a new `variant: "reverse"` if wanted): focused/primary
buttons render reverse-video (`bg-foreground text-background`) — the strongest TUI cue.

### 5.2 `input.tsx` / `textarea.tsx`
WebTUI inputs are **filled, borderless** (`background: var(--background1)`, placeholder
`--foreground2`, no focus ring — the block cursor is the affordance). Adapted:
`border border-input bg-transparent shadow-sm` → `border-0 bg-input rounded-none`,
keep `focus-visible:outline-1 outline-ring`, `placeholder:text-muted-foreground`
(now fg2). Drop `transition-colors`.

### 5.3 `dialog.tsx`
- `DialogContent`: `rounded-lg border shadow-lg` → `rounded-none border border-border`;
  delete all `data-[state=…]:zoom-*` / `slide-*` / `fade-*` animation classes (D7) —
  dialogs appear instantly; `sm:max-w-lg` → `max-w-[64ch]` (WebTUI default dialog width).
- `DialogOverlay`: keep `bg-black/80`, delete fade animations. No backdrop blur ever.

### 5.4 `tabs.tsx`
The pill pattern (`TabsList: bg-muted rounded-lg p-1`, trigger `rounded-md shadow`) is
the most "web" component in the set. TUI tabs are a text row on a border line:
- `TabsList`: `rounded-none bg-transparent p-0 gap-[1ch] border-b border-border h-auto`.
- `TabsTrigger`: `rounded-none px-[1ch] data-[state=active]:bg-foreground
  data-[state=active]:text-background` (reverse-video active tab — finding 2.5), or the
  quieter `data-[state=active]:border-b-2 data-[state=active]:border-primary`.
  Recommend reverse-video; it's the signature move.

### 5.5 `dropdown-menu.tsx` / `context-menu.tsx`
- Content: `rounded-md shadow-md` → `rounded-none border-border` (no shadow — a 1px
  solid border against bg0 is exactly how TUI popovers separate).
- Delete `data-[state]` zoom/slide/fade animation classes (D7).
- Items: `rounded-sm focus:bg-accent` → `rounded-none focus:bg-primary
  focus:text-primary-foreground` — the highlighted row is an accent selection bar, the
  single most recognizable TUI interaction.
- Padding: `px-2 py-1.5` → `px-[1ch] py-0 min-h-[1lh]` where it doesn't break icon rows.

### 5.6 `switch.tsx`
`rounded-full` track/thumb → `rounded-none`; thumb `shadow-lg` → none; checked track
`bg-primary`. Result reads as a `[■ ]`/`[ ■]` toggle cell. Keep the translate animation
but add `transition-none` (it snaps — D7).

### 5.7 `scroll-area.tsx`
Thumb `rounded-full bg-border` → `rounded-none bg-border hover:bg-muted-foreground`;
keep 2.5 width. Square thumb on square track = terminal scrollbar.

## 6. Shell spec — `src/app/shell.css`

1. **Background gradients** (lines ~42–75): delete the three
   `radial-gradient(circle at top, …)` washes → flat `var(--background)` (D2).
2. **Glow shadows**: `box-shadow: 0 0 16px color-mix(…)` action/attention glows →
   solid border-color change, optionally blinking:
   ```css
   @keyframes tui-blink { 50% { border-color: transparent; } }
   animation: tui-blink 1s steps(1) infinite;   /* steps(), never ease */
   ```
3. **Attention spotlight** (lines ~648–748): the rotating conic-gradient ring is the
   opposite of TUI motion. Replace with the blink above, or a `steps(4)` ASCII-spinner
   (`◐◓◑◒` / `⠋⠙⠸⠴` as `::before` content cycling via keyframed `content`).
4. **Pane borders → titled boxes**: the four `--pane-border-*` rgba colors become
   full-opacity theme tokens, and panes adopt the WebTUI box+shear technique so each pane
   title sits *on* its border line (`┌─ SESSIONS ───┐`). See §7 utility.
5. **Inset/hover rgba overlays**: replace `rgba(...)` hovers with `var(--muted)` steps.

## 7. New file: `src/styles/tui.css` — grid utilities

A small `@layer utilities` file imported after `tokens.css`, porting the two WebTUI
drawing techniques worth owning:

```css
@layer utilities {
	/* WebTUI box technique, adapted: border drawn at half-cell inset */
	.tui-box {
		position: relative;
		isolation: isolate;
		padding: 1lh 1ch;
	}
	.tui-box::before {
		content: "";
		position: absolute;
		top: 50%; left: 50%;
		translate: -50% -50%;
		width: calc(100% - 1ch - var(--box-border-width));
		height: calc(100% - 1lh - var(--box-border-width));
		border: var(--box-border-width) solid var(--box-border-color, var(--border));
		z-index: -1;
	}
	/* collapse top padding so a title row overlaps the border line */
	.tui-box-shear-top { padding-top: 0; }
	.tui-box > .tui-box-title {
		display: inline-block;
		background: var(--card);       /* punches a gap in the border line */
		padding-inline: 1ch;
		color: var(--muted-foreground);
	}
}
```
Accent variants via `style={{ "--box-border-color": "var(--pane-border-terminal)" }}` —
this replaces today's plain `border` + absolutely-positioned pane title labels.

Optional second utility: powerline badge caps for the provider chips
(`--provider-claude`/`--provider-codex`). The bundled Meslo Powerline font already has
the glyphs — `::before { content: ""; }` / `::after { content: ""; }` beats
WebTUI's clip-path version since we ship the font anyway.

## 8. Migration phases

| Phase | Scope | Files | Risk |
|---|---|---|---|
| 1 | Tokens: radius 0 + clamp, ladder colors, solid borders, ring=primary, font tokens move | `tokens.css` | Low — whole app shifts at once, but reversible by git revert; visually noisy diff to review by screenshot |
| 2 | Primitives: shadow/animation/radius strip, reverse-video states, selection bars | `src/components/ui/*.tsx` (9 files) | Low — class strings only |
| 3 | Chrome: gradients, glows, blink/steps animations, rgba→token sweep | `shell.css`, `UpdateBanner.css` | Medium — 4,205 lines, do it as grep-driven passes (`radial-gradient`, `box-shadow`, `rgba(`) |
| 4 | Flourish: `tui.css` titled pane boxes, powerline caps, `marker-tree` for `WorktreeTree` | new `tui.css`, pane components | Medium — layout-affecting (padding becomes 1lh/1ch) |

Each phase is independently shippable; stop after phase 2 and the app already reads as a
TUI (flat, square, monospace, reverse-video selection).

## 9. Acceptance criteria

- [ ] `grep -c "shadow" src/components/ui/*.tsx` → 0 (excluding `shadow-none`).
- [ ] No `border-radius` > 0 renders anywhere in dark/light/warm (visual sweep).
- [ ] No alpha-channel borders: `grep "oklch(1 0 0 /" src/styles/tokens.css` → 0.
- [ ] Dropdown/context-menu open with no motion; highlighted item is a solid accent bar.
- [ ] Keyboard focus is visible on every interactive primitive in all three themes
  (D6 — verify with tab-through, not just code review).
- [ ] App chrome accent matches the xterm cursor color per theme (D5).
- [ ] Light theme contrast: body text and `--muted-foreground` on `--card` ≥ 4.5:1.
- [ ] Monaco + xterm panes visually continuous with chrome (no gradient seam).

## 10. Delivery plan: TUI as an opt-in theme (dark launch)

The restyle ships as a **fourth theme** (`data-theme="tui"`) so it is reviewable in
isolation, iterable behind a toggle, and invisible to parallel feature work until
explicitly promoted. This supersedes the in-place phases in §8 as the merge strategy
(§8's ordering still applies *within* the theme).

### 10.1 Isolation mechanics

- **Tokens**: all §4 values go in a `[data-theme="tui"]` block in `tokens.css`.
  `:root`, light, and warm remain byte-identical.
- **Primitives**: instead of rewriting cva strings, add a Tailwind custom variant next
  to the existing `dark` one:
  ```css
  @custom-variant tui (&:is([data-theme="tui"] *));
  ```
  Component edits become additive (`tui:shadow-none tui:rounded-none tui:transition-none
  tui:focus-visible:ring-0 …`). Existing themes render unchanged; conflicts with
  concurrent feature branches are append-only.
- **Shell chrome**: §6 overrides live in `tui.css`, every rule scoped under
  `[data-theme="tui"]` — `shell.css` itself is not edited until flatten.
- **Theme plumbing**: add `"tui"` to `src/lib/use-theme.ts` (maps to Monaco/xterm
  `dark` until a dedicated xterm palette lands).

### 10.2 Review tooling (build first)

- **Gallery route** (dev-only): renders all 9 primitives in every state — default,
  hover, focus-visible, disabled, open menus/dialog — plus a mock titled-pane layout.
- **Playwright screenshot script**: captures the gallery per theme into
  `tests/__screenshots__/`; PRs attach before/after PNGs. Review = compare two images,
  not read CSS diffs.

### 10.3 PR sequence (each independently revertable, zero visual change until G)

| PR | Content |
|---|---|
| A | Scaffold: `tui` theme option, `@custom-variant tui`, empty `tui.css`, gallery page, screenshot script |
| B | `[data-theme="tui"]` token block (§4: ladder, radius 0 + clamp, solid borders, ring=primary) |
| C | Buttons + input + textarea (`tui:` classes, §5.1–5.2) |
| D | Dialog + dropdown-menu + context-menu (§5.3, §5.5) |
| E | Tabs + switch + scroll-area (§5.4, §5.6–5.7) |
| F | Shell chrome in `tui.css`: gradients, glows, titled pane boxes (§6–§7) |
| G | **Flatten** (after sign-off): TUI tokens become the dark default, `tui:` prefixes inlined into base classes, theme scaffolding + `tw-animate-css` removed |

Until G, the TUI look is toggleable in-app for side-by-side comparison with the current
design, and a disliked direction is a one-PR revert. G is the only PR that changes what
users see by default, and by then every visual has been individually approved.

## 11. Risks / open questions

- **`lh` units in Electron/Chromium ≥ 120**: supported, but `1lh` inside flex children
  resolves against the element's own line-height — pin `line-height` at `:root` (§4.6)
  and avoid overriding it on containers that use `lh` sizing.
- **Reverse-video active states** (buttons/tabs) are bold; if too aggressive after a
  screenshot pass, fall back to accent-bar styles — both specced above.
- **Warm theme identity**: radius 0 + no glow changes its cozy feel the most. Consider
  `[data-theme="warm"] { --radius: 0.25rem; }` as a deliberate per-theme override —
  the token architecture supports it for free.
- **`tw-animate-css` import** becomes mostly dead after phase 2; drop it in phase 3 to
  trim the bundle.
