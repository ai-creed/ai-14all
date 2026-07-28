# ai-14all — insights dashboard, slice 1 (overlay + detachable window)

**Status:** Design approved (2026-07-28) via the interactive prototype
`docs/design-specs/2026-07-28-insights-dashboard-prototype.html`,
iterated with the user across three rounds. Revised same day after SDD
spec review (round 1): pull-based usage range query, one shared
local-calendar bucket domain, read-result error envelope, schema v3 span
index, tui zero-motion override, prototype v4 consistency fixes. Not yet
implemented.

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
   **The dashboard is pull-only in both hosts.** It never subscribes to
   the `usage:snapshot` push (which is sent and replayed to the main
   window only — `electron/main/index.ts:239-264` — and stays that way
   for the usage strip/popover); tokens are read through the new
   `usage.queryRange` invoke (§4), which answers identically from either
   window. This is what makes decision 2 true for the detached host
   without any new broadcast wiring.
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
   renders 30 daily columns; `all` renders **weekly buckets since the
   earliest data across sources** — the domain starts at
   `min(earliestDayMs, firstCaptureAt)` (whichever sources exist; §4
   "bucket domain"), so the ledger's months of token history and the
   capture-bound app/runs series share one bucket domain, with the
   capture-start rule (§2.9) marking where the detailed sources begin.
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
    - Completeness is glyph + caption (`●`/`◐`), never color alone.
    - TUI traits throughout: square corners, solid full-opacity
      separators, no shadows (the only inset box-shadow is the established
      baseline-tick technique from `usage.css`), monospace chrome,
      `font-variant-numeric: tabular-nums` on all figures, glyphs not
      emoji.
    - **tui renders with zero motion on this surface**: an `.idb`-scoped
      override zeroes `transition-duration`/`animation-duration` under
      `[data-theme="tui"]`, extending the tui teardown precedent
      (`src/styles/base.css` zeroes them for `[data-state]` elements).
12. **One shared bucket domain, local-calendar aligned.** The renderer
    computes every chart's bucket edges once per (range, view) with a
    single DST-safe local-calendar generator (the `ledger.ts`
    `setHours(0,0,0,0)`/`setDate()` walking pattern) and hands the app-time
    worker **explicit `bucketEdgesMs`** instead of a bucket enum. The
    usage ledger is already local-day keyed (`startOfLocalDay`), so token
    and app-time columns align by construction and "today" marking is the
    user's local today — a UTC day grid would shift a UTC+7 user's morning
    into yesterday's column. Weeks are renderer-side folds of day buckets
    (local weeks are unions of local days, and clipped sums are additive
    across a partition), so the worker only ever buckets by the edges it
    is given.
13. **Read-result envelope: errors are honest and distinguishable from
    absence.** All dashboard data reads resolve
    `{ ok: true, data } | { ok: false, reason }`. Capture-off (no insights
    worker) is `ok: true` with empty data → the **empty** state; a wedged
    or failing store is `ok: false` → the **error** state with retry;
    usage telemetry off is its own quiet per-zone caption, never a fake
    zero. §4 defines the exact reasons and transport.

## 3. Current state → target

| Aspect | Current | Target (slice 1) |
|---|---|---|
| Insights UI | none (settings toggle + one-time notice only) | expanded overlay + detachable window |
| Renderer entries | `index.html` only | + `dashboard.html` (electron-vite multi-entry, same pattern as main-process workers) |
| Charts | hand-rolled divs (`UsageChart`, `Gauge`) | Recharts via shadcn chart primitives, app-token themed (existing charts untouched) |
| Insights reads from renderer | `queryAppTime`, `query` — plain results, empty-on-failure | envelope results (§2.13) + one new bucketed series query |
| Usage reads from renderer | `usage.onSnapshot` push, main window only | + `usage.queryRange` pull (exact-range days/rows/cost), any window |
| Workspace attribution | usage popover rollups only (fixed scopes) | dashboard `workspaces` view: runs + tokens + est. cost per workspace over the exact selected range |
| App-time per workspace | not captured | **out of scope** — follow-up collector (§9) |

## 4. Data contracts

### 4.1 Read-result envelope (insights reads)

```ts
// shared/contracts/commands.ts
export type InsightsReadResult<T> =
	| { ok: true; data: T }
	| { ok: false; reason: "busy" | "timeout" | "query-failed" | "bad-request" };
```

The three renderer-facing insights reads — `insights.query`,
`insights.queryAppTime`, `insights.queryAppTimeSeries` — all return this
envelope. Host mapping (in `insights-host.ts`, replacing today's
silent-empty collapse at its `query`/`queryAppTime` fallbacks):

- **No worker (capture off) → `{ ok: true, data: <empty> }`.** Absence of
  capture is a legitimate answer and drives the *empty* state.
- **`wiping` → `{ ok: false, reason: "busy" }`** (transient; retry
  recovers after the wipe).
- **Timeout (existing `QUERY_TIMEOUT_MS = 2000` correlated-request
  pattern) → `{ ok: false, reason: "timeout" }`** instead of a fabricated
  empty result.
- **Worker-side failure → `{ ok: false, reason: "query-failed" }`.** New
  protocol message: the worker wraps each query in try/catch and replies
  `{ kind: "queryError", requestId, message }` (today a thrown query is
  only reported as an uncorrelated `{ kind: "error" }`, which the host's
  `onMessage` ignores — no pending promise ever learns about it).
- **Invalid series input (edge validation below) →
  `{ ok: false, reason: "bad-request" }`**, rejected in the host without
  posting to the worker.

The existing insights e2e assertions consume the old bare shapes; they are
updated to unwrap `.data` (a deliberate, allowed edit — see §8
verification).

### 4.2 Existing insights reads (kept, enveloped)

- `insights.query(range)` → `InsightsReadResult<{ runs, completeness }>` —
  run tiles, runs-by-day chart, and (grouped client-side by
  `repoId`/`workspaceRel`) the workspaces view.
- `insights.queryAppTime(range)` → enveloped; kept for its existing e2e
  consumers. The dashboard itself derives its focused/engaged tiles from
  the series buckets (clipped sums over a partition add up to exactly the
  whole-range clipped sum, so tile and chart can never disagree).

### 4.3 New worker query — bucketed app-time series

```ts
// worker-protocol.ts
type InsightsQuery =
	| { name: "whisperRuns"; range: { fromMs: number; toMs: number } }
	| { name: "appTime"; range: { fromMs: number; toMs: number } }
	| { name: "appTimeSeries"; bucketEdgesMs: number[] };   // NEW

interface AppTimeSeriesResult {
	// buckets[i] covers [bucketEdgesMs[i], bucketEdgesMs[i+1])
	buckets: Array<{ startMs: number; focusedMs: number; engagedMs: number }>;
	completeness: Completeness;    // whole-domain, from the app.uptime union
	firstCaptureAt: number | null; // meta read; drives the capture-start rule
}
// InsightsWorkerToMain += { kind: "seriesResult"; requestId; result: AppTimeSeriesResult }
//                       + { kind: "queryError"; requestId; message } (§4.1)
```

- **Explicit edges, not an enum** (decision 12). Validation in the host:
  finite, strictly ascending, between 2 and 9,001 entries (≤ 9,000
  buckets = a year of hourly rhythm buckets plus slack); otherwise
  `bad-request`.
- Implementation (`services/insights/store/app-time-series.ts`): one pass
  per kind over the same overlap predicate as `getAppTime`
  (`kind = ? AND source = ? AND occurred_end > ? AND occurred_start < ?`
  over `[edges[0], edges[last])`), clipping each span into the buckets it
  overlaps (binary-search the edge array). A span crossing an edge
  contributes to each bucket exactly its overlap, so bucket sums equal
  the whole-range clipped sum by construction. Completeness comes from
  the `app.uptime` interval union over the whole domain, exactly as
  `getAppTime` does. O(range rows), runs in the worker, no main-thread
  work.
- Feeds the area chart (day buckets; week folds in the renderer), the
  rhythm widget (local hour buckets, folded by local hour-of-day label in
  the renderer), and the stat tiles (sum of in-range buckets).
- The worker's tick/status path is untouched — the dashboard is
  pull-only. E1 guarantees (day-gated prune, O(1) status) are preserved.

### 4.4 Indexed read path — schema v3 (AC8)

The overlap predicate is **not** served by any current index: v1/v2
indexes lead with `kind`/`subject_id`/`source`/`event_ts`, and
`EXPLAIN QUERY PLAN` for `getAppTime`'s query reports
`USING INDEX idx_obs_source_ts (source=?)` — an equality-only probe that
walks every app-focus row (~3,800/day) on every read. Schema v3 fixes
this for both the existing `getAppTime` and the new series view:

```ts
// services/insights/store/schema.ts — same stepped-migration pattern as v2
export const TARGET_SCHEMA_VERSION = 3;
const DDL_V3 = `
CREATE INDEX idx_obs_span ON observations (source, kind, occurred_end);
`;
```

- The plan becomes a range seek:
  `SEARCH observations USING INDEX idx_obs_span (source=? AND kind=? AND occurred_end>?)`.
- **Correctness is untouched**: the SQL predicate does not change, so
  boundary-spanning rows are included exactly as before, and rows with
  `NULL` `occurred_end` were already excluded by `occurred_end > ?`
  (NULL comparisons are false) — the index only changes access path.
- Guard: a schema test asserts (a) fresh migrate lands at
  `user_version = 3` with all v1+v2 objects intact, (b) an in-place
  v2 → v3 upgrade preserves rows and is idempotent, and (c)
  `EXPLAIN QUERY PLAN` for the span query reports `idx_obs_span` and
  never a full-table `SCAN` — the same style as the E1 retention guard in
  `tests/unit/insights/store/schema.test.ts`.

### 4.5 First-capture read (domain anchor)

The `all` domain needs `firstCaptureAt` **before** the series fetch. The
host already receives it in every worker status message
(`status.firstCaptureAt`) but currently keeps only a boolean
(`firstCaptureSeen`); it now caches the value and answers a new O(1)
invoke without any worker round-trip:

- `insights.firstCaptureAt(): Promise<number | null>` (IPC
  `insights:firstCaptureAt`). `null` until the first status after boot or
  when capture has never run — the renderer then falls back to the 7-day
  floor (§4.7).

### 4.6 New usage read — exact-range rollup

`usage.onSnapshot`'s fixed scopes cannot feed this surface: it has no
today scope, "month" is a rolling 31 days, `seriesDaily` is provider-only
and capped at 35 days, and there is no workspace rollup for an arbitrary
range. The ledger itself has everything needed — full-depth local-day
buckets keyed `(cwd, provider, model)` — so the usage worker gains one
correlated pull query:

```ts
// shared/models/usage.ts
export interface UsageRangeQuery { fromMs: number; toMs: number }
export type UsageRangeResult =
	| {
			ok: true;
			days: DailyPoint[];        // one point per local day, dayStart ∈ [fromMs, toMs)
			byWorkspace: UsageRow[];   // exact-range rollup; same matching as ScopeData.rows
			byProvider: ScopeRollupRow[];
			cost: CostSnapshot;        // priced for exactly this range
			earliestDayMs: number | null; // earliest ledger day with data (drives `all`)
	  }
	| { ok: false; reason: "disabled" | "timeout" };

// services/usage/worker-protocol.ts
// MainToWorker += { kind: "queryRange"; requestId: string; query: UsageRangeQuery }
// WorkerToMain += { kind: "rangeResult"; requestId: string; result: <ok-branch payload> }
```

- Preload: `usage.queryRange(query)` (IPC `usage:queryRange`, an
  `ipcMain.handle` beside the existing `usage:*` handlers in
  `electron/main/ipc.ts`) — invokable from **any** renderer window, which
  is what closes the two-host gap (§2.2).
- `UsageHost` implements the same correlated request map + timeout
  pattern as `insights-host.ts` (2 s). Worker gone/telemetry disabled →
  `{ ok: false, reason: "disabled" }`; no reply → `"timeout"`.
- Worker implementation (`services/usage/range.ts`): merge
  `ledger.days` entries whose local `dayStart ∈ [fromMs, toMs)` into one
  bucket map and reuse the exported `buildScopeData` for
  `byWorkspace`/`byProvider`/`cost` — every number derives from the same
  map, so rows, provider roll-up, and totals agree by construction (the
  popover's existing headline-consistency guarantee). `days` via the
  bounded `dailySeries`-style calendar walk; `earliestDayMs` = min ledger
  day key with data.
- Callers pass local-midnight-aligned bounds from the shared edge
  generator (decision 12); the ledger is local-day grained, so this is
  exact, not approximate.
- The `usage:snapshot` push, `UsageStrip`, and `UsagePopover` are
  untouched.

### 4.7 Renderer aggregation rules

- **One edge generator** (`src/features/insights/bucketEdges.ts`) drives
  all zones: local-day edges for today/7d/30d, local-hour edges for the
  rhythm widget, and week folds of day buckets for `all`.
- **Domains per range:** `today`/`7d` → the 7 local days ending today
  (charts show the window; tiles filter to the selected range — for
  `today`, the last day bucket). `30d` → 30 local days. `all` → local
  Monday-start weeks from `weekStart(min(earliestDayMs, firstCaptureAt))`
  (ignore whichever is null; both null → fall back to the 7-day window)
  through the current week. Never fewer than 7 columns in any mode.
- **Tiles:** focused/engaged = Σ series buckets in the selected range;
  runs = `insights.query` results filtered to the range; tokens/cost =
  Σ `days` in the range from `usage.queryRange`.
- **Workspaces view:** `byWorkspace` rows (tokens, provider mix, `≈ $
  est` cost; untracked row filtered per the existing `includeUntracked`
  config) joined with the client-side run grouping for the same range;
  sorted by tokens desc; the totals row sums the displayed rows and —
  because tiles and table read the same sums — **exactly** equals the
  overview tiles for the same range (AC5). No app-time column (§9).
- **Fetch cadence:** on mount, on range/view change, on a 30 s poll while
  visible, and on manual retry from the error state.

## 5. Components & files

**Renderer (shared component + two hosts):**
- `src/features/insights/InsightsDashboard.tsx` — the shared surface:
  header (title, view seg, range seg, host actions), stat tiles, both
  views, footer. Prop `host: "overlay" | "window"` controls which header
  actions render (⧉ detach vs ⇱ reattach).
- `src/features/insights/widgets/` — `StatTiles.tsx`, `AppTimeArea.tsx`,
  `RhythmChart.tsx`, `RunsChart.tsx`, `TokenBurnChart.tsx`,
  `WorkspaceTable.tsx`.
- `src/features/insights/bucketEdges.ts` — the shared local-calendar edge
  generator + week-fold helpers (decision 12).
- `src/features/insights/useInsightsDashboardData.ts` — range/view state
  + the fetch orchestration of §4.7 (firstCaptureAt + queryRange →
  domain → series/runs), envelope handling (§2.13), poll + retry.
- `src/components/ui/chart.tsx` — vendored shadcn chart primitives.
- `src/dashboard.tsx` + `dashboard.html` — the detached-window entry:
  mounts `InsightsDashboard host="window"` with the theme applied the
  same way `index.html` does.
- `src/styles/modules/insights.css` — all `idb-*`-class styles from the
  prototype, registered in `src/styles/index.css` under
  `@layer app.components` (per-theme structural overrides in
  `app.themes`, colors stay in tokens), including the
  `[data-theme="tui"]` zero-motion override (§2.11).
- Chip-bar action + command-palette entry wired where the plugins panel
  registers today.

**Electron main:**
- `electron/main/services/insights-window.ts` — create/focus the
  singleton dashboard `BrowserWindow` (same preload, same webPreferences,
  navigation guard installed), load `dashboard.html` (dev URL vs packaged
  file), notify the main window on open/close so the overlay can restore
  on reattach.
- `electron/main/services/insights-host.ts` — envelope mapping (§4.1),
  `queryError` handling, `queryAppTimeSeries` correlated request, cached
  `firstCaptureAt` (§4.5).
- `electron/main/services/usage-host.ts` — correlated `queryRange`
  request map + timeout (§4.6).
- IPC: `insights:openWindow`, `insights:reattach`,
  `insights:firstCaptureAt`, `usage:queryRange` (+ preload
  `insights.detach()` / `insights.reattach()` / `insights.firstCaptureAt()`
  / `usage.queryRange()` and an `insights.onWindowClosed` listener for
  chip-bar/overlay state), typed in `shared/contracts/commands.ts`.

**Workers:**
- `services/insights/store/app-time-series.ts` (new view) +
  `worker-protocol.ts` messages (`appTimeSeries` query, `seriesResult`,
  `queryError`) + worker query try/catch.
- `services/insights/store/schema.ts` v3 (`idx_obs_span`) + schema test
  extension (§4.4).
- `services/usage/range.ts` (range merge + `buildScopeData` reuse) +
  `services/usage/worker-protocol.ts` messages + the usage worker entry's
  handler.

## 6. States & copy (from the approved prototype)

- **Loading:** tiles show `· · ·`; body shows `querying local store…`.
  No skeleton animation beyond that (motion restrained).
- **Empty** (capture off / no capture ever — `ok: true` with no data and
  `firstCaptureAt: null`): `◌ / no insights data yet / capture starts
  when insights is enabled in settings…` + `open settings` action.
- **Error** (any insights read `ok: false`, or `usage.queryRange`
  timeout): `! / insights store unavailable / …recover on retry` +
  `retry` action (danger tokens; layout preserved). Retry refetches every
  source; a transient failure (e.g. `busy` during a wipe) recovers.
- **Usage telemetry off** (`usage.queryRange` → `disabled`): the token
  zone and token/cost columns render a quiet caption
  `usage telemetry off — enable in settings`; insights zones are
  unaffected. Never rendered as a zero.
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
  animations under reduce); tui zeroes motion unconditionally (§2.11).
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
  behavior everywhere else is unchanged. The detached window renders live
  token data (pull path, §2.2) with the main window still open.
- **AC3 — ranges & buckets.** All zones in a view share one bucket
  domain from the single edge generator, local-calendar aligned;
  today/7d → 7 daily columns with local today marked; 30d → 30 daily;
  all → weekly buckets since `min(earliestDayMs, firstCaptureAt)`;
  never fewer than 7 columns in any mode.
- **AC4 — coverage honesty.** Token buckets render wherever the ledger
  has days — including pre-capture buckets; app-time and runs buckets
  stub before `firstCaptureAt`; footer copy matches §6; aggregate and
  detailed sources are never summed.
- **AC5 — workspaces view.** Table rows come from
  `usage.queryRange().byWorkspace` for the exact selected range (tokens,
  provider-mix share bar, `≈ $ est`) joined with runs grouped from
  `insights.query` (done/halted/failed in status colors); sorted by
  tokens; the totals row **exactly** equals the overview tiles for the
  same range — both read the same sums; no per-row share rounding
  anywhere.
- **AC6 — states & errors.** Loading/empty/error render the designed
  states; empty (capture off) and error (store failure) are
  distinguishable per the §4.1 envelope; a transient query failure
  surfaces the error state and retry recovers; usage `disabled` renders
  the quiet caption, not an error and not zeros.
- **AC7 — four themes.** §7 checklist passes in dark, light, warm, tui;
  tui renders 2px borders, flat background, and zero
  transition/animation durations on this surface (§2.11 override).
- **AC8 — no capture-path regressions, indexed reads.** Worker
  tick/status byte-for-byte unchanged; schema v3 adds `idx_obs_span` via
  the stepped migration; `EXPLAIN QUERY PLAN` for the span overlap query
  reports `idx_obs_span` and no full-table `SCAN` (regression-tested,
  §4.4); the series query is read-only and answered off the main thread.

**Verification:** `pnpm typecheck && pnpm lint && pnpm test` green;
`pnpm test:e2e insights` green — the existing insights e2e assertions are
updated to unwrap the §4.1 envelope (`.data`), an expected edit of this
slice; new e2e covering AC1–AC2 happy paths.

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
- Any change to the `usage:snapshot` push path, `UsageStrip`,
  `UsagePopover`, or `UsageChart` (the dashboard is pull-only).
- Provider-limit UI of any kind (standing telemetry rule).
- Keyboard-shortcut entry point; usage-strip click-through.
- Backfill importers (Tier-2 raw-log history) — the dashboard reads what
  the stores already hold.
