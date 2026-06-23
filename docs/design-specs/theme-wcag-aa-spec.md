# Theme legibility — WCAG AA contrast audit & improvement spec

**Status:** IMPLEMENTED (tokens.css, styles/hljs-light.css, main.tsx). Defaults
chosen for the §7 open questions: AA with margin; decorative-vs-functional border
split; light fixed + warm/tui inheritance pinned; proposed amber/red hues; markdown
code via the P1 per-theme stylesheet swap. During implementation the control-border
rows in §4 were corrected — see the note there.
**Scope:** the four palettes in `src/styles/tokens.css` — `dark` (default `:root`),
`light` (`[data-theme="light"]`), `warm`, `tui`. Token-level analysis; component
overrides in `src/app/shell.css` / `src/styles/tui.css` are referenced where they
turn a token gap into a concrete on-screen failure.

---

## 1. Summary

The reported "light theme text legibility is low" is real and **systematic**, not
cosmetic. Measuring every canonical text/surface pair against WCAG 2.1 AA found
**12 failures**, concentrated in `light`, plus two cross-cutting patterns that
affect every theme. The root causes are token-level (a handful of values), so the
fixes are centralized — not a per-component slog.

Three systematic causes:

1. **Inheritance gaps.** `light`, `warm`, and `tui` do not redefine every token,
   so they silently inherit the **dark** `:root` values for `--warning` (light,
   tui) and `--info` (warm, tui). In `light`, the inherited gold `--warning`
   (`oklch(0.828 0.122 75)`) lands on white → **1.73:1** as text, and **1.57:1**
   in the real `.shell-restore-warning` banner (gold on a near-white
   `--accent-strong` surface). Effectively invisible.
2. **Light secondary text is the weakest of any theme.** `--muted-foreground`
   = **4.77:1** on white — it clears AA by only 0.27 and fails AAA. It is used
   pervasively (labels, placeholders, timestamps, metadata) at 0.65–0.7rem
   (10–12px) where AA's 4.5:1 strictly applies. Every other theme's secondary
   text sits at 6.3–8.8:1. This is the pervasive "washed-out" feeling.
3. **Control borders & focus rings fall below the 3:1 non-text threshold**
   (WCAG 1.4.11 / 2.4.11). `--input` and `--ring` fail in `light` (1.23, 2.63)
   and `warm` (1.64, 2.60); `--input`-class borders are also low in `dark`/`tui`.
   In `light`, a text input fails on its border **and** its focus ring at once.

---

## 2. Methodology

- Each token resolved to linear sRGB: OKLCH → OKLab → linear sRGB (Björn
  Ottosson's matrices), hex → linear via the sRGB transfer function. Alpha colors
  (e.g. dark `--border: oklch(1 0 0 / 10%)`) are composited over their background
  in linear space before measuring.
- Contrast ratio = (L_hi + 0.05) / (L_lo + 0.05), L = 0.2126R + 0.7152G + 0.0722B
  on **linear** RGB (equivalent to the WCAG sRGB-relative-luminance definition).
- Inheritance applied per cascade: tokens a theme block does not set fall back to
  `:root`. Verified that `light`/`warm`/`tui` do not redefine `--warning`/`--info`
  as noted above. `--accent` is treated as its effective **foreground** value
  (bridges to `--primary` in dark/light/warm; pinned to `--primary` under tui by
  the accent-legibility sweep already landed).
- Thresholds: **normal text 4.5:1**, **large/bold text 3:1** (≥24px, or ≥18.66px
  bold), **UI components & focus indicators 3:1**. The app's chrome text is almost
  all 10–12px, so the 3:1 large-text relaxation rarely applies.
- Reproducible script: `scratchpad/wcag.mjs` (can be promoted to
  `scripts/wcag-audit.mjs` + a unit test — see §6).

---

## 3. Findings

### 3.1 Per-theme matrix (ratio, ✗ = AA fail)

| Pair (text on surface) | dark | light | warm | tui |
|---|---|---|---|---|
| body text / bg | 19.3 | 20.2 | 14.8 | 17.3 |
| secondary (`muted-foreground`) / bg | 7.68 | **4.77** | 8.76 | 6.77 |
| secondary / card | 6.79 | **4.77** | 8.05 | 6.31 |
| accent/link/status / bg | 16.4 | 17.8 | 6.53 | 10.3 |
| danger / bg | 6.97 | **4.76** | 5.15 | 6.70 |
| warning / bg | 11.7 | **✗ 1.73** | 7.90 | 11.2 |
| warning / card | 10.3 | **✗ 1.73** | 7.26 | 10.5 |
| info / bg | 8.31 | 5.44 | 6.95 | 7.99 |
| fg on secondary chip | 14.0 | 18.4 | 12.1 | 13.9 |
| primary-fg on primary (button) | 14.5 | 17.1 | 6.53 | 10.3 |
| **border / bg** (UI 3:1) | **✗ 2.92** | **✗ 1.23** | **✗ 1.64** | **✗ 1.65** |
| **border / card** (UI 3:1) | **✗ 2.68** | **✗ 1.23** | **✗ 1.51** | **✗ 1.54** |
| **focus ring / bg** (UI 3:1) | 4.17 | **✗ 2.63** | **✗ 2.60** | 10.3 |

(Italic note: `light` secondary 4.77 and danger 4.76 *pass* AA but only just; both
are flagged P1/P2 because they read as low at the chrome's small sizes.)

### 3.2 Failure roll-up (12)

- **light (5):** warning text ×2 (1.73), border ×2 (1.23), focus ring (2.63)
- **warm (3):** border ×2 (1.64 / 1.51), focus ring (2.60)
- **dark (2):** border ×2 (2.92 / 2.68)
- **tui (2):** border ×2 (1.65 / 1.54)

### 3.3 Concrete component manifestation

`.shell-restore-warning` (`src/app/shell.css:450`) = `color: var(--warning)` on
`background: var(--accent-strong)`. In `light`: gold on near-white = **1.57:1**.
This is the worst real on-screen instance and the most likely trigger of the
"light theme looks broken" impression. Fixed by the `--warning` change below
(→ 4.61:1).

---

## 4. Proposed changes (all values verified)

### P0 — broken / invisible

| Theme | Token | From | To | Result |
|---|---|---|---|---|
| light | `--warning` | `oklch(0.828 0.122 75)` (inherited) | `oklch(0.55 0.14 60)` | 1.73 → **5.05** (banner 1.57 → **4.61**) |

`light` must define its own `--warning`; today it inherits dark's gold. (Same
inheritance accident exists for `warm`→`--info` and `tui`→`--warning`/`--info`,
but those land on dark surfaces and currently pass — see P2 hygiene.)

### P1 — accessibility failures + the pervasive weakness

| Theme | Token | From | To | Result |
|---|---|---|---|---|
| light | `--muted-foreground` | `oklch(0.554 0.046 257.417)` | `oklch(0.50 0.046 257.417)` | 4.77 → **5.99** |
| light | `--ring` | `oklch(0.704 0.04 256.788)` | `oklch(0.55 0.04 257)` | 2.63 → **4.85** |
| light | `--input` (control border) | `oklch(0.929 0.013 255.508)` | `oklch(0.6 0.04 257)` | 1.23 → **~3.9** |
| warm | `--ring` | `#6d5b46` | `#9a8266` | 2.60 → **4.63** |

`--muted-foreground` is the systematic light-theme legibility fix; it also lifts
input **placeholders** (`placeholder:text-muted-foreground`) above the borderline.

> **Correction made during implementation.** Control borders use `--input`
> (`border-input`), **not** `--border`. Re-measuring the actual `--input`/`--ring`
> per theme showed: **dark** `--input` = white/15% = **3.88:1** and **warm**
> `--input` = *inherited* white/15% = **3.38:1** — both already meet 3:1, so no
> change. The earlier "warm/dark `--input`" rows were measuring the decorative
> `--border` by mistake. Only **light** `--input` (1.23) and the **light/warm
> `--ring`** focus indicators actually failed and were changed. **tui** controls
> use `--input` as a fill (border-0); its 1.65:1 value is the structural
> `--border`, left as the design language per §5.

### P2 — margins & hygiene (passing today, recommended)

| Theme | Token | From | To | Result |
|---|---|---|---|---|
| light | `--danger`/`--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.52 0.24 27.325)` | 4.76 → **5.70** |
| warm | define own `--info` | (inherited from dark) | `oklch(0.72 0.13 235)` | stop silent inheritance |
| tui | define own `--warning` / `--info` | (inherited from dark) | explicit values | stop silent inheritance |

---

## 5. Decisions & non-goals

- **Decorative dividers vs. control borders.** WCAG 1.4.11 requires 3:1 only for
  borders *needed to identify a component or its state* — i.e. input/textarea/
  toggle/focusable-tile outlines (`--input`, `--ring`). Pure pane-separating
  dividers (`--border`) are decorative and exempt. **Recommendation:** strengthen
  `--input`/`--ring` to meet 3:1 (P1/P2 above) and leave `--border` (dividers) as
  the lighter, lower-contrast value, so the UI doesn't turn boxy/heavy. Making
  *all* borders 3:1 is the alternative if you prefer a uniformly stronger frame —
  flagged as an open question. (Implemented: `--input`/`--ring` strengthened only
  where they failed — light `--input`, light/warm `--ring`; dark/warm `--input`
  already met 3:1; tui's structural `--border` left as its design language.)
- **Disabled controls** use `opacity: 0.5` and are WCAG-exempt; not addressed.
- **Hues are conservative suggestions.** The proposed warning/danger hues keep the
  existing amber/red families; tune for brand if desired — the contrast targets
  are what matter.
- **Token-level fix.** The failures are all in tokens, so no broad per-component
  work is needed (unlike the just-landed tui accent sweep, which existed because
  components hardcoded `var(--accent)` as a foreground).

---

## 6. Verification plan

1. Re-run the audit script after edits — every flagged pair must clear its
   threshold; no previously-passing pair may regress.
2. Promote `scratchpad/wcag.mjs` → `scripts/wcag-audit.mjs` and add a Vitest test
   asserting the canonical matrix stays ≥ threshold. This prevents recurrence of
   the exact inheritance gap that caused the light `--warning` bug.
3. Capture before/after PNGs with the existing
   `tests/e2e/ui-gallery.screenshots.spec.ts` (`pnpm build && pnpm exec playwright
   test ui-gallery`) across all four palettes.

---

## 7. Open questions for the reviewer

1. **Target AA or AAA?** Proposal targets AA with comfortable margins (~6:1 for
   secondary text). Going AAA (7:1) would darken secondary/muted further.
2. **Borders:** accept the decorative-vs-functional split (§5), or make *all*
   borders 3:1 for a uniformly stronger frame?
3. **Inheritance hygiene:** fix only `light` now, or also give `warm`/`tui`
   explicit `--warning`/`--info` so no theme inherits dark's semantic colors?
4. **Light warning/danger hues** — keep the proposed amber/red, or match a
   specific brand palette?
5. **Markdown code blocks** (§8) — pragmatic per-theme stylesheet swap, or the
   fuller token-mapped highlighter?

---

## 8. Markdown preview (Files review)

Covers the rendered markdown shown in the Files review (`InlineEditor` preview,
`.shell-inline-editor__preview-body`) and the standalone `MarkdownPreviewModal`
(`.shell-md-modal__body`). Markdown body text, headings and inline code use themed
tokens and are fine (or already fixed); the problem is **syntax highlighting**.

### M1 (systematic) — hardcoded `github-dark` highlight theme in every palette

`MarkdownPreviewModal.tsx:12` and `InlineEditor.tsx:14` both
`import "highlight.js/styles/github-dark.css"` unconditionally. That stylesheet
pins `.hljs { background: #0d1117; color: #c9d1d9 }` with light token colors, so a
**fenced code block renders as a github-dark dark box under all four app themes**,
ignoring `--panel-bg-elevated`:

- **light:** a stark `#0d1117` black box inside an otherwise white preview — the
  most visible "md preview looks broken" symptom.
- **warm / tui:** the `#0d1117` box and token hues ignore the palette; the box
  doesn't match the themed `pre` padding around it.
- **dark:** least bad, but still `#0d1117` ≠ the app's `--panel-bg-elevated`, so
  the code box is a slightly different shade than adjacent surfaces.

The code text *inside* the box is readable (base `#c9d1d9` 12.3:1, comment
`#8b949e` 6.2:1 on `#0d1117`) — this is a **theming/consistency** defect with a
clear light-theme legibility cost, not an in-box contrast failure.

**Important constraint:** you cannot fix this by only retinting the box background
to the themed surface — github-dark's light tokens on a white surface measure
**1.54–1.95:1** (base `#c9d1d9` 1.54, string `#a5d6ff` 1.54, number `#79c0ff`
1.95 on white): unreadable. The token set must change with the surface.

**Recommendations:**
- **P1 (minimal, correct contrast):** load a light highlight stylesheet
  (`highlight.js/styles/github.css`) under `[data-theme="light"]` and keep
  `github-dark.css` for dark/warm/tui. Scope each import so only one applies.
  This alone fixes the unreadable/jarring light case.
- **P2 (full coherence):** map hljs tokens to app tokens — a small CSS layer
  (`.hljs-keyword{color:var(--md-code-keyword)} …` keyed off `--primary/--info/
  --danger/--warning`) plus `.hljs{background:var(--panel-bg-elevated)}` — so code
  blocks inherit each palette and the themed surface. Best result; more work.

### M2 — markdown secondary text inherits the light `--muted-foreground` weakness

`blockquote` and `del` use `--text-muted`; table headers (`th`) use
`--text-secondary` — both resolve to `--muted-foreground` → **4.77:1** in light
(borderline). No separate change needed: the **P1 `--muted-foreground` fix**
(§4, → 5.99:1) lifts all three.

### M3 — table gridlines & blockquote bar

- Table cell borders use `--panel-border` (light **1.23:1**). Unlike decorative
  pane dividers, data-table gridlines arguably *delineate the cells* and so fall
  under the 3:1 non-text rule. Recommend they track the strengthened control/
  functional border value (§4/§5) rather than the decorative `--border`.
- The `blockquote` left bar uses `--panel-border-strong` (= `--ring`; light
  **2.63:1**). It is the sole indicator of the quote → bump with the `--ring`
  fix (§4, → 4.85:1) or a dedicated visible token.

### M4 — already fine (no action)

- Body text & headings: `--text-primary` → 16–20:1 every theme.
- Inline code (`:not(pre) > code`): `color: var(--accent)` on
  `--panel-bg-elevated` — themed; passes in dark/light/warm; the tui dark-on-dark
  case was fixed by the landed accent-legibility sweep (`tui.css`).
