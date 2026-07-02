# Session View P0 UX — Design

**Date:** 2026-07-02
**Status:** DESIGN — approved in brainstorming; awaiting spec review before planning.
**Source:** `docs/design-critique-2026-07-02.md` (findings #1, #2, #3 — the three 🔴 P0s).

## 1. Goal

Ship the three highest-impact, app-owned UX fixes from the 2026-07-02 design
critique as one coherent slice of work, without touching the embedded agent CLIs'
own rendering:

1. **#1 — Terminal font size is user-controlled and persisted** (today it is
   dictated solely by slot count, with no override and no readable floor).
2. **#2 — Launchers read as actions; the collab pill reads as status** (today
   they share nearly identical styling).
3. **#3 — `actionRequired` carries a non-color signal, and truncated sidebar
   rows have consistent tooltips** (today the must-not-miss state is encoded by
   color + animation alone).

Each finding is an independent, separately-shippable slice (§4). The work spans
more than three files in total, so it is deliberately decomposed into three
slices; each slice is small enough to land on its own.

## 2. Non-goals

- **The terminal measure/column cap is explicitly cut.** The critique's #1 also
  proposed a max-column cap with centered gutters for single-slot layouts. We are
  **not** building it. Rationale: the common layout is two slots, where each pane
  is already ~70 cols (inside the readable 45–90 band), so the cap only ever helps
  the rarer single-slot view; and a terminal cap is not CSS `max-width` — it means
  running the PTY at fewer columns, which narrows *every* program (wide git logs,
  tables, diffs, and the agent CLIs' own boxes), not just prose. Cost touches all
  content, benefit touches one layout. Revisit only if single-slot users ask.
- Findings #4–#9 and the engineering-risk item (shell.css token-lint /
  hardcoded-hex cleanup) are out of scope for this spec; they get a follow-up.
- No change to the attention *classifier* logic (`agent-attention.ts` state
  derivation). #3 changes only how the already-derived `actionRequired` state is
  presented in the sidebar.
- Per-terminal font size. The font size is global (§4.1).
- No new settings panel. #1's control lives in the app menu + keyboard, matching
  the existing theme mechanism.

## 3. Corrections to the critique (grounded against the code)

The critique was screenshot- and survey-based; three concrete claims needed
correction after reading the source, and the design reflects the corrected facts:

- **"oklch tokens" live in `shell.css".** They do not. `src/app/shell.css` (6,105
  lines) contains **zero** oklch; it uses `rgb()` plus **47 hardcoded hex colors**.
  The oklch tokens live in `src/styles/tokens.css`. (Relevant to the deferred
  engineering-risk item, not to this spec, but recorded for accuracy.)
- **"No tooltip" on truncated sidebar rows.** Native `title=` tooltips already
  exist (`SessionSidebar.tsx:397` on the task line, and on several other rows).
  A proper Radix `Tooltip` primitive also exists (`src/components/ui/tooltip.tsx`)
  and is used elsewhere. So #3's tooltip work is an **upgrade + coverage audit**,
  not an addition (§4.3).
- **Launchers are already `<button>`s.** `AgentLauncherBar.tsx` renders real
  buttons with `aria-label` and a leading icon; the collab pill is already a
  non-interactive `<span>`. So #2 is a **visual affordance** change only — no
  semantic/accessibility-role fix needed (§4.2).

Also for the record: the sidebar's rolled-up attention model has **three** states
(`ProcessAttentionState = "idle" | "activity" | "actionRequired"`,
`shared/models/process-session.ts:7`), not seven. The richer seven-ish classifier
(`AgentAttentionState`: idle/active/waiting/ready/failed/stale) is mapped down to
those three for the sidebar via `mapToProcessAttentionState`
(`agent-attention.ts:210`). #3 targets the rolled-up `actionRequired`.

## 4. Design

### 4.1 Slice 1 — Terminal font size control (#1)

**Current behavior.** `TerminalPanel.tsx:100` computes the size purely from slot
count: `const terminalFontSize = 12 - Math.floor((layout.slotCount - 1) / 2);`
and passes it to each `TerminalPane` (`:217`). `TerminalPane` applies it to the
xterm instance on init (`:198`) and on change (`:351–356`). There is no user
override, no persistence, and single-slot renders at 12px.

**Change.** Replace the slot-count computation with a **global, persisted,
user-controlled font size**. Model (a), chosen in brainstorming: your size is your
size; splitting just shows less content (same as tmux/iTerm). Slot-count
auto-scaling is removed.

- **Value + bounds.** Default **13px**. Clamp to **[10, 20]**. One global value.
- **Control surface — app menu + keyboard, mirroring the theme mechanism.** Theme
  is driven by native menu items that emit an event the renderer consumes over the
  preload bridge (`electron/main/menu.ts` → `onSetTheme`,
  `electron/preload/index.ts:448`, consumed in `src/lib/use-theme.ts`). Font size
  follows the same path:
  - Add menu items (under a **View** or **Terminal** submenu): *Increase Font
    Size* (`CmdOrCtrl+Plus`), *Decrease Font Size* (`CmdOrCtrl+-`), *Reset Font
    Size* (`CmdOrCtrl+0`). Native accelerators give the keyboard shortcuts and the
    menu gives discoverability (satisfies the critique's discoverability concern
    without a new panel).
  - Add a preload bridge event (e.g. `onAdjustTerminalFontSize(handler)` carrying
    `"increase" | "decrease" | "reset"`), typed in `src/types/global.d.ts`.
  - **Why menu accelerators, not a renderer keydown handler (important).** When a
    terminal pane is focused, xterm.js parks keyboard focus in a hidden
    `<textarea class="xterm-helper-textarea">`, so a document-level keydown
    shortcut is silently swallowed by the app's typing guard unless it opts in via
    the canonical `targetOwnsTyping(target, { allowXterm: true })` helper
    (`src/app/target-owns-typing.ts`; see the Cmd+P/Cmd+J history). Native menu
    accelerators fire above the web contents and are **not** subject to this, so
    the menu path is the correct one here and avoids the whole class of bug. The
    chosen accelerators don't collide with xterm's own bindings — `TerminalPane`'s
    `attachCustomKeyEventHandler` only claims Shift+Enter, Cmd/Ctrl+F, Cmd/Ctrl+K.
    Register both `CmdOrCtrl+Plus` and `CmdOrCtrl+=` for the increase item (the
    unshifted `+` key is `=`). If a renderer-level handler is ever used as a
    fallback, it MUST route through `targetOwnsTyping({ allowXterm: true })` and be
    tested with a real `<textarea class="xterm-helper-textarea">` as the keydown
    target — a plain `<div>` inside `.xterm` never hits the TEXTAREA guard and
    gives false-green tests.
- **Persistence + state — new hook** `useTerminalFontSize` at
  **`src/features/terminals/hooks/use-terminal-font-size.ts`**. Per the Frontend
  Structure contract (`AGENTS.md:51,58`), React hooks live under `hooks/`
  (kebab-case filename, camelCase export); `src/features/terminals/hooks/` already
  exists, so the hook goes there — **not** under `logic/`. It follows the existing
  localStorage-hook pattern (`use-collapsed-workspaces.ts`): `STORAGE_KEY =
  "ai14all.terminalFontSize"`, `read()` with `try/catch` and range validation,
  `useState(read)`, setter clamps and writes back. The hook exposes the current
  size and `increase()/decrease()/reset()`. `TerminalPanel` uses the hook's value
  in place of the `:100` computation and subscribes to the bridge event.

**Files touched (~5 + tests):** `electron/main/menu.ts`,
`electron/preload/index.ts`, `src/types/global.d.ts`,
`src/features/terminals/hooks/use-terminal-font-size.ts` (new),
`src/app/components/TerminalPanel.tsx`.

**Edge cases:** clamp at both bounds (no zoom past 10/20; menu items may disable
or no-op at the limit); corrupt/out-of-range localStorage value falls back to 13;
localStorage unavailable (private mode) keeps in-memory state (pattern already
handles this); multiple terminals/slots all reflect the change (single source of
truth); reset returns to 13 regardless of slot count.

### 4.2 Slice 2 — Launcher affordance + collab status split (#2)

**Current behavior.** Launchers (`.shell-chip-bar__action[data-provider]`,
`shell.css:1515–1565`) are outline chips: transparent background, thin
`--panel-border` border, provider-colored bold text, hover adds a faint provider
tint. The collab pill (`.agent-launcher-bar__status`, `shell.css:5608–5628`) is
`muted` (borderless) at rest but its **`amber`/`accent` tones carry a bordered,
tinted box** — i.e. exactly a launcher's clothing. That tonal box is the confusion
source: when collab wants attention it looks clickable.

**Change — CSS only, in `shell.css`; markup in `AgentLauncherBar.tsx` limited to
the leading glyph.**

- **Launchers read as buttons, not filters.** Give `.shell-chip-bar__action` a
  subtle resting fill (a faint provider tint, not just an outline) so it reads as
  a pressable control; keep the stronger hover. Swap the leading glyph from
  `caret-right` to a **`+`** ("mount into slot") — the affordance the mockup
  validated. Keep the existing `data-provider` accent colors.
- **Collab is unmistakably status.** Remove the bordered/tinted **box** from the
  `amber`/`accent` tones so the status never wears a button's costume in any tone.
  Present it as a leading status glyph/dot + text, tone conveyed by the
  glyph/text color only. It stays a non-interactive `<span>` (already is).

**Files touched (2 + tests):** `src/app/shell.css`,
`src/features/terminals/components/AgentLauncherBar.tsx` (glyph swap only).

**Verification note — the defect lives in CSS, not markup.** The collab element is
already a plain `.agent-launcher-bar__status` `<span>` with no button-box class;
the button-like border/background comes from the `[data-tone="amber"]` /
`[data-tone="accent"]` rules (`shell.css:5617–5628`). So a unit assertion that the
span "carries no button-box class" is **false-green** — it passes before the fix.
The visual regression must be caught at the rendered-style layer: an e2e
(Playwright) check that renders the launcher bar with collab in **each** tone
(`muted/amber/accent`) and asserts the status element's computed `border` and
`background` are non-box (transparent/none) and visibly distinct from a
`.shell-chip-bar__action` launcher button. Unit tests remain useful only for the
structural facts (leading `+` glyph present on launchers, collab stays a
non-interactive `<span>`, provider `data-provider` values render).

**Edge cases:** all five providers (`claude/codex/ezio/cursor/antigravity`) keep
distinct accents and remain legible against the new resting fill in all four
themes (dark/light/warm/tui); the `queued` badge still reads on the new button
fill; all three collab tones (`muted/amber/accent`) are visually distinct from a
launcher; the `Agents` label and layout wrapping are unaffected; hover/focus-visible
states preserved for keyboard users.

### 4.3 Slice 3 — `actionRequired` non-color signal + tooltip upgrade (#3)

**Current behavior.** The sidebar encodes attention by color + animation (the
motion hierarchy the critique rightly praised — keep it). `actionRequired` has no
non-color signal. Truncated rows already show native `title=` tooltips
(`SessionSidebar.tsx:397` etc.), which are slow and inconsistent, and a Radix
`Tooltip` primitive already exists (`src/components/ui/tooltip.tsx`). The sidebar
already threads an `attentionTier: "actionRequired" | "ready" | null` prop
(`SessionSidebar.tsx:45`).

**Change — in `SessionSidebar.tsx` (+ `shell.css` for the tag).**

- **Non-color signal for `actionRequired`.** When the row's rolled-up state is
  `actionRequired`, render an **always-visible distinct shape** — a dedicated
  Nerd Font glyph clearly different from the idle/activity glyphs — plus a compact
  **"needs you"** text label, with an `aria-label`. This is the requirement: the
  state must be distinguishable **without** relying on hue or motion (colorblind
  + screen-reader safe). Color and animation stay as reinforcement. Keep it
  compact to preserve the intended density.
- **Tooltip upgrade + coverage audit.** Replace native `title=` on truncated
  sidebar rows with the existing Radix `Tooltip` (faster, consistent, styled),
  and audit that **every** truncated row (task line, stale/status labels, session
  paths) has full-text on hover — the critique named `"stale: qu…"` as a bare
  case. Wrap with a single `TooltipProvider` and a sensible open delay.

**Files touched (2 + tests):** `src/features/workspace/components/SessionSidebar.tsx`,
`src/app/shell.css`.

**Edge cases:** the non-color signal appears for every `actionRequired` row
regardless of theme and is never conveyed by color alone; density stays acceptable
with the added glyph/label (measure against a full sidebar); tooltip does not
trigger when text is *not* truncated (avoid noise) — or is acceptable to always
show full text, decide during impl and keep consistent; long task text still
clips with ellipsis in the row; keyboard focus surfaces the tooltip (Radix
handles focus); rename-in-progress rows (`isRenamingThisRow`) suppress the tooltip
as they already suppress the task line.

## 5. Testing strategy

Two layers, per the Verification contract (`AGENTS.md:126–129`): unit tests
(vitest, TDD — write the failing test first) for pure logic and structure, **plus**
e2e coverage (Playwright, `tests/e2e/`) for every new user-visible behavior. This
spec is entirely user-visible UX, so e2e is **mandatory** and must **extend** the
existing suite (`AGENTS.md:129` — accumulate coverage, never replace older flows).

### 5.1 Unit (vitest)

- **Slice 1:** `use-terminal-font-size` — default resolves to 13; clamp at 10/20;
  increase/decrease/reset transitions; corrupt/out-of-range localStorage → 13;
  persistence round-trip; bridge-event → size-change wiring at the hook boundary.
- **Slice 2:** structural facts only — a computed-style visual defect cannot be
  caught in jsdom (see the Slice 2 verification note), so unit tests assert that
  launcher buttons render the leading `+` glyph and their `data-provider` accents,
  and that the collab element stays a non-interactive `<span>`. Do **not** rely on
  a "collab has no button-box class" assertion — the class was never present, so it
  is false-green and passes before the CSS fix.
- **Slice 3:** given a worktree row with `attentionState: "actionRequired"`, the
  non-color signal element renders with its `aria-label`; `idle`/`activity` rows do
  not render it; truncated rows wrap their text in the Radix tooltip trigger.

### 5.2 E2E (Playwright, `tests/e2e/`, extend the suite)

- **Slice 1:** drive the font-size menu items / accelerators (Increase / Decrease /
  Reset), assert the rendered terminal font size changes, clamps at the bounds, and
  **persists across an app reload**.
- **Slice 2:** render the launcher bar with collab in **each** tone
  (`muted/amber/accent`); assert the collab status element's computed `border` and
  `background` are non-box (transparent/none) and visibly distinct from a
  `.shell-chip-bar__action` launcher button, and that launchers carry the button
  affordance. This is the check that actually catches the CSS defect (the unit
  layer cannot).
- **Slice 3:** with a session in `actionRequired`, assert the non-color signal
  (shape + `needs you` label) is visible **without** relying on color, and that a
  truncated sidebar row exposes its full text via the Radix tooltip on
  hover/focus. Extend `tests/e2e/session-attention.spec.ts` where it fits rather
  than adding a parallel flow.

**Gate before "done" (all must pass):** `pnpm typecheck && pnpm lint && pnpm format
&& pnpm test:all` — where `test:all` (`package.json:30`) runs unit (`pnpm test`)
**and** e2e (`pnpm test:e2e` = `electron-vite build && playwright test`,
`package.json:28`). Per `AGENTS.md:128`, a slice's user-visible behavior is not
done until the e2e suite covers it.

## 6. Order of work & independence

The three slices are independent and can land in any order / separate PRs:

1. Slice 1 (font size) — highest user impact, self-contained.
2. Slice 2 (launcher/collab) — CSS-dominant, low risk.
3. Slice 3 (attention signal + tooltips) — the accessibility win.

## 7. Open questions

None blocking. Two impl-time micro-decisions, defaulted above: (a) menu placement
of the font-size items (View vs Terminal submenu) — pick whichever the existing
menu structure makes cleanest; (b) whether the Radix tooltip shows only when text
is actually truncated vs always — pick one and apply consistently.
