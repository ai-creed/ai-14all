# Token Telemetry — Unified Scope + Lifetime Persistence

**Date:** 2026-06-29
**Status:** Design approved (brainstorm), pending implementation plan
**Author:** Vu + Claude (brainstorm session)
**Builds on:** the analytics telemetry shipped on `feat/telemetry-usage-analytics` (spec `2026-06-28-telemetry-usage-analytics-design.md`, "Slice 1")

---

## 1. Problem

Slice 1 shipped the driver-per-provider analytics telemetry, but live use surfaced two defects:

1. **Three different time windows are shown at once, so the numbers don't agree.** The chart and the Provider roll-up come from the daily series (**calendar week/month**, which includes the 35-day backfill). The Worktree breakdown rows come from **since-launch** ("this sitting"). The cost comes from the **since-launch** ledger. Result: the popover can show `754M tokens` in the chart/roll-up, `$0` cost, and **all-zero** worktree rows simultaneously — internally contradictory and confusing.

2. **Notional cost reads $0.** Pricing was a strict-exact `(provider, model)` lookup against an undated placeholder table; real logs emit different/dated model ids (e.g. `claude-opus-4-8`), so every lookup missed → all tokens "unpriced" → $0.

We want **one coherent window** the user selects, the same window driving chart + breakdown + cost; a **Session / Week / Month / All-time** scope toggle; **All-time** sourced from the full log history and **persisted** so it accumulates across runs without recomputing; and a **blended notional cost** that is never $0.

---

## 2. Goals / Non-goals

### Goals
- **One source of truth.** A single daily-bucket ledger drives every number for any day-aligned window, so chart, breakdown, and cost cannot disagree.
- **Four scopes:** `Session` (this app run) · `Week` (calendar) · `Month` (calendar) · `All-time` (full history).
- **All-time is persisted and incremental.** Seed once from a full log scan, cache to `userData`, accumulate forward — never recompute the whole history each run.
- **Blended per-provider notional cost.** Every known-provider token is priced; no $0.
- **Adaptive chart:** Session = hourly bars (this run); Week/Month = daily bars; **All-time = no chart** (number + breakdown + cost carry it).
- **Chip = Week/Month** glance only; **popover = full 4-way toggle** (opens on Session).
- Fix the chart-width inconsistency (week vs month bars differ in width).

### Non-goals (now)
- Per-event/live-process attribution (we still scrape `~/.*` logs).
- Exact per-model pricing (deliberately blended per provider — see §7).
- Monthly compaction of the ledger (kept daily; compaction is a future option if a file ever grows large — §10).
- antigravity / cursor token extraction (still inert).
- A separate "in-app cumulative across runs, uptime-gated" lifetime number — **dropped**; `Session` + `All-time` subsume it.

---

## 3. Data model

Two structures replace the four ad-hoc accumulators (`since` map, rolling-week counters, daily series, since-launch cost ledger).

### 3.1 Persisted daily ledger (the source of truth for day-aligned windows)

```ts
// services/usage/ledger.ts (node-only)
type BucketKey = string; // `${cwd}\u0000${provider}\u0000${model}` (NUL-separated; written as the \u0000 escape, never a raw control byte)

interface DailyLedger {
  // dayStartMs (local midnight) → BucketKey → TokenTotals
  days: Map<number, Map<BucketKey, TokenTotals>>;
}
```

- `dayStartMs = startOfLocalDay(event.timestampMs)` — local-day aligned, computed by **calendar-date iteration** (DST-safe, matching Slice 1's `dailySeries` fix), so a 23h/25h day stays aligned.
- One ledger entry carries enough to derive **every** day-aligned view: tokens (sum any subset), cost (aggregate by `(provider, model)` then price), provider roll-up (aggregate by `provider`), and the worktree/workspace breakdown (aggregate by `cwd`, then `matchCwd`).
- ezio events carry no per-turn timestamp → `event.timestampMs` is the file mtime (Slice 1 behavior); they bucket by the mtime's local day.

### 3.2 Session accumulator (in-memory, "this run")

```ts
interface SessionState {
  since: Map<BucketKey, TokenTotals>;            // since launchMs
  hourly: Map<number, Partial<Record<AgentProviderId, number>>>; // hourStartMs → per-provider billable
}
```

- Gated on `event.timestampMs >= launchMs`. **Not persisted; resets every run** — that is exactly what `Session` means.
- Every ingested event writes the **ledger** unconditionally and the **session** accumulator only when `timestampMs >= launchMs`. (An event newly read this run but timestamped before launch — e.g. written while the app was closed — lands in the ledger only, not the session.)
- `hourly` powers the Session chart (hourly bars over this run).

### 3.3 Deriving each scope

| Scope | Source | Window |
|---|---|---|
| `session` | session accumulator | events since `launchMs` |
| `week` | ledger | days `>= startOfWeekMonday(now)` (local, Monday start) |
| `month` | ledger | days `>= startOfMonth(now)` (local, 1st) |
| `all-time` | ledger | every day in the ledger |

For a window, sum the matching ledger days' buckets → produces tokens, the `(provider, model)` totals to price, the per-`provider` roll-up, and the per-`cwd` breakdown.

---

## 4. Persistence + idempotency

### 4.1 Store

- **`userData/usage-ledger.json`** — the serialized `DailyLedger` (`version: 2`). Debounced writes (e.g. on the existing snapshot throttle).
- **`userData/usage-offsets.json`** — the existing byte-offset cache, extended (§4.3). Kept across runs; **no longer reset on launch** (the old `resetRecentOffsets` 35-day re-read hack is **deleted** — persistence replaces its purpose).

### 4.2 Incremental sweep

- On launch: load the ledger and the offsets. For each `jsonlDriver × driver.roots(home)` file, read only bytes appended since the saved offset (existing `readNewLines`), parse, and for each event update the ledger (and session if since-launch). Persist the ledger + offsets (debounced).
- **First run / format upgrade** (no `usage-ledger.json`, or a lower `version`): reset offsets to `0`, **full-scan every log file** (chunked via the existing `processInBatches`, emitting progressively), seed the ledger, persist. One-time.

### 4.3 Idempotency (the load-bearing part of persistence)

A persisted, accumulated ledger must never double-count. Append-only reads (the overwhelming case — claude and codex session files are append-only and never truncate) are idempotent because the offset cache guarantees each byte is read once. The only re-read trigger is **truncation/rotation** (size < saved offset — essentially just ezio's `unknown-0.record.jsonl` placeholder being rewritten).

To stay idempotent on truncation, each **active** offset entry stores the contribution that file has made:

```ts
interface OffsetEntry {
  offset: number;
  mtime: number;
  ctx?: ParseCtx;                 // Slice 1
  contribution?: Map<number, Map<BucketKey, TokenTotals>>; // day → BucketKey → totals this file added
}
```

- **Append:** read new bytes; add the delta to both the global ledger and the file's `contribution`.
- **Truncation** (`size < offset`): **subtract** the file's `contribution` from the global ledger, reset `offset = 0` and `contribution = {}`, re-read the whole (new) file, recompute its contribution, add it. No double-count.
- **Sealing:** a file not modified within an "active horizon" (~35 days) is sealed — its `contribution` detail is dropped (its totals remain in the global ledger), bounding the offset cache. Sealed files are completed claude/codex sessions that never truncate, so sealing is safe. (If a sealed file ever truncates — not observed in practice — it re-reads and may transiently over-count; documented limitation.)

This keeps the persisted state small (a summed ledger + per-active-file contributions) while remaining idempotent.

---

## 5. Snapshot (worker precomputes all four scopes)

The worker emits, in one snapshot, all four scopes plus both chart series, so the renderer switches scope instantly (no round-trip) and the chip and popover can display different scopes at once. Every number inside a scope is consistent by construction (it's derived from one ledger window).

```ts
export type UsageScope = "session" | "week" | "month" | "all-time";

export interface ScopeRollupRow {
  provider: AgentProviderId;
  tokens: number;          // billable in this scope
  costUsd: number | null;  // notional; null only if the provider has no rate at all
}

export interface ScopeData {
  scope: UsageScope;
  totalTokens: number;        // billable across the scope
  byProvider: ScopeRollupRow[]; // provider roll-up, sorted desc by tokens
  rows: UsageRow[];           // workspace/worktree breakdown for THIS scope
  cost: CostSnapshot;         // priced for THIS scope
}

export interface HourlyPoint {
  hourStartMs: number;
  tokens: Partial<Record<AgentProviderId, number>>;
}

export interface UsageSnapshot {
  generatedAtMs: number;
  providers: ProviderTelemetryInfo[]; // identity + capabilities + hasData (Slice 1)
  scopes: Record<UsageScope, ScopeData>;
  seriesDaily: DailyPoint[];   // by provider, ~35d → Week/Month chart
  seriesHourly: HourlyPoint[]; // by provider, this run → Session chart
  codexLimits: LimitGauge | null;
  config: UsageConfig;
}
```

- `UsageRow` is reshaped to be **scope-relative**: `{ workspaceId, worktreeId, worktreePath, worktreeTitle, provider, active, tokens: TokenTotals, costUsd: number | null }`. The dual `sinceLaunch`/`thisWeek` fields are removed (each `ScopeData.rows` already carries that scope's tokens).
- `CostSnapshot` keeps `{ perProvider, total, currency, notional, unpricedTokens }`; with blended pricing `unpricedTokens` is normally `0` (every known provider has a rate).
- The renderer reads `snapshot.scopes[selectedScope]` for numbers/breakdown/cost, `seriesDaily`/`seriesHourly` for the chart.

---

## 6. Pipeline wiring

- **Aggregator → Ledger.** Replace `UsageAggregator`'s window-specific counters with the `DailyLedger` + `SessionState` and the scope-derivation queries (`scopeData(scope, now, known, …)`). Keep `providerLimits` map + `providersWithData`.
- **Worker** (`usage-worker.ts`): load ledger + offsets (no reset); incremental sweep updates ledger + session + per-file contribution; persist (debounced); `emitSnapshot` builds all four `ScopeData` + both series + `codexLimits`. Delete `resetRecentOffsets` usage and `SERIES_WINDOW_MS` reset (the ledger is the retention authority now).
- **Host/protocol** (`usage-host.ts`, `worker-protocol.ts`): config carries `home` + the two persisted UI settings (`chipRange`, `popoverScope`, `includeUntracked`); add `setChipRange` / `setPopoverScope` messages (replace `setRange`). Pass `userDataDir` for the ledger path.
- **IPC/preload/contracts:** swap `usage.setRange` → `usage.setChipRange(range)` + `usage.setScope(scope)`. `setEnabled` / `setIncludeUntracked` / `onSnapshot` stay.

---

## 7. Pricing (blended, static)

Replace strict-exact `(provider, model)` pricing with a **blended per-provider** rate. This deliberately **overrides** Slice 1's "strict exact, no provider-default/no guessing" rule — the user accepted that cost is a notional nice-to-have where exactness isn't worth the brittleness (every dated model id missing → $0).

```ts
// services/usage/cost/pricing.ts
interface ProviderRate { inputPerM: number; outputPerM: number; cacheReadPerM: number; } // USD per 1M, last verified 2026-06
const PROVIDER_RATE: Partial<Record<AgentProviderId, ProviderRate>> = {
  claude: { inputPerM: 3,    outputPerM: 15, cacheReadPerM: 0.30 },  // Anthropic median (sonnet-class)
  codex:  { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.125 }, // OpenAI median (gpt-5-class)
  ezio:   { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.125 }, // runs on the codex/OpenAI provider
};
const GLOBAL_AVG: ProviderRate = { inputPerM: 2, outputPerM: 12, cacheReadPerM: 0.2 };
export function rateFor(provider: AgentProviderId): ProviderRate { return PROVIDER_RATE[provider] ?? GLOBAL_AVG; }
```

- `model` is ignored; every token of a known provider is priced at its blended median, so cost is never $0. Unknown provider → `GLOBAL_AVG`.
- `estimateCostUsd(t, rate)` is unchanged (input/output/cache-read per M; cacheRead = `max(0, raw - billable)`). `buildCostSnapshot(entries, rate?)` is unchanged in shape — each scope's cost is built from that scope's `(provider, model)` totals.
- A "last verified: 2026-06" comment + the median values are updated in a commit when prices drift; no runtime network.
- Record the rule override: deprecate the strict-exact memory/decision and note the new blended approach in this spec.

---

## 8. UI

### 8.1 Chip
- `Week / Month` toggle only (Week default). Renders `scopes[chipRange]`: the period total + notional `$` + the daily stacked bars (`seriesDaily` sliced to the calendar week/month). Coherent, never `$0`.
- **Chart-width fix:** pin the chart container width (fixed px in the chip, `100%` in the popover) so Week (7 bars) and Month (~30 bars) fill the same width with stretched columns (bars are already `flex:1`).

### 8.2 Popover
- `Session · Week · Month · All-time` toggle (opens on **Session**). Renders the selected `ScopeData`:
  - **Chart:** Session → hourly bars (`seriesHourly`); Week/Month → daily bars (`seriesDaily` sliced); **All-time → no chart** (omit the chart block).
  - **Breakdown:** `Provider` (default roll-up, `byProvider`) · `Workspace` · `Worktree` (the `rows` tree). Tokens and `$` both come from the selected scope, so they agree.
  - **Cost:** plain "notional" framing — each scope's `$` matches its own window, so the "since launch" caption is removed.
  - **Codex limits:** collapsed native row (unchanged), only when `codexLimits` present.
- The old uptime-gated lifetime cards are removed (Session + All-time cover the story).

---

## 9. cwd attribution across history

- `matchCwd(cwdOrSlug, known)` (real-path + ezio dir-slug, Slice 1) maps each ledger `cwd` to a current worktree.
- Historical cwds with no current worktree (deleted/closed) group under their **workspace** (the top-level repo path component) where derivable, else `other (untracked)`. This keeps the All-time breakdown meaningful even for worktrees that no longer exist.
- The Worktree breakdown for All-time may list many historical entries; they sort by tokens. (No top-N cap in v1; revisit if lists get unwieldy.)

---

## 10. Migration & edge cases

- **Offset-cache compatibility:** old `OffsetEntry` (offset/mtime/ctx, no `contribution`) loads fine; the format upgrade (no `usage-ledger.json`) triggers the one-time reset-to-0 full scan that rebuilds both the ledger and contributions.
- **First-run perf:** the full scan is chunked (`processInBatches`) and emits progressively; the chip/popover fill in as it indexes. A subtle "indexing…" affordance is optional.
- **Empty/zero scope:** a fresh run shows `Session ≈ 0` until work happens (expected); Week/Month/All-time are non-empty from the persisted ledger.
- **Provider/model cardinality:** the ledger is bounded by `days × cwds × providers × models`; per-day totals (not per-event), so it stays small. Compaction of days older than ~1 year into monthly buckets is a documented future option, not v1.
- **ezio mtime coarseness:** a long ezio file spanning the launch boundary attributes earlier turns to the latest mtime (Slice 1 limitation, unchanged).
- **Truncation:** reconciled per §4.3.

---

## 11. Data-model changes (`shared/models/usage.ts`)

- **Add:** `UsageScope`, `ScopeRollupRow`, `ScopeData`, `HourlyPoint`.
- **Reshape:** `UsageRow` → scope-relative (`tokens: TokenTotals`, `costUsd: number | null`; drop `sinceLaunch`/`thisWeek`). `UsageSnapshot` → `{ generatedAtMs, providers, scopes, seriesDaily, seriesHourly, codexLimits, config }` (drop the single `series`/`cost`/`rows`/`totals` top-level fields; they move into `scopes`). `UsageConfig` → `{ chipRange: "week"|"month"; popoverScope: UsageScope; includeUntracked: boolean }`.
- **Keep:** `ProviderTelemetryCapabilities`, `ProviderTelemetryInfo`, `CostSnapshot`, `DailyPoint`, `LimitGauge`, `ProviderRateLimits`, `TokenTotals`, `UsageEvent`, `KnownWorktree`.

---

## 12. File-by-file (this slice)

**New**
- `services/usage/ledger.ts` — `DailyLedger` + `SessionState`, ingest, scope-derivation queries.
- `services/usage/ledger-store.ts` — JSON load/save/merge of the persisted ledger (+ contribution reconcile helpers).

**Modified**
- `shared/models/usage.ts` — §11 type changes.
- `shared/models/persisted-workspace-state.ts` — `UsageTelemetrySettingsSchema` → `{ enabled, includeUntracked, chipRange, popoverScope }`.
- `services/usage/aggregator.ts` — replaced by/refactored into the ledger queries (or thinned to delegate).
- `services/usage/scanner.ts` — `processJsonlFile` updates the ledger + session + per-file contribution; `changed()` truncation drives the reconcile.
- `services/usage/snapshot.ts` — build four `ScopeData` + `seriesDaily` + `seriesHourly` + `codexLimits`.
- `services/usage/cost/pricing.ts` — blended `PROVIDER_RATE` + `rateFor(provider)`.
- `services/usage/cost/cost.ts` — `buildCostSnapshot` unchanged in shape (per-scope inputs).
- `services/usage/worktree-map.ts` — add workspace-grouping for unmatched historical cwds.
- `services/usage/worker-protocol.ts` — config (`home`, `userDataDir`, `chipRange`, `popoverScope`, `includeUntracked`); `setChipRange`/`setScope` messages.
- `electron/main/services/usage-worker.ts` — load/persist ledger; no reset; emit the new snapshot.
- `electron/main/services/usage-host.ts` — pass `userDataDir`; `chipRange`/`popoverScope` state + setters.
- `electron/main/ipc.ts`, `electron/preload/index.ts`, `shared/contracts/commands.ts` — `setChipRange` + `setScope` (replace `setRange`).
- `src/features/telemetry/UsageStrip.tsx` — chip reads `scopes[chipRange]`; W/M.
- `src/features/telemetry/UsagePopover.tsx` — 4-way scope toggle; adaptive chart; All-time no chart; plain notional cost; remove the since-launch caption.
- `src/features/telemetry/UsageChart.tsx` — accept daily **or** hourly points; render nothing for All-time.
- `src/features/telemetry/rollup.ts` — scope-aware helpers (the renderer mostly reads precomputed `ScopeData`, so this thins out).
- `src/app/shell.css` — chart-width fix; tidy orphaned `.usage-budget-*` rules.

---

## 13. Testing

- **Ledger:** ingest buckets by `(day, cwd, provider, model)`; scope queries (`session`/`week`/`month`/`all-time`) sum correctly and are distinct; DST day alignment (the 25h fall-back test, adapted).
- **Idempotency:** re-ingesting the same bytes does not double-count; truncation subtract-and-re-read yields the correct total; sealing drops contribution without changing the ledger sum.
- **Persistence:** save → load round-trips the ledger; a second run reads only appended bytes (offsets honored, no reset); first-run/upgrade does the full scan and seeds.
- **Pricing:** blended `rateFor(provider)` prices each provider; unknown provider → `GLOBAL_AVG`; cost is non-zero for real (dated) model ids.
- **Snapshot coherence (the headline guard):** within each `ScopeData`, `totalTokens` == sum of `byProvider` tokens == sum of `rows` tokens, and `cost` is priced from the same window — for all four scopes. A pre-launch event is in `week/month/all-time` but **not** in `session`.
- **UI:** chip W/M reads the right scope; popover renders each scope; All-time omits the chart; cost shows real `$`; breakdown tokens and `$` agree.
- **E2E:** fixture with the new `scopes` snapshot shape; scope toggle switches the rendered numbers/chart; inert providers render no segments.

---

## 14. Open questions / future

- **Compaction:** roll days older than ~1 year into monthly buckets if a heavy user's `usage-ledger.json` grows large; or migrate the store to better-sqlite3 (already a repo dependency).
- **Pricing freshness:** the median table drifts; consider a dated table with a visible "rates as of" note in the popover.
- **All-time breakdown size:** top-N + "others" if the historical worktree list gets long.
- **Indexing affordance:** a first-run "indexing history…" hint while the full scan runs.
