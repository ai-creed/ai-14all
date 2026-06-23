# Light theme — WCAG AAA audit & improvement spec

**Status:** IMPLEMENTED. P0 resolved to **option A — flatten light to a
token-driven white surface** (`shell.css` `[data-theme="light"] body` now uses
`var(--app-bg)`; the radial gradient was dropped so the page, overlays and the UI
gallery all share `--background`). P1 AAA color values applied to `tokens.css`
(`--muted-foreground` 0.42, `--info` 0.42, `--warning` 0.43, `--destructive`
0.45). Dark/warm/tui untouched.
**Scope:** the `light` palette (`[data-theme="light"]` in `src/styles/tokens.css`),
its rendered page surface (`src/app/shell.css`), and the UI gallery
(`src/app/UiGallery.tsx`). Follows on from `docs/theme-wcag-aa-spec.md` (AA, landed).
**Trigger:** the app's light-theme background does not match the UI-gallery
("UI library") screen. Investigating that surfaced a measurement gap that also
changes the contrast results.

---

## 1. Summary

Two coupled problems, both rooted in one fact: **the light theme's real page
surface is not the `--background` token.**

1. **Surface divergence (the reported bug).** The app paints a hardcoded
   blue-grey radial gradient on `body` and makes the chrome panels transparent,
   so users see the gradient. The UI gallery — and every shadcn `bg-background` /
   `bg-card` surface, plus dialogs, popovers, dropdowns and inputs — renders on
   the `--background` / `--card` token, which is **pure white** (`oklch(1 0 0)`).
   The two surfaces are different colors, so the gallery looks whiter/cooler than
   the live app. This is a real token/source-of-truth defect, not a perception
   issue.

2. **The AA audit measured the wrong surface.** `docs/theme-wcag-aa-spec.md`
   measured every text color against `--background = white`. Real chrome text
   sits on the darker gradient, so the true ratios are **~0.85×** the audited
   ones. Re-measuring against the real surface, **`--warning` (the AA-era fix,
   `oklch(0.55 0.14 60)`) drops to 4.31:1 at the top of the gradient — back below
   AA.** The AA pass was partly an artifact of measuring against white.

At the **AAA** bar (7:1 normal text), four light-theme colors that pass AA fail
AAA on the real surface: `--muted-foreground`, `--info`, `--warning`,
`--danger`/`--destructive`. Body text, primary/accent/link text, and the
non-text borders/rings already clear their bars.

---

## 2. The surface divergence (root cause)

| Where | What paints the surface | Resolves to |
|---|---|---|
| Live app chrome | `[data-theme="light"] body { background: radial-gradient(circle at top, #e8edf4 0%, #f0f2f5 55%); }` (`shell.css:78`), panels `background: transparent` (`.shell-app`, `.shell-panel`) | blue-grey gradient `#e8edf4 → #f0f2f5` |
| UI gallery | `<div class="… bg-background …">` (`UiGallery.tsx:58`) | `--background` = `oklch(1 0 0)` = **white** |
| Dialogs / popovers / menus / inputs | shadcn `bg-popover` / `bg-card` / `bg-background` | `--popover`/`--card`/`--background` = **white** |

So the light theme actually renders on **two** surfaces: a blue-grey gradient
(chrome) and pure white (overlays + the gallery). `--background` is declared
white but is never the thing you see behind the chrome. Consequences:

- **Visual:** the gallery (white) ≠ the app (gradient) — the reported mismatch.
  Overlays (white) also sit slightly lighter than the chrome they cover.
- **Legibility:** the gradient is *darker* than white, so it **lowers** dark-text
  contrast by ~0.6–0.9 ratio points versus a white page. For a legibility goal
  the gradient works against us.
- **Auditability:** any audit or screenshot of the gallery does not represent the
  live app, because they don't share a surface.

The two surface colors used below (`#e8edf4`, `#f0f2f5`) and white are all
measured; `#e8edf4` (gradient top) is the worst case for dark text.

---

## 3. Methodology

Same engine as the AA spec (OKLCH → OKLab → linear sRGB via Ottosson's matrices;
hex → linear via the sRGB transfer function; contrast `(L_hi+.05)/(L_lo+.05)` on
relative luminance). **Change from the AA spec:** text is measured against the
**actual rendered surfaces** — `#e8edf4` (gradient top, worst case), `#f0f2f5`
(gradient body, dominant), and `white` (overlays/gallery) — not only the
`--background` token. Script: `scratchpad/wcag-aaa.mjs` (promote to
`scripts/wcag-audit.mjs`, see §6). Thresholds: **AAA normal text 7:1**, AAA large
text (≥24px, or ≥18.66px bold) 4.5:1; **non-text UI 3:1 (WCAG 1.4.11 — no AAA
tier exists, so AAA = AA here)**. App chrome is 11–16px, so the 7:1 normal-text
bar applies almost everywhere.

---

## 4. AAA findings — light theme

Ratios are `white(overlays) / #f0f2f5(chrome body) / #e8edf4(chrome top, worst)`.
AAA verdict is taken on the **worst surface the color actually appears on**.

| Token (role) | white | #f0f2f5 | #e8edf4 | AAA? |
|---|---|---|---|---|
| `--foreground` (body) | 20.2 | 18.0 | 17.2 | ✅ AAA |
| `--primary` (accent/link/button text) | 17.8 | 15.9 | 15.2 | ✅ AAA |
| `--muted-foreground` (labels, placeholders, timestamps) | 5.99 | 5.35 | 5.10 | ❌ AA only |
| `--danger` / `--destructive` | 6.26 | 5.58 | 5.32 | ❌ AA only |
| `--info` | 5.54 | 4.94 | 4.71 | ❌ AA only |
| `--warning` | 5.07 | 4.52 | **4.31** | ❌ **fails AA on #e8edf4** |
| `--input` (control border, non-text 3:1) | 3.94 | 3.51 | 3.35 | ✅ (≥3) |
| `--ring` (focus, non-text 3:1) | 4.85 | 4.32 | 4.12 | ✅ (≥3) |
| `--border` (decorative divider, exempt) | 1.23 | 1.10 | 1.05 | n/a (exempt) |

**Roll-up:** 4 AAA text failures (`muted-foreground`, `danger`, `info`,
`warning`), one of which (`warning`) is actually an **AA regression** once
measured on the real surface. Non-text borders/rings already meet 3:1 on every
surface, and WCAG adds no AAA non-text tier, so they need no change.
`--muted-foreground` is the highest-impact failure — it is the pervasive
secondary text (labels, placeholders, metadata) the original "washed out" report
was about.

---

## 5. Proposed changes

### P0 — fix the surface divergence (do this first; it sets the contrast target)

Make the rendered surface a token, so the gallery, overlays and live chrome agree
and the audit measures reality. Two options:

- **A (recommended) — flatten to a token-driven near-white.** Drop the
  hardcoded `body` gradient; set `body { background: var(--background); }` and
  keep `--background`/`--card`/`--popover` white (or one shared near-white). The
  gallery already uses `bg-background`, so it matches automatically; overlays and
  chrome become the same surface; text gets the **maximum** light-surface
  contrast (the white column above), making AAA easiest. Cost: lose the subtle
  radial depth.
- **B — keep the gradient but tokenize it and apply it everywhere.** Define
  `--surface-from`/`--surface-to` tokens, build the `body` gradient from them,
  set `--background` to the dominant stop (`--surface-to`), and give the gallery
  root the same gradient. Keeps the depth; more code; text still sits on the
  darker gradient, so the AAA color targets must hold at `#e8edf4` (the
  worst-case column).

Either way, **decide the surface before locking the color values** — the AAA
targets in P1 are chosen to clear 7:1 on the *worst* surface (`#e8edf4`), so they
are safe under **both** options. If you adopt A, they clear with extra margin
(≥8.4:1).

### P1 — AAA color values (verified ≥7:1 on white **and** #e8edf4)

| Token | From (AA-era) | To (AAA) | white / #f0f2f5 / #e8edf4 |
|---|---|---|---|
| `--muted-foreground` | `oklch(0.5 0.046 257.417)` | `oklch(0.42 0.046 257.417)` | 8.46 / 7.54 / **7.19** |
| `--info` | `oklch(0.52 0.17 250)` | `oklch(0.42 0.17 250)` | 8.58 / 7.65 / **7.29** |
| `--warning` | `oklch(0.55 0.14 60)` | `oklch(0.43 0.14 60)` | 8.51 / 7.58 / **7.23** |
| `--danger` / `--destructive` | `oklch(0.52 0.24 27.325)` | `oklch(0.45 0.24 27.325)` | 8.48 / 7.56 / **7.21** |

All four keep their existing hue/chroma family (blue-grey, blue, amber, red) and
only drop lightness; they remain visually distinct status colors, just deeper and
more saturated-reading on a light page. `--muted-foreground` also lifts
placeholders (`placeholder:text-muted-foreground`), blockquotes, `del`, and table
headers (`--text-secondary`/`--text-muted` bridge to it) to AAA in one move.

### P2 — consistency follow-ups (not strictly AAA)

- The `--warning` AA regression (§4) means the live banner
  `.shell-restore-warning` (gold-family on `--accent-strong`) should be
  re-measured on its *actual* surface after the P0 decision, not assumed from the
  white-surface number.
- Re-run the non-text borders/rings on the chosen P0 surface to confirm they stay
  ≥3:1 (they do on all three measured surfaces today: `--input` 3.35–3.94,
  `--ring` 4.12–4.85).
- The decorative `--border` divider (1.05–1.23) stays exempt and unchanged, per
  the AA spec's decorative-vs-functional split (`docs/theme-wcag-aa-spec.md` §5).

---

## 6. Verification plan

1. Apply P0 first; re-run `scratchpad/wcag-aaa.mjs` so every text pair is measured
   against the surface that ships.
2. Apply P1; confirm all four tokens clear 7:1 on the shipping surface and no
   previously-passing pair regresses.
3. Promote the script to `scripts/wcag-audit.mjs` + a Vitest assertion that the
   light matrix stays ≥7:1 (text) / ≥3:1 (non-text). This also guards the
   inheritance gaps the AA spec found.
4. Capture before/after gallery PNGs across palettes
   (`tests/e2e/ui-gallery.screenshots.spec.ts`) — and add a live-chrome
   screenshot, since the gallery alone no longer (P0-A) / still does not (P0-B)
   diverge from the app.

---

## 7. Open questions

1. **Surface: P0-A (flatten to white) or P0-B (tokenized gradient everywhere)?**
   A is simpler, most legible, and resolves the report directly; B preserves the
   radial depth. The P1 values are safe under either.
2. **AAA across the whole app, or AAA for light only?** This spec covers light
   (the reported theme). `dark`/`warm`/`tui` secondary text already sits at
   6.3–8.8:1 — close to AAA — but only `dark`/`tui` body text clearly clears 7:1
   everywhere; a follow-up could extend the matrix to all four palettes.
3. **Status-color depth.** The P1 colors are noticeably darker. Keep these for
   strict AAA, or accept AA-with-margin (~6:1) for the status hues to keep them
   brighter, reserving AAA for the high-frequency `--muted-foreground` only?
