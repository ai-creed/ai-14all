# ai-14all — insights dashboard, slice 1 (overlay + detachable window)

**Status:** Design approved (2026-07-28) via the interactive prototype
`docs/design-specs/2026-07-28-insights-dashboard-prototype.html` (v3),
iterated with the user across three rounds. Not yet implemented.

## 1. What this is

The first user-facing surface for the insights capture module: a
productivity dashboard that answers, at a glance, *"what data matters when
I open this — did I work, when do I work, what did my agents get done, and
what did it cost?"* It reads the local insights store (app-focus spans,
archived whisper runs) and the existing usage ledger. Local-only; no
network.

Slice 1 ships the complete surface: an **expanded overlay** in the main
window plus a **detachable dedicated window** for multi-monitor use
("working cockpit + overview dashboard"), with an **overview** view (four
zones) and a **by-workspace** view (runs + tokens per workspace).

## 2. Decisions locked

1. **Surface.** Expanded overlay replacing the main column (the
   review-expanded portal pattern), plus a detachable window — both in
   slice 1 (user decision; detach is not deferred).
2. **Architecture A — shared component, two hosts, independent data.**
   One `InsightsDashboard` React component rendered (a) inside the main
   window's overlay and (b) as the root of a second renderer entry
   (`dashboard.html`) loaded by a dedicated `BrowserWindow` with the same
   preload. Each host fetches its own data through the same
   `window.ai14all` contracts; there is **no cross-window state sync** —
   the only coordination is open/close signals over IPC.
3. **Detach semantics: move, singleton.** Detaching closes the overlay and
   opens (or focuses) the single dashboard window; **⇱ reattach** in the
   window's header closes the window and reopens the overlay. Closing the
   window via OS chrome just closes it (no auto-reopen). Detached state is
   not persisted across app restarts in slice 1 (deferred).
4. **The detached window is created by the main process over IPC** —
   never via `window.open`. The navigation guard
   (`electron/main/windows.ts:37`) stays byte-identical.
5. **Entry points:** a chip-bar action and a command-palette entry. No
   keyboard shortcut, no usage-strip takeover in slice 1.
6. **Ranges:** `today / 7d / 30d / all`. `today`, `7d` render 7 daily
   columns (week rule: never fewer than seven, current day marked); `30d`
   renders 30 daily columns; `all` renders **weekly buckets** since data
   began.
7. **Views:** `overview` (four zones + stat tiles) and `workspaces`
   (grouped table). The range picker applies to both.
8. **Charts: adopt Recharts via the shadcn chart pattern** — new renderer
   dependency `recharts`, plus the vendored shadcn chart primitives
   (`ChartContainer`/`ChartConfig`/`ChartTooltip`) in
   `src/components/ui/chart.tsx`. `ChartConfig` colors reference existing
   app tokens directly (`var(--primary)`, `var(--provider-claude)`, …) —
   **no parallel `--chart-*` palette is introduced.** The existing
   hand-rolled `UsageChart`/`Gauge` are untouched.
9. **Per-source coverage honesty.** Each zone shows the full depth its
   source has and no more: tokens (ledger) reach back months; app time and
   runs start at first capture. Pre-capture buckets render as quiet
   baseline stubs; the footer states coverage explicitly; long windows use
   the `◐ mixed coverage` framing. Detailed and aggregate sources are
   never summed into one number.
10. **Telemetry framing (standing rule):** usage analytics, never
    provider-limit monitoring. Costs are always labeled `≈ … est`. No
    limit gauges anywhere on this surface.
11. **Design-language choices** (verified against live tokens):
    - Today/now emphasis uses `--primary`, **not** `--accent` — in the tui
      theme `--accent` resolves to the bg2 ladder step and would vanish.
    - The focused series renders on `--muted-foreground` (not `--muted`,
      which is near-invisible on the light theme's white card); engaged
      renders on `--primary`.
    - Run outcomes use status tokens: done `--success`, halted
      `--warning`, failed `--danger`. Provider series use
      `--provider-claude/-codex/-ezio`.
    - Completeness is glyph + caption (`●` complete, `◐` partial), never
      color alone.
    - TUI traits throughout: square corners, solid full-opacity
      separators, no shadows (the only inset box-shadow is the established
      baseline-tick technique from `usage.css`), monospace chrome,
      `font-variant-numeric: tabular-nums` on all figures, glyphs not
      emoji.

## 3. Current state → target

| Aspect | Current | Target (slice 1) |
|---|---|---|
| Insights UI | none (settings toggle + one-time notice only) | expanded overlay + detachable window |
| Renderer entries | `index.html` only | + `dashboard.html` (electron-vite multi-entry, same pattern as main-process workers) |
| Charts | hand-rolled divs (`UsageChart`, `Gauge`) | Recharts via shadcn chart primitives, app-token themed (existing charts untouched) |
| Insights reads from renderer | `queryAppTime`, `query` (whisper runs) — unconsumed by any view | both consumed + one new bucketed series query |
| Workspace attribution | usage popover rollups only | dashboard `workspaces` view: runs + tokens + est. cost per workspace |
| App-time per workspace | not captured | **out of scope** — follow-up collector (§9) |

## 4. Data contracts

**Existing, consumed as-is:**
- `insights.queryAppTime(range)` → `{focusedMs, engagedMs, completeness}` —
  headline tiles and range completeness.
- `insights.query(range)` → `{runs: InsightsWhisperRun[], completeness}` —
  run tiles, runs-by-day chart, and (grouped client-side by
  `repoId`/`workspaceRel`) the workspaces view.
- `usage.onSnapshot` — token burn zone and per-workspace token/cost
  columns, reusing the popover's existing per-cwd → workspace/worktree
  rollup logic and the pricing estimator (`services/usage/cost/`).

**New in slice 1 — one worker query:**

```ts
// worker-protocol.ts
queryAppTimeSeries(range: { fromMs: number; toMs: number },
                   bucket: "hour" | "day" | "week"): {
  buckets: Array<{ startMs: number; focusedMs: number; engagedMs: number }>;
  completeness: Completeness;   // whole-range, from app.uptime coverage
  firstCaptureAt: number | null; // meta read; drives the capture-start rule
}
```

- Feeds the area chart (day/week buckets), the rhythm widget (hour
  buckets, folded into hour-of-day **in the renderer using the local
  timezone**), and the `all` range (week buckets since `firstCaptureAt`).
- Implementation is a bucketed variant of `getAppTime`'s clipped-sum over
  the same indexed span query — O(range rows), runs in the worker, no
  main-thread work. UTC bucket boundaries for day/week (consistent with
  the store's UTC-day convention); hour buckets are hour-aligned UTC and
  folded locally.
- The worker's tick/status path is untouched — the dashboard is
  pull-only. E1 guarantees (day-gated prune, O(1) status) are preserved.

**Renderer aggregation rules:**
- Headline tiles aggregate over the selected range; `all` = since
  `firstCaptureAt` for app time/runs, full ledger depth for tokens.
- Workspaces view: runs grouped by run attribution; tokens by the
  ledger's workspace rollup; rows sorted by tokens desc; totals row sums
  the displayed rows. No app-time column (§9).

## 5. Components & files

**Renderer (shared component + two hosts):**
- `src/features/insights/InsightsDashboard.tsx` — the shared surface:
  header (title, view seg, range seg, host actions), stat tiles, both
  views, footer. Prop `host: "overlay" | "window"` controls which header
  actions render (⧉ detach vs ⇱ reattach).
- `src/features/insights/widgets/` — `StatTiles.tsx`, `AppTimeArea.tsx`,
  `RhythmChart.tsx`, `RunsChart.tsx`, `TokenBurnChart.tsx`,
  `WorkspaceTable.tsx`.
- `src/features/insights/useInsightsDashboardData.ts` — range/view state
  + the three fetches; refresh on range change and on a modest poll while
  visible (30 s), plus manual retry from the error state.
- `src/components/ui/chart.tsx` — vendored shadcn chart primitives.
- `src/dashboard.tsx` + `dashboard.html` — the detached-window entry:
  mounts `InsightsDashboard host="window"` with the theme applied the
  same way `index.html` does.
- `src/styles/modules/insights.css` — all `idb-*`-class styles from the
  prototype, registered in `src/styles/index.css` under
  `@layer app.components` (per-theme structural overrides in
  `app.themes`, colors stay in tokens).
- Chip-bar action + command-palette entry wired where the plugins panel
  registers today.

**Electron main:**
- `electron/main/services/insights-window.ts` — create/focus the
  singleton dashboard `BrowserWindow` (same preload, same webPreferences,
  navigation guard installed), load `dashboard.html` (dev URL vs packaged
  file), notify the main window on open/close so the overlay can restore
  on reattach.
- IPC: `insights:openWindow`, `insights:reattach` (+ preload
  `insights.detach()` / `insights.reattach()` and an
  `insights.onWindowClosed` listener for chip-bar/overlay state), typed in
  `shared/contracts/commands.ts`.

**Worker:**
- `services/insights/store/app-time-series.ts` (new view) +
  `worker-protocol.ts` message + host handler + preload
  `insights.queryAppTimeSeries`.

## 6. States & copy (from the approved prototype)

- **Loading:** tiles show `· · ·`; body shows `querying local store…`.
  No skeleton animation beyond that (motion restrained).
- **Empty** (no capture ever): `◌ / no insights data yet / capture starts
  when insights is enabled in settings…` + `open settings` action.
- **Error:** `! / insights store unavailable / …recover on retry` +
  `retry` action (danger tokens; layout preserved).
- **Partial coverage:** footer variants exactly as prototyped
  (`◐ partial window — app time & runs since <date> …`,
  `◐ mixed coverage — … tokens since <date> (ledger)`,
  `● capture healthy — …`).
- Footer right side: `updated HH:MM:SS · local store · no network`.

## 7. Accessibility & quality bar

- WCAG AA per theme (`theme-wcag-aa-spec.md`); the light theme is the
  known casualty — verify stat tiles, chart strokes, and status text on
  the white card.
- Recharts `accessibilityLayer` on; every interactive control keyboard
  reachable; focus-visible ring on `--ring`.
- `prefers-reduced-motion` respected (transitions freeze; no chart enter
  animations under reduce).
- Realistic data in any screenshots/tests; never lorem ipsum.
- Conformance checklist (ux-design skill) confirmed in **all four
  themes** before the work is called done.

## 8. Acceptance criteria

- **AC1 — entry & overlay.** Chip-bar action and command-palette entry
  both open the overlay, which replaces the main column; ✕ restores the
  prior layout.
- **AC2 — detach/reattach.** ⧉ creates/focuses the singleton dashboard
  window (dashboard.html, same preload) and closes the overlay; ⇱ closes
  the window and reopens the overlay; OS-close just closes. `window.open`
  behavior everywhere else is unchanged.
- **AC3 — ranges & buckets.** today/7d → 7 daily columns with today
  marked; 30d → 30 daily; all → weekly buckets since `firstCaptureAt`;
  never fewer than 7 columns in any mode.
- **AC4 — coverage honesty.** Pre-capture buckets stub (app time, runs)
  while token buckets render from ledger depth; footer copy matches §6;
  aggregate and detailed sources are never summed.
- **AC5 — workspaces view.** Table shows per-workspace runs
  (done/halted/failed in status colors), token share bar (provider mix),
  tokens, `≈ $ est` cost; sorted by tokens; totals row consistent with
  the overview tiles for the same range.
- **AC6 — states.** Loading/empty/error render the designed states; retry
  recovers after a transient query failure.
- **AC7 — four themes.** §7 checklist passes in dark, light, warm, tui;
  tui renders 2px borders, flat background, zero animation durations.
- **AC8 — no capture-path regressions.** Worker tick/status byte-for-byte
  unchanged; the new series query is read-only, indexed, and answered off
  the main thread.

**Verification:** `pnpm typecheck && pnpm lint && pnpm test` green;
`pnpm test:e2e insights` green; new e2e covering AC1–AC2 happy paths.

## 9. Follow-up ledger (explicitly out of slice 1)

1. **Workspace-active collector** — spans of "which workspace is selected
   while focused"; unlocks focused/engaged per workspace ("effort on
   project X"), the freelance/report use case. Forward-only; no backfill
   exists.
2. **Daily rollup aggregates** that survive the 365-day prune, so `all`
   stays truthful past a year (the deferred E1 retention follow-up).
3. **Export report** — per-project time/effort summary (client-facing).
4. **Detached-state persistence** across restarts.
5. **Model-mix breakdown** (ledger already keys by model; no UI yet).

## 10. Out of scope

- Any change to capture, consent, retention, or the worker tick/status
  path.
- Provider-limit UI of any kind (standing telemetry rule).
- Restyling `UsageStrip`/`UsagePopover`/`UsageChart`.
- Keyboard-shortcut entry point; usage-strip click-through.
- Backfill importers (Tier-2 raw-log history) — the dashboard reads what
  the stores already hold.
