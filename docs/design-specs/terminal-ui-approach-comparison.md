# Plans: Two Routes to a Terminal UI Look

**Status:** Draft for decision — no implementation in this document.
**Date:** 2026-06-19
**Decision recorded:** End state = **opt-in 4th theme** (`data-theme="tui"`), toggleable
alongside `dark`/`light`/`warm`. **No flatten (no PR G)** — the TUI look never becomes the
forced default; it stays a switchable option. The plans below are written to that intent.
**Reference studied:** [WebTUI](https://webtui.ironclad.sh/start/intro/) — `@webtui/css`
v0.1.7, both docs and shipped source.

---

## 0. Decisive context (current repo state)

This project has **already chosen and largely built the "modify the design system"
route.** `docs/tui-css-spec.md` is that plan — it read WebTUI's *source*, extracted the
six CSS techniques that create the terminal look, kept shadcn as the architecture, and
**explicitly rejected WebTUI-the-package** (its `is-=`/`box-=` attribute API and
`data-webtui-theme` switch). The work is implemented through "PR F" and is toggleable
in-app.

The catch is branch state (verified 2026-06-19):

| Where | TUI spec doc | TUI **implementation** (`tui.css`, `[data-theme="tui"]` block, `@custom-variant tui`, `UiGallery.tsx`, screenshot spec, `tui:` classes on the 9 `ui/*` primitives) |
|---|---|---|
| `devel` / `terminal-ui-rework` | ✅ | ❌ **absent** |
| `feat/terminal-ui-theme` (36 commits, **not merged**) | ✅ | ✅ |

`feat/terminal-ui-theme` forked from an old `devel` (merge-base `1809674`, v0.7.3 era)
and is now **219 commits behind** current `devel`; **21** of those touch `tokens.css` and
the `ui/*` primitives (the shadcn migration was independently re-landed on `devel` with
different SHAs). Net: **the TUI layer is built but stranded on a stale base.**

So the real question is not "which approach" but "re-land the validated work vs. start
over with a package."

---

## 1. WebTUI compatibility analysis (vs. Tailwind v4 + shadcn)

From WebTUI's actual source (`packages/css/src/{base,utils/box,components/button}.css`):

- **Pure CSS, attribute-selector API.** `<button is-="button" box-="round" size-="large">`.
  No React components. Coexists awkwardly with shadcn's `className` + cva model — you'd
  author two different ways in one codebase.
- **Aggressive global reset (blast radius = whole app).** `base.css` sets
  `* { margin:0; padding:0; box-sizing:border-box; outline:none }` and
  `html,body { font-family: monospace; word-break: break-all }`. The `word-break:
  break-all` and bare resets fight Tailwind's preflight and would hit xterm/Monaco panes.
- **Bare-element component rules.** `button.css` styles raw `button` (and
  `input[type=...]`), not just `[is-]` — it restyles *every* shadcn button unless layer
  order is managed.
- **Cascade-layer collision.** WebTUI declares `@layer base, utils, components`; Tailwind
  v4 declares `@layer theme, base, components, utilities`. Safe coexistence needs one
  unified `@layer` line declared before any import, so Tailwind utilities still override
  WebTUI components.
- **The genuinely good parts** — the box-drawing border (`::before` inset by half a cell,
  `padding: 1lh 1ch`, `ch`/`lh` units) and character-grid sizing. **These are exactly what
  `tui.css` on `feat/terminal-ui-theme` already ports by hand**, minus the reset/selector
  baggage.

Component inventory if adopted (19): accordion, badge, button, checkbox, dialog, input,
popover, pre, progress, radio, range, separator, spinner, switch, table, textarea,
tooltip, typography, view. Utils (1): box. Theme plugins:
`@webtui/theme-{catppuccin,gruvbox,nord,everforest,vitesse}`.

---

## 2. Plan A — Modify the current design system (shadcn-native TUI) — **recommended**

**Thesis:** Finish the approach the team already validated. No new dependency; re-land the
stranded `tui` layer onto current `devel` and complete it **as a permanent opt-in theme**
(no flatten).

Because the chosen end state is opt-in, the work is *entirely additive and theme-scoped*
— `[data-theme="tui"]` tokens, an unlayered `tui.css`, and `tui:`-prefixed utility
classes. Existing `dark`/`light`/`warm` rendering stays byte-identical, and the risky
"flatten" PR (G) is dropped from scope.

### Phase 0 — Re-land the stranded work (the real cost)

The `tui` layer is portable (additive/scoped) but its base is 219 commits stale.

- **Cherry-pick / port the self-contained, low-conflict pieces** onto `terminal-ui-rework`:
  - `src/styles/tui.css` (unlayered overrides — wins cascade without specificity games)
  - the `[data-theme="tui"]` token block + `@custom-variant tui (&:is([data-theme="tui"] *))`
    in `src/styles/tokens.css`
  - `src/app/UiGallery.tsx` and the `#/ui-gallery` hash gate in `src/main.tsx`
  - `tests/e2e/ui-gallery.screenshots.spec.ts`
    — **reconcile** with `devel`'s existing `ui-gallery` smoke spec (`d807ee1`/`72f9516`);
    do not duplicate.
- **Re-apply the `tui:` utility classes by hand** to **devel's** versions of the 9
  `src/components/ui/*.tsx` primitives (button, input, textarea, dialog, tabs, switch,
  scroll-area, dropdown-menu, context-menu) — these diverged on `devel`, so cherry-pick
  will conflict; apply the `tui:` additions manually per spec §5.
- **Register the theme:** add `"tui"` to `src/lib/use-theme.ts` (map to Monaco/xterm
  `dark` for now).
- **Fallback** if the port is too messy: rebuild from `tui-css-spec.md` §4–§7 directly on
  `devel` — the spec is prescriptive enough for a clean rebuild.

### Phase 1 — Verify parity
Run the Playwright gallery screenshots per theme into `tests/__screenshots__/`; confirm
`tui` renders flat / square / monospace / reverse-video selection, matching the as-built
notes in `tui-css-spec.md` §12.

### Phase 2 — Finish the deferred TUI items (spec §12.2)
- Light + warm TUI ladders (only the dark ladder exists today).
- Real shell panes adopt the `.tui-box` titled-border utility (`┌─ SESSIONS ──┐`) —
  layout-affecting (`1lh/1ch` padding), so screenshot each pane.
- Optional powerline badge caps for provider chips (Meslo Powerline font already shipped).
- Dedicated xterm `tui` palette (currently aliased to `dark`).

### Phase 3 — Keep it as an opt-in theme (no flatten)
Per the recorded decision, **skip PR G.** The `tui:` prefixes, `@custom-variant tui`,
`[data-theme="tui"]` block, and unlayered `tui.css` all *stay*. Consequences:
- `tw-animate-css` remains imported (other themes use it) — that's fine; not dropped.
- The "deferred to flatten" grep-based acceptance criteria in spec §9 are **moot** by
  design (they only mattered if TUI became the default).
- Net maintenance cost of keeping it opt-in: every new `ui/*` primitive or shell-chrome
  surface needs its `tui:` variant / `tui.css` rule added alongside — a standing
  convention, not a one-time task.

**Pros:** zero new deps; preserves the just-finished shadcn migration; reuses ~85%-built,
screenshot-verified work; fully reversible (it's a toggle); a11y focus rings already
handled (spec D6); matches the recorded opt-in intent exactly.
**Cons:** Phase 0 re-land has genuine merge friction (stale base, diverged primitives);
the structural TUI bits (pane boxes, any grid retrofit of the 4,767-line `shell.css`) stay
partly manual; permanent opt-in adds a standing "remember the `tui:` variant" convention.
**Effort:** Medium, front-loaded into Phase 0.

---

## 3. Plan B — Implement the WebTUI package

**Thesis:** Add `@webtui/css` and adopt its styling for the terminal look (also as an
opt-in surface, per the recorded end state).

### Phase 1 — Install & layer-reconcile
Add `@webtui/css` (+ optionally `@webtui/theme-gruvbox` or similar). Rewrite the top of
`tokens.css` to a single unified `@layer` declaration so Tailwind utilities still win over
WebTUI components. Import **selectively per component**
(`@import "@webtui/css/components/button.css"`, `@import "@webtui/css/utils/box.css"`),
never `full.css`, to limit blast radius.

### Phase 2 — Contain the global reset
Neutralize `word-break: break-all` and the bare-element `button`/`input` rules so they
don't hit shadcn primitives or the xterm/Monaco panes — scope WebTUI under a wrapper /
`[data-theme="tui"]` selector rather than `:root`/`html`.

### Phase 3 — Choose an authoring model (the fork in the road)
- **B-thin:** keep shadcn primitives; use WebTUI only for the `box-` border util + token
  vars. *This converges on what `tui.css` already is — making the package largely
  redundant.*
- **B-full:** re-author components with WebTUI attributes (`is-=`, `box-=`), partially
  abandoning the recent shadcn migration.

### Phase 4 — Token bridge
Map WebTUI's `--background0..3` / `--foreground0..2` / `--font-family` to/from the shadcn
tokens so both systems share one palette; wire `data-webtui-theme` to the existing
`data-theme` switch.

**Pros:** less hand-written CSS for the border/grid primitives; upstream theme plugins
(Catppuccin/Gruvbox/Nord/…) for free; canonical terminal look maintained upstream.
**Cons:** new dependency conflicting with a stack the team *just* migrated to; ongoing
global-reset and cascade-conflict maintenance; two parallel authoring models; **B-thin
makes the package nearly pointless, B-full discards recent migration work**; the team
already evaluated and rejected exactly this route in `tui-css-spec.md` §2.
**Effort:** Medium–High, with recurring cascade-conflict maintenance.

---

## 4. Recommendation

**Plan A.** The hard analysis is already done: the team read WebTUI's source, isolated the
techniques that actually create the terminal look, and ported the two worth owning
(box-border + `ch`/`lh` grid) into `tui.css` *without* WebTUI's reset/selector/layer
baggage. Plan B's only real win (the box util) is already replicated; its honest "thin"
form collapses back into Plan A, and its "full" form throws away the recent shadcn
migration.

Given the recorded **opt-in 4th theme** decision, Plan A is also the lower-risk fit: the
whole TUI layer stays additive and toggleable, and the one genuinely risky step (flatten /
PR G) is dropped entirely. The actual open work is **Phase 0 — re-landing
`feat/terminal-ui-theme` onto current `devel`** — plus finishing the light/warm ladders
and pane boxes.

## 5. Suggested next step (not yet executed)
Promote Plan A to a concrete, file-level execution checklist (cherry-pick list for the
portable pieces + per-file `tui:` class diffs for the 9 diverged primitives), then execute
Phase 0 on `terminal-ui-rework`.

---

### Sources
- WebTUI repo & source — https://github.com/webtui/webtui
- WebTUI theming — https://webtui.ironclad.sh/start/theming/
- `@webtui/css` on npm — https://www.npmjs.com/package/@webtui/css
- Internal: `docs/tui-css-spec.md`, `src/styles/tokens.css`,
  `feat/terminal-ui-theme:src/styles/tui.css`
