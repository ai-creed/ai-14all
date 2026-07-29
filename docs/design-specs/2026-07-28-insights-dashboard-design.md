# ai-14all — insights dashboard, slice 1 (overlay + detachable window)

**Status:** Design approved (2026-07-28) via the interactive prototype
`docs/design-specs/2026-07-28-insights-dashboard-prototype.html`,
iterated with the user across three rounds. Revised same day after SDD
spec review — round 1: pull-based usage range query, one shared
local-calendar bucket domain, read-result error envelope, schema v3 span
index, tui zero-motion override, prototype v4 consistency fixes;
round 2: seven-column floor for the `all` range and retention-truthful
coverage anchors (§4.5); round 3: anchors keyed to the sources' actual
visibility predicates (`occurred_start`, not `event_ts`) with
source-specific footer copy; round 4: app-time anchor spans all
series-visible app kinds (live sessions have no `app.uptime` closure
yet) and one untracked-usage inclusion rule for rows, tiles, and
charts; round 5: explicit workspace-level view-model aggregation
(`buildWorkspaceRows`, §4.8) over the raw per-provider usage rows;
round 6: §4.8 seeds every registry workspace and the untracked row
before folding, and null-`repoId` run groups fold into untracked;
round 7: total run-status projection (§4.9) — every raw status maps to
exactly one rendered outcome class, none dropped. Implemented via SDD on
`dashboard-design`. Revised 2026-07-29 after the user's
post-implementation UX review (prototype v5, approved 2026-07-29):
**full-size hosts** — the dashboard fills the overlay and the detached
window instead of floating as a 1080px card, the v4 chart heights become
grow-from minimums (body scrolls under the floors), and the detached
window opens at the app window's size, remembering in-session resizes.

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
   **Full-size hosts (v5, 2026-07-29):** the dashboard shell fills its
   host — the overlay's main-column rect and the detached window's
   viewport — never floating as a fixed-width card. Header, stat tiles,
   and footer stay content-height; the two overview chart rows split all
   leftover vertical space equally on top of their content minimums. The
   v4 fixed chart heights become floors (`min-height`: 150px area/rhythm,
   110px bars); when a host is shorter than the floors, the dashboard
   body scrolls instead of shrinking the charts. Rationale: the
   two-monitor cockpit — app fullscreen on one 27" display, dashboard
   fullscreen on the other — is the primary detach use case, and a
   terminal-language dashboard fills its terminal (btop/k9s precedent).
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
   **Sizing (v5):** the window opens at the main window's current
   width × height (so a fullscreen-app cockpit yields an equally wide
   dashboard on the second monitor), falling back to 1120×720 when the
   main window's bounds are unavailable. A user resize is remembered and
   reused for reopens within the app session; nothing is persisted
   across restarts (consistent with decision 3).
5. **Entry points:** a chip-bar action and a command-palette entry. No
   keyboard shortcut, no usage-strip takeover in slice 1.
6. **Ranges:** `today / 7d / 30d / all`. `today`, `7d` render 7 daily
   columns (week rule: never fewer than seven, current day marked); `30d`
   renders 30 daily columns; `all` renders **weekly buckets since the
   earliest retained data across sources** — the domain starts at the
   data-start anchor `min(earliestDayMs, appRetainedSinceMs,
   runsRetainedSinceMs)` (§4.5/§4.7), padded to a **seven-column floor**
   when history is shorter, so the ledger's months of token history and
   the capture-bound app/runs series share one bucket domain, with the
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
   never summed into one number. **Truth survives retention:** every
   "since <date>" caption derives from what the store still holds (the
   retained anchors, §4.5), never from the immutable first-capture
   marker — a year-old capture whose oldest rows the 365-day prune has
   removed must not claim history it no longer has.
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
      `--warning`, failed `--danger`; in-flight (`active`) runs render
      on `--info`, and the residual `other` class on
      `--muted-foreground` (§4.9). Provider series use
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
14. **Untracked usage is always included on this surface — one
    inclusion rule for rows, tiles, and charts.** `usage.queryRange`
    applies no untracked filtering: tiles, the token-burn chart, and the
    workspace table (its labeled `untracked · outside managed
    workspaces` row, as prototyped) all derive from the same unfiltered
    bucket set, so the table total ≡ the tiles by construction. The
    popover's `includeUntracked` preference stays a popover-only
    renderer filter and is **not consulted** by the dashboard — applying
    it to rows but not tiles is exactly the mismatch AC5 forbids, and
    hiding real spend from a productivity/cost surface would break §2.9
    honesty.

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
}
// The capture line + "since" captions come from the coverage anchors
// (§4.5), which the renderer already holds before this call.
// InsightsWorkerToMain += { kind: "seriesResult"; requestId; result: AppTimeSeriesResult }
//                       + { kind: "queryError"; requestId; message } (§4.1)
```

- **Explicit edges, not an enum** (decision 12). Validation in the host:
  finite, strictly ascending, between 2 and 9,001 entries (≤ 9,000
  buckets = a year of hourly rhythm buckets plus slack); otherwise
  `bad-request`. Renderer series requests are always app-retention-clamped
  before they reach this host (`seriesEdgesFor`, bucketEdges.ts — the same
  doctrine `rhythmEdges` already applies to the rhythm read), since
  app-time data cannot predate `OBSERVATION_RETENTION_DAYS`, however deep
  the `all` domain's own start goes (which tracks the TOKEN ledger's
  unbounded depth, not app-time's) — so this cap is an absurd-input guard
  that a valid dashboard domain can never actually hit, not a real-history
  limit.
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
CREATE INDEX idx_obs_span ON observations (source, kind, occurred_end, occurred_start);
CREATE INDEX idx_obs_kind_occstart ON observations (kind, occurred_start);
`;
```

The fourth column on `idx_obs_span` makes it a covering index for the span-overlap query — without it, SQLite's planner would select `idx_obs_kind_occstart` instead, forcing a near-full scan of rows by kind; the covering form ensures the planner chooses `idx_obs_span` and answers the entire query from the index without table lookups.

`idx_obs_span` serves the span-overlap reads; `idx_obs_kind_occstart`
serves the §4.5 coverage anchors (`MIN(occurred_start)` under a `kind`
equality is a leftmost seek — without it, each anchor read would scan
every row of that kind, ~0.5M `app.uptime` rows at steady state).

- The plan becomes a range seek:
  `SEARCH observations USING INDEX idx_obs_span (source=? AND kind=? AND occurred_end>?)`.
- **Correctness is untouched**: the SQL predicate does not change, so
  boundary-spanning rows are included exactly as before, and rows with
  `NULL` `occurred_end` were already excluded by `occurred_end > ?`
  (NULL comparisons are false) — the index only changes access path.
- Guard: a schema test asserts (a) fresh migrate lands at
  `user_version = 3` with all v1+v2 objects intact, (b) an in-place
  v2 → v3 upgrade preserves rows and is idempotent, and (c)
  `EXPLAIN QUERY PLAN` for the span query reports `idx_obs_span`, for
  the anchor `MIN(occurred_start)` queries reports
  `idx_obs_kind_occstart`, and never a full-table `SCAN` for either —
  the same style as the E1 retention guard in
  `tests/unit/insights/store/schema.test.ts`.

### 4.5 Coverage anchors (domain + truthful "since" dates)

The `all` domain and every "since <date>" caption need anchors **before**
the series fetch — and `firstCaptureAt` alone is not a truthful anchor.
The retention prune (`services/insights/retention.ts`,
`OBSERVATION_RETENTION_DAYS = 365`, `DELETE … WHERE event_ts < cutoff`)
removes the oldest observations while the `first_capture_at` meta key is
immutable, so a store can hold data since first capture, since the
retention floor, or — capture long disabled — nothing at all despite a
years-old marker. The only truthful anchor is the store itself. New
correlated worker query:

```ts
// worker-protocol.ts
// InsightsQuery += { name: "coverageAnchors" }

interface CoverageAnchorsResult {
	firstCaptureAt: number | null;      // meta read — "capture began" copy, empty state
	// min over the three series-visible app kinds:
	//   MIN(occurred_start) per kind ∈ {app.focused, app.engaged, app.uptime}
	appRetainedSinceMs: number | null;
	runsRetainedSinceMs: number | null; // MIN(occurred_start) WHERE kind = 'whisper.workflow'
}
```

- **The app-time anchor covers every series-visible app kind, not just
  `app.uptime`.** The live collector closes `app.focused`/`app.engaged`
  spans on every poll but closes `app.uptime` only on suspend, disable,
  or quit (`focus-core.ts`) — so a machine's very first session has
  visible focused/engaged series data while no uptime row exists yet.
  Anchoring on uptime alone would report `no app time retained` (and
  could satisfy the §6 empty condition) while the chart shows data.
  `appRetainedSinceMs` is therefore the min of the per-kind
  `MIN(occurred_start)` seeks over `app.focused`, `app.engaged`, and
  `app.uptime` (four indexed seeks total for the anchors query).
  `app.uptime` remains the sole completeness authority (§4.3) — this
  change affects anchors only.

- **Anchors key on `occurred_start` — the same column the range
  predicates read — never on `event_ts`.** Retention deletes by
  `event_ts` (delivery/last-update time), but visibility is governed by
  span overlap on `occurred_start`/`occurred_end` (`app-time-view.ts`)
  and by `started_at = occurred_start` (`whisper_runs` view). The two
  can differ: a retained workflow that *started* before the retention
  cutoff but was last updated after it has `started_at < event_ts`; an
  `event_ts` anchor would start the domain after that run's start and
  misstate the retained depth. `MIN(occurred_start)` over retained rows
  is by definition the earliest instant each source can still show
  (`MIN` ignores `NULL` `occurred_start` rows — exactly the rows the
  range predicates also exclude). For `whisper.workflow`, revisions of
  a run share the run's `occurred_start`, so the MIN over all retained
  revision rows equals the earliest visible `started_at`.
- Both MINs are leftmost seeks on the new v3 index
  `idx_obs_kind_occstart (kind, occurred_start)` (§4.4) — O(log N),
  read-only, plan-guarded.
- Preload `insights.coverageAnchors()` (IPC `insights:coverageAnchors`),
  enveloped per §4.1. No host-side caching of status fields is involved.
- Fetch order in the hook: `coverageAnchors` + `usage.queryRange` in
  parallel → compute the bucket domain (§4.7) → `queryAppTimeSeries`
  (edges narrowed through `seriesEdgesFor`, §4.3 — the domain itself stays
  full-depth) + runs queries.
- **Every "since <date>" caption is per source, from that source's
  retained anchor, never `firstCaptureAt`** (§6 clause rules; the
  combined `app time & runs since` copy renders only when both anchors
  fall on the same local day). `firstCaptureAt` appears only in the
  "capture began <date>" retention-clip suffix and in the empty-state
  condition.

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
			days: DailyPoint[];        // SPARSE: one point per local day WITH ledger
			                           // data, dayStart ∈ [fromMs, toMs), ascending;
			                           // absent days are exactly zero
			// RAW grain, deliberately: one entry per (worktree | workspace-group |
			// untracked) × provider — the same shape and matching as
			// ScopeData.rows. The one-row-per-WORKSPACE table with its provider
			// mix is a renderer view-model built from these rows (§4.8); the wire
			// result stays at the grain the ledger naturally produces.
			byWorkspace: UsageRow[];
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
  popover's existing headline-consistency guarantee). `days` is emitted
  SPARSELY in the same pass under the identical predicate — one point
  per ledger day with data, sorted ascending — so `Σ days` equals the
  merge totals by construction at any depth and the cost is O(ledger
  size) for any window (no dense walk, no depth clamp);
  `earliestDayMs` = min ledger day key with data. Chart column counts
  come from the renderer's domain edges, so absent (zero) days still
  render as empty columns.
- Callers pass local-midnight-aligned bounds from the shared edge
  generator (decision 12); the ledger is local-day grained, so this is
  exact, not approximate.
- **No untracked filtering anywhere in the result** (decision 14):
  every bucket in the range contributes to `days`, `byWorkspace`,
  `byProvider`, and `cost`; cwds outside managed workspaces group into
  the labeled untracked row via the existing `workspaceGroupFor`
  matching. The snapshot path's `includeUntracked` config is not an
  input to this query.
- The `usage:snapshot` push, `UsageStrip`, and `UsagePopover` are
  untouched.

### 4.7 Renderer aggregation rules

- **One edge generator** (`src/features/insights/bucketEdges.ts`) drives
  all zones: local-day edges for today/7d/30d, local-hour edges for the
  rhythm widget, and week folds of day buckets for `all`.
- **Domains per range:** `today`/`7d` → the 7 local days ending today
  (charts show the window; tiles filter to the selected range — for
  `today`, the last day bucket). `30d` → 30 local days. `all` → local
  Monday-start weeks from `weekStart(dataStartMs)` through the current
  week, where `dataStartMs = min(earliestDayMs, appRetainedSinceMs,
  runsRetainedSinceMs)` over the non-null anchors (all null → fall back
  to the 7-day window). **Seven-column floor:** when that domain yields
  fewer than 7 weeks (e.g. the first data landed this week), the start
  extends back to `currentWeekStart − 6 weeks`; the padded weeks render
  as quiet baseline stubs for **every** source, and the footer keeps
  quoting the real anchors — the stubs never imply data. Never fewer
  than 7 columns in any mode.
- **Tiles:** focused/engaged = Σ series buckets in the selected range;
  runs = `insights.query` results filtered to the range and projected
  per §4.9 (the tile total counts **every** run; the breakdown line
  follows the §4.9 display rule); tokens/cost = Σ `days` in the range
  from `usage.queryRange`.
- **Workspaces view:** rows are the §4.8 view-model built from **all**
  `byWorkspace` rows (never filtered, decision 14) joined with the
  client-side run grouping for the same range; the totals row is the
  §4.8 totals and therefore **exactly** equals the overview tiles
  (AC5). No app-time column (§9).
- **Fetch cadence:** on mount, on range/view change, on a 30 s poll while
  visible, and on manual retry from the error state.

### 4.8 Workspace view-model (`buildWorkspaceRows`)

The raw `byWorkspace` rows are (worktree | workspace-group | untracked)
× provider grain (§4.6); rendering them directly would show one line
per provider and per worktree. A **pure renderer function**
(`src/features/insights/workspaceRows.ts`) folds them into exactly the
table the prototype shows — one row per workspace plus one untracked
row:

```ts
interface WorkspaceRowVM {
	key: string;    // workspaceId, or "untracked"
	name: string;   // workspace title; "untracked" for the null group
	detail: string; // e.g. "~/Dev/ai-14all · 4 worktrees" / "outside managed workspaces"
	runs: RunOutcomeCounts; // §4.9 — one counter per rendered outcome class
	mix: Array<{ provider: AgentProviderId; tokens: number }>; // desc; drives the share bar
	tokens: number;         // billable, all providers/worktrees in the group
	costUsd: number | null; // Σ non-null group costUsd; null when nothing priced
}

function buildWorkspaceRows(
	usageRows: UsageRow[],             // queryRange().byWorkspace, unfiltered
	runGroups: Map<string | null, RunOutcomeCounts>,
	                                   // insights.query runs grouped by repoId,
	                                   // each run projected per §4.9 — the run
	                                   // contract permits repoId: null
	                                   // (unattributed runs), so null IS a key
	workspaces: WorkspaceIndex,        // renderer registry: workspaceId →
	                                   //   { title, repoId, rootPath, worktreeCount }
): { rows: WorkspaceRowVM[]; totals: Pick<WorkspaceRowVM, "runs" | "tokens" | "costUsd"> }
```

Rules:

- **Seed rows first, fold data second.** The row set is created
  up-front: one zero-valued row per `WorkspaceIndex` entry **plus the
  untracked row, unconditionally** — then usage rows and run groups
  fold into them. A zero-activity registered workspace and an empty
  untracked group therefore still render (AC5's "exactly one row per
  workspace plus one untracked row" holds with no data at all); zero
  rows contribute nothing, so totals are unaffected. An implementation
  that creates rows only from present usage/run data is non-conformant.
- **Grouping is a partition:** group key `workspaceId ?? "untracked"`.
  Every usage row lands in exactly one seeded group, so `Σ rows[].tokens`
  equals the raw total by construction — nothing dropped, nothing
  double-counted, and per-provider/per-worktree duplicates cannot reach
  the UI. A usage row whose `workspaceId` is missing from the index
  still creates its own row (fallback title below) — it is never
  silently merged into untracked.
- **Provider mix:** per-provider token subtotals within the group,
  sorted desc; the share bar renders these proportions, the tooltip
  states the numbers. Invariant: `Σ mix[].tokens === tokens` for every
  row.
- **Cost:** sum of the group's non-null `costUsd`; `null` (rendered `—`)
  only when no row in the group is priced. Always labeled `≈ … est`.
- **Runs join:** run groups key on `repoId: string | null`; a workspace
  matches through the repository identity in the renderer registry.
  The **`null` key** (unattributed runs — the run contract explicitly
  permits `repoId: null`) and any non-null `repoId` matching no
  registered workspace fold into the untracked row's counts — runs are
  never dropped — so `Σ rows[].runs` (across every §4.9 outcome class)
  equals the overview run tiles.
- **Name/detail:** workspace title from the renderer registry
  (fallback: the group's first `worktreeTitle`); untracked uses the
  prototyped `untracked / outside managed workspaces` copy.
- **Sort & totals:** rows sorted by tokens desc, ties by name asc with
  the untracked row last within its tie group (so all-zero states are
  deterministic: registered workspaces alphabetical, untracked last);
  `totals` sums the VM rows and — by the seed + partition arguments
  above — equals the overview tiles for the same range.

### 4.9 Run-status projection (total, shared, never drops a run)

`WhisperRunRow.status` is deliberately `string`, not a union — whisper's
known statuses today are `running | paused | halted | done | canceled`
(`shared/models/ecosystem-plugin.ts`), and future values are allowed.
Rendering only a done/halted/failed triple would silently drop or
mislabel in-flight, canceled, and unknown-status runs, breaking AC5's
exact table-to-overview equality. One shared pure function
(`src/features/insights/runStatus.ts`) is the **single** projection used
by the stat tiles, the runs chart, and `buildWorkspaceRows` — so all
three surfaces agree by construction:

```ts
type RunOutcome = "done" | "halted" | "failed" | "active" | "other";
type RunOutcomeCounts = Record<RunOutcome, number>;

function projectRunStatus(status: string): RunOutcome
```

| raw `status` | outcome | token |
|---|---|---|
| `done` | `done` | `--success` |
| `halted` | `halted` | `--warning` |
| `canceled` | `halted` (deliberately-stopped family; tooltip names it) | `--warning` |
| `failed` | `failed` (defensive: not in whisper's known set today, but the store passes strings through) | `--danger` |
| `running`, `paused` | `active` (in-flight, not an outcome) | `--info` |
| anything else | `other` | `--muted-foreground` |

- **The projection is total**: every run lands in exactly one class, so
  `Σ classes = run count` and every total that AC5 compares includes
  every run.
- **Display rule:** the prototyped `X done · Y halted · Z failed` copy
  stays; `· N active` and `· N other` clauses append **only when
  non-zero** (stat-tile secondary line and table runs cell alike), and
  the runs chart stacks `active`/`other` segments on their tokens only
  when present — so surfaces with purely terminal outcomes render
  exactly as the approved prototype shows.
- Refining `halted` by `haltReason` (e.g. distinguishing errors from
  operator stops) is follow-up work (§9), not slice 1.

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
- `src/features/insights/workspaceRows.ts` — the pure
  `buildWorkspaceRows` view-model fold (§4.8).
- `src/features/insights/runStatus.ts` — the shared total
  `projectRunStatus` projection (§4.9).
- `src/features/insights/useInsightsDashboardData.ts` — range/view state
  + the fetch orchestration of §4.5/§4.7 (coverageAnchors + queryRange →
  domain → series/runs), envelope handling (§2.13), poll + retry.
- `src/components/ui/chart.tsx` — vendored shadcn chart primitives.
- `src/dashboard.tsx` + `dashboard.html` — the detached-window entry:
  mounts `InsightsDashboard host="window"` with the theme applied the
  same way `index.html` does. `dashboard.html` carries the
  `html/body/#root` height chain (100% + flex column) so the shell can
  fill the viewport (decision 1, full-size hosts).
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
  on reattach. Default bounds inherit the main window's size; the last
  in-session size wins on reopen; 1120×720 fallback (decision 4 sizing).
- `electron/main/services/insights-host.ts` — envelope mapping (§4.1),
  `queryError` handling, `queryAppTimeSeries` + `coverageAnchors`
  correlated requests (§4.3/§4.5).
- `electron/main/services/usage-host.ts` — correlated `queryRange`
  request map + timeout (§4.6).
- IPC: `insights:openWindow`, `insights:reattach`,
  `insights:coverageAnchors`, `usage:queryRange` (+ preload
  `insights.detach()` / `insights.reattach()` /
  `insights.coverageAnchors()` / `usage.queryRange()` and an
  `insights.onWindowClosed` listener for chip-bar/overlay state), typed
  in `shared/contracts/commands.ts`.

**Workers:**
- `services/insights/store/app-time-series.ts` (new view) +
  `services/insights/store/coverage-anchors.ts` (four indexed MIN seeks +
  meta read, §4.5) + `worker-protocol.ts` messages (`appTimeSeries` and
  `coverageAnchors` queries, `seriesResult`, `anchorsResult`,
  `queryError`) + worker query try/catch.
- `services/insights/store/schema.ts` v3 (`idx_obs_span`) + schema test
  extension (§4.4).
- `services/usage/range.ts` (range merge + `buildScopeData` reuse) +
  `services/usage/worker-protocol.ts` messages + the usage worker entry's
  handler.

## 6. States & copy (from the approved prototype)

- **Loading:** tiles show `· · ·`; body shows `querying local store…`.
  No skeleton animation beyond that (motion restrained).
- **Empty** (nothing to show anywhere — `ok: true` reads with no data:
  both retained anchors `null` and no ledger days; `firstCaptureAt` may
  still be non-null if a long-ago capture was fully pruned):
  `◌ / no insights data yet / capture starts when insights is enabled in
  settings…` + `open settings` action. Because the app anchor covers
  the focused/engaged kinds (§4.5), a live first session with series
  data but no `app.uptime` closure yet has a non-null anchor — the
  empty state can never mask visible data.
- **Error** (any insights read `ok: false`, or `usage.queryRange`
  timeout): `! / insights store unavailable / …recover on retry` +
  `retry` action (danger tokens; layout preserved). Retry refetches every
  source; a transient failure (e.g. `busy` during a wipe) recovers.
- **Usage telemetry off** (`usage.queryRange` → `disabled`): the token
  zone and token/cost columns render a quiet caption
  `usage telemetry off — enable in settings`; insights zones are
  unaffected. Never rendered as a zero.
- **Coverage footer — composed per source, never a blended date.** The
  left footer is a glyph plus `·`-joined clauses derived from the §4.5
  anchors (`firstCaptureAt` never supplies a "since" date):
  - Glyph: `●` when every source covers the whole selected window
    (`● capture healthy — …` as prototyped); `◐` with
    `partial window` / `mixed coverage` framing otherwise.
  - App-time clause: `app time since <appRetainedSinceMs>`, or
    `no app time retained` when that anchor is null.
  - Runs clause: `runs since <runsRetainedSinceMs>`, or
    `no runs retained` when null. **Merge rule:** only when both
    anchors fall on the same local day do the clauses combine into the
    prototyped `app time & runs since <date>`; if they differ or one is
    null, each source states its own date — the combined copy is never
    shown for differing anchors.
  - Tokens clause: `tokens since <earliestDayMs> (ledger)`.
  - **Retention-clip suffix** (when `firstCaptureAt` precedes the
    earliest non-null retained anchor by more than one day — the prune
    has removed the oldest capture): append
    `(365-day retention; capture began <first-capture date>)` once.
    Example: `◐ mixed coverage — app time since aug 2 · runs since
    jul 14 · tokens since mar 31 (ledger) (365-day retention; capture
    began jul 21)`.
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
  all → weekly buckets from the data-start anchor (§4.7) with the
  seven-column floor — an `all` domain whose first data lands in the
  current week still renders 7 weekly columns (6 truthful stubs + the
  current week); never fewer than 7 columns in any mode.
- **AC4 — coverage honesty.** Token buckets render wherever the ledger
  has days — including pre-capture buckets; app-time and runs buckets
  stub before their **own retained anchors** (§4.5), which key on
  `occurred_start` — the same column the range predicates read — so
  every retained row (including a workflow started before the retention
  cutoff but updated after it) is inside its source's stated depth;
  every "since <date>" caption is per source, from that source's
  retained anchor, never from `firstCaptureAt` and never a blended date
  when the anchors differ (§6 merge rule); when retention has pruned
  the oldest capture, the retention-clip suffix (§6) shows both the
  retained-since date(s) and "capture began" — the dashboard never
  claims data older than what the store still holds, and never hides
  data the store does hold. Footer copy matches §6; aggregate and
  detailed sources are never summed.
- **AC5 — workspaces view.** Table rows are the §4.8
  `buildWorkspaceRows` view-model over `usage.queryRange().byWorkspace`
  for the exact selected range: **exactly one row per workspace plus
  one untracked row** — never a row per provider or per worktree — each
  with its provider-mix share bar (`Σ mix tokens = row tokens`), `≈ $
  est` cost, and runs joined by `repoId` (outcome classes per the §4.9
  total projection in status colors — no raw status is ever dropped or
  mislabeled; null-`repoId` and unmatched-`repoId` run groups fold into
  untracked, never dropped); sorted by tokens; **row presence is
  unconditional** (§4.8 seeding): every registry workspace renders even
  with zero activity, and the untracked row renders even with no
  untracked data; **one inclusion rule** (decision 14): untracked
  buckets are in every sum, so the totals row **exactly** equals the
  overview tiles for the same range; the popover's `includeUntracked`
  preference has no effect on this surface; no per-row share rounding
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
  tick/status byte-for-byte unchanged; schema v3 adds `idx_obs_span`
  and `idx_obs_kind_occstart` via the stepped migration;
  `EXPLAIN QUERY PLAN` for the span overlap query reports
  `idx_obs_span`, for the anchor MIN queries reports
  `idx_obs_kind_occstart`, and no full-table `SCAN` for either
  (regression-tested, §4.4); the series and anchors queries are
  read-only and answered off the main thread.

**Verification:** `pnpm typecheck && pnpm lint && pnpm test` green;
`pnpm test:e2e insights` green — the existing insights e2e assertions are
updated to unwrap the §4.1 envelope (`.data`), an expected edit of this
slice; new e2e covering AC1–AC2 happy paths. Required unit regression
cases: (a) **short-history `all`** — edge generator with a data-start
anchor inside the current week yields exactly 7 weekly columns, the
first 6 rendered as stubs (AC3); (b) **retention-clipped anchors** — a
store whose `first_capture_at` predates its oldest retained row (seed a
v3 store, prune, then read anchors) reports
`appRetainedSinceMs > firstCaptureAt`, and the footer derivation
selects the retention-clip suffix (AC4); (c) **boundary-crossing
rows** — the same fixture seeds a retained `app.uptime` span and a
retained `whisper.workflow` revision whose `occurred_start` precedes
the retention cutoff while `event_ts` is after it: each anchor must
equal that row's `occurred_start` (not its `event_ts`), and a range
query from the anchor must return the row (AC4); (d) **differing
anchors** — with `appRetainedSinceMs` and `runsRetainedSinceMs` on
different local days, the footer derivation emits per-source clauses
and never the merged `app time & runs since` copy (AC4/§6);
(e) **live-session anchor** — a store seeded like a running first
session (`start → focus → idle poll`: closed `app.focused`/`app.engaged`
spans, **no** `app.uptime` row) reports a non-null `appRetainedSinceMs`
equal to the earliest span's `occurred_start`, and the state derivation
does not choose the empty state (AC4/AC6); (f) **workspace view-model aggregation** — a
`buildWorkspaceRows` fixture with two workspaces (one spanning two
worktrees), three providers, untracked buckets, and
`includeUntracked: false` in the snapshot config: the result has
exactly one row per workspace plus one untracked row (no
provider/worktree duplicates); every row satisfies
`Σ mix[].tokens === tokens`; row costs sum to the range `cost.total`;
a run group with no matching workspace folds into the untracked row;
and `Σ rows.tokens = Σ days = Σ byProvider.tokens` with
`totals` equal to the overview-tile sums (AC5); (g) **unconditional
row presence** — a `buildWorkspaceRows` fixture whose registry contains
a workspace with **no** usage rows and no run groups, whose usage data
contains **no** untracked buckets, and whose run groups include a
`repoId: null` entry plus a non-null `repoId` matching no workspace:
the zero-activity workspace renders a zero row, the untracked row still
renders and carries both folded run groups' counts, no run is dropped
(`Σ rows.runs` equals the seeded run totals), and `totals` still equals
the overview-tile sums (AC5); (h) **total status projection** — a
`projectRunStatus` + tiles/table fixture seeding one run of **every**
known status (`done`, `halted`, `failed`, `running`, `paused`,
`canceled`) plus one unknown string (e.g. `"archived-v2"`): each maps
to its §4.9 class (`canceled → halted`, `running/paused → active`,
unknown → `other`), the tile run total equals the seeded run count
(nothing dropped), the breakdown appends `active`/`other` clauses only
when non-zero, and the table totals equal the tile counts class by
class (AC5).

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
6. **`haltReason` refinement of the `halted` class** (§4.9) —
   distinguishing error halts from operator stops/cancels in the
   outcome display.
7. **Usage-ledger depth — resolved by sparse day emission, no residual
   truncation.** `usage-host.ts`'s `queryRange` guard rejects only
   degenerate inputs (non-finite bounds, `toMs <= fromMs`) — the
   span-size rejection (~10 years) that used to sit alongside it, and
   the worker-side day-walk clamp (`MAX_RANGE_DAYS`, ~27 years) that
   briefly replaced it, were BOTH misplaced policy and have been
   removed: either one violated this spec's own §4.7/AC3 requirement
   that `all` start at the real `min(earliestDayMs, anchors)` with no
   exception, however deep the ledger goes, and the clamp specifically
   created a regime where the tokens tile (which sums `days`) could
   silently disagree with the table (AC5) once a ledger ran deep
   enough. `services/usage/range.ts`'s `buildRangeResult` now emits
   `days` SPARSELY instead of walking every calendar day: one point per
   ledger day WITH DATA in `[fromMs, toMs)` — the SAME entries, SAME
   predicate the `byWorkspace`/`byProvider`/`cost`/`earliestDayMs`
   bucket merge already used — so `Σ days` ≡ those totals by
   construction, for any window, and the whole thing costs O(ledger
   size), never O(requested calendar span). No clamp, no truncation
   regime, nothing left to defer. Two purely cosmetic/hygiene residuals
   remain, neither a correctness gap: (a) a genuinely multi-decade `all`
   domain renders very many weekly chart columns (no data loss, just a
   dense chart); (b) a bogus ancient timestamp in a provider's own log
   (nothing sanitizes a pre-app-era timestamp on ingest) would widen
   `all`'s domain to match it just as validly as real history would —
   an ingest-time floor on event timestamps (or ledger rollups, same
   family as item 2's insights rollups) is the durable fix for that,
   not a range-query-side clamp.
8. **App-focus collector binds the main window only** — time spent in
   the detached dashboard window currently counts as main-window blur.
   Revisit alongside the workspace-active collector (item 1).

## 10. Out of scope

- Any change to capture, consent, retention, or the worker tick/status
  path.
- Any change to the `usage:snapshot` push path, `UsageStrip`,
  `UsagePopover`, or `UsageChart` (the dashboard is pull-only). The
  popover's `includeUntracked` renderer filter keeps its current
  behavior there — it simply is not an input to the dashboard
  (decision 14).
- Provider-limit UI of any kind (standing telemetry rule).
- Keyboard-shortcut entry point; usage-strip click-through.
- Backfill importers (Tier-2 raw-log history) — the dashboard reads what
  the stores already hold.
