# Token Telemetry — Usage Analytics Redesign

**Date:** 2026-06-28
**Status:** Design approved (brainstorm), pending implementation plan
**Author:** Vu + Claude (brainstorm session)
**Supersedes:** the limit-monitoring telemetry shipped in `services/usage/*` + `src/features/telemetry/*`

---

## 1. Problem

The current telemetry subsystem was built around **two hardcoded providers** (`claude`, `codex`) and a **limit-monitoring** frame (5-hour / weekly gauges). Two things broke that frame:

1. **More integrated agent providers.** The agent registry (`shared/models/agent-provider.ts`) now lists five agents — `claude`, `codex`, `ezio`, `cursor`, `antigravity` — but telemetry only understands two. The two-provider assumption is hardcoded in ~6 layers (`UsageProvider` union, scanner's per-provider processors, snapshot's two fixed gauges, the renderer's `ORDER = ["claude","codex"]`, worker config's two roots, the budget tier tables). Adding an agent means editing every layer.

2. **Limit monitoring is the wrong job.** Each vendor CLI already exposes its own `/usage` or `/status`. For Codex we can read a *real* reported percentage, but for Claude we only had a **reverse-engineered budget proxy** (`budget.ts` tier tables + a user-facing budget editor) that guesses a number the API never exposes. A guessed gauge is worse than no gauge — it implies precision we don't have, and it duplicates a number the vendor shows authoritatively.

### What telemetry should be instead

Two stories worth telling, neither of which is "how close am I to a limit":

- **Productivity / burn** — how many tokens (and notional dollars) were spent *this sitting*, sliceable by worktree (in-app session) → workspace → total, and by provider.
- **Engagement / lifetime** — cumulative tokens (and dollars) spent through the app over its whole life — the "look how much I've run through this thing" number.

Limits become a *nice-to-have, native-only* footnote: if a provider reports real limits (Codex does), show them, collapsed. Nobody else gets a gauge, and the Claude budget proxy is deleted.

---

## 2. Data reality (investigation findings)

Before designing, we probed what each agent actually writes to disk. The landscape is **heterogeneous**, which is the central design constraint — the old "every provider = append-only JSONL with a line parser" assumption is false.

| Agent | Store | Format | Token data | Native limits | Timestamps | cwd |
|---|---|---|---|---|---|---|
| **claude** | `~/.claude/projects/**/*.jsonl` | append JSONL | ✅ `message.usage` per line | ❌ | per-line ISO | in-line (`cwd`) |
| **codex** | `~/.codex/sessions/**/*.jsonl` | append JSONL | ✅ `token_count` lines | ✅ `rate_limits` (5h + weekly, real %) | per-line ISO | threaded `session_meta` |
| **ezio** | `~/.local/state/ezio/sessions/<dir-slug>/*.record.jsonl` | append JSONL | ✅ `usage:{contextTokens,outputTokens,cachedTokens,contextLimit}` per turn | ❌ | **none** (file mtime only) | **dir-slug** (no in-record cwd) |
| **cursor** | `~/.cursor/projects/<slug>/` | empty dirs | ❌ nothing readable on disk | ❌ | — | — |
| **antigravity** | `~/.gemini/antigravity-cli/conversations/*.db` | SQLite + protobuf blobs | ⚠️ buried in opaque blobs (impractical to parse) | ⚠️ buried | — | `workspace` field (in blob) |

Notes that shaped the design:

- **ezio** runs on the `hax` engine. The raw `hax` sessions (`~/.local/state/hax/sessions/`) carry **no** token usage; only the ezio wrapper's `*.record.jsonl` does. ezio's records have **no per-turn timestamp** (only file mtime) and **no cwd** (derived from the directory slug). It reports a `contextLimit` (context-window size) that none of the others do.
- **cursor** keeps no usable token log where claude/codex keep theirs — skip gracefully.
- **antigravity** stores everything as serialized protobuf in SQLite — extracting tokens means decoding a proprietary schema. Out of scope; skip gracefully, leave room for a future SQLite reader.

**Conclusion:** three agents emit parseable token logs (`claude`, `codex`, `ezio`), each with a *different capability profile*. Two emit nothing usable (`cursor`, `antigravity`). The design must model capabilities per provider and degrade gracefully.

---

## 3. Goals / Non-goals

### Goals
- **Generic N-provider capture.** One self-describing telemetry **driver per provider**, registered once; the core iterates drivers. Adding an agent = one module.
- **Graceful degradation.** Providers with no usable telemetry are declared-but-inert; the UI never assumes a fixed provider set.
- **Reframe to usage analytics.** Drop the Claude budget proxy entirely. Surface burn (tokens + notional $) sliceable by provider / workspace / worktree, plus lifetime totals.
- **Native limits only.** Keep Codex's real 5h/weekly gauge, collapsed. No proxy for anyone.
- **New chipbar + popover** (locked design, §7): a dense daily stacked bar (by provider, week/month) in the chip; a drill-down popover with the chart, a sliceable breakdown, lifetime cards, and the collapsed native limits.

### Non-goals (now)
- **Antigravity / cursor token extraction.** Inert in this design; a SQLite reader for antigravity is a possible future driver.
- **Per-live-session attribution.** We still scrape `~/.*` logs rather than tapping the live launcher/whisper processes. (A future evolution; the driver abstraction does not preclude it.)
- **ezio context-fill gauge.** ezio's `contextLimit` is captured but unused; a context-window-fill gauge is deferred.
- **Real billing.** Cost is **notional list-price "API-equivalent value"**, not a bill — most agents here run on flat subscriptions where marginal spend is ~$0.

---

## 4. Architecture

### 4.1 Telemetry driver

One driver per provider, server-side (node-only; never imported by the renderer), keyed by `AgentProviderId`. Each driver declares its capabilities and owns its format quirks. Identity (label, brand color, launcher order) stays in `shared/models/agent-provider.ts`; drivers reference it by id.

**Type-boundary rule.** The capability *descriptor* is a plain, serializable DTO that the renderer must read off the snapshot, so it is canonical in **`shared/models/usage.ts`** as `ProviderTelemetryCapabilities` (§5) — `StoreKind` / `TimeSource` / `CwdSource` value unions included. The node-only driver module **imports** that DTO; it never exports its own capability type into `shared`. Driver *behavior* (`roots`, `keep`, `parseLine`, `buildGauge`, `ParseCtx`, etc.) stays node-only. The dependency therefore points service → shared, never shared/renderer → service.

```ts
// services/usage/providers/types.ts  (node-only)
import type { AgentProviderId } from "../../../shared/models/agent-provider.js";
import type {
  LimitGauge, ProviderRateLimits, UsageEvent,
  ProviderTelemetryCapabilities, // canonical, renderer-safe DTO (shared/models/usage.ts)
} from "../../../shared/models/usage.js";

// Opaque per-file parse state, threaded across appended lines and persisted in
// the offset cache. Codex threads cwd/model; ezio stores the dir-slug; claude
// needs nothing.
export type ParseCtx = Record<string, string>;

export interface JsonlLineResult {
  event?: UsageEvent;          // a token event to aggregate
  limits?: ProviderRateLimits; // provider-reported limits (nativeLimits only)
}

export interface GaugeContext {
  providerLimits: ProviderRateLimits | null; // latest captured for this provider
  nowMs: number;
}

export interface TelemetryDriver {
  id: AgentProviderId;
  capabilities: ProviderTelemetryCapabilities; // shared DTO — see shared/models/usage.ts
  roots(home: string): string[];               // [] unless storeKind === "jsonl-tree"

  // jsonl-tree only:
  keep?(line: string): boolean;                // pre-JSON.parse marker gate (perf contract)
  seedCtx?(file: string): ParseCtx;            // e.g. dir-slug (ezio), sessionId (codex)
  parseLine?(line: string, ctx: ParseCtx): JsonlLineResult; // may mutate ctx

  // nativeLimits only:
  buildGauge?(ctx: GaugeContext): LimitGauge;  // codex 5h/weekly real gauge
}
```

### 4.2 Capability axes (why each exists)

| Axis | Values | Forced by |
|---|---|---|
| `storeKind` | `jsonl-tree` / `sqlite-dir` / `none` | antigravity (sqlite), cursor (none) |
| `timeSource` | `per-event` / `file-mtime` / `none` | ezio records have no timestamp → bucket by file mtime; inert providers emit no events → `none` |
| `cwdSource` | `in-line` / `dir-slug` / `none` | ezio records have no cwd → derive from the directory slug; inert providers emit no events → `none` |
| `nativeLimits` | `true` / `false` | codex reports real limits; nobody else does |

### 4.3 Driver registry

```ts
// services/usage/providers/index.ts
export const TELEMETRY_DRIVERS: readonly TelemetryDriver[] = [
  claudeDriver, codexDriver, ezioDriver, cursorDriver, antigravityDriver,
]; // ordered to match AGENT_PROVIDERS
export const jsonlDrivers = TELEMETRY_DRIVERS.filter(d => d.capabilities.storeKind === "jsonl-tree");
export function driverFor(id: AgentProviderId): TelemetryDriver | undefined;
```

The five Slice-1 drivers:

| Driver | roots(home) | keep marker | token map | limits |
|---|---|---|---|---|
| `claude` | `~/.claude/projects` | `"usage"` | `claudeTokens` | none |
| `codex` | `~/.codex/sessions` | `"token_count"` (+ meta markers) | `codexTokens` (per-turn `last_token_usage`) | `parseCodexRateLimits` |
| `ezio` | `~/.local/state/ezio/sessions` | `"usage"` | `ezioTokens` | none |
| `cursor` | `[]` | — | inert (`tokenLog:false`) | none |
| `antigravity` | `[]` | — | inert (`storeKind:"sqlite-dir"`, `tokenLog:false`) | none |

Inert drivers (`cursor`, `antigravity`) emit no events, so they declare `timeSource:"none"` and `cwdSource:"none"` — the capability metadata stays truthful rather than claiming a per-event/file-mtime source they never exercise.

### 4.4 Generic JSONL processing

A single `processJsonlFile(driver, file, cache, ingest, onLimits)` replaces the bespoke `processClaudeFile` / `processCodexFile`. It keeps the existing, perf-critical machinery (byte-offset incremental reader, marker pre-filter, ctx threading) and parameterizes it by driver:

1. `changed(file, cache)` → `{ from, mtime }`, **now also detecting truncation**: if the file's current size < the cached offset (log rotation / `unknown-0.record.jsonl` rewrite), reset `from = 0`.
2. `ctx = driver.seedCtx?.(file) ?? {}`. For `cwdSource:"dir-slug"` (ezio), `seedCtx` stores the parent directory's slug as `ctx.cwd`.
3. Back-compat ctx recovery (generalized from the codex special-case): if `from > 0` and the driver threads ctx that is still empty, re-scan `[0, from)` with the marker filter to recover it.
4. `readNewLines(file, from, driver.keep)` → newly appended matching lines.
5. For each line: `r = driver.parseLine(line, ctx)`.
   - `r.limits` → `onLimits(driver.id, r.limits)`.
   - `r.event` → if `timeSource === "file-mtime"`, set `event.timestampMs = mtime`; then `ingest(event)`.
6. Persist `{ offset, mtime, ctx }`.

The aggregator is already keyed by `(provider, cwd)` strings, so it is N-provider-ready unchanged except for three additions: the native-limits map (§4.6), the per-provider daily series (§4.7), and the per-`(provider, model)` cost ledger (§4.8). The cost ledger preserves the model dimension that both the `(provider, cwd)` rows and the per-provider daily series drop — cost must be derived from the ledger, never re-derived from those reduced totals.

### 4.5 cwd attribution (the ezio dir-slug)

ezio records carry no cwd; the path's parent directory is a slug of the cwd. The slug rule (confirmed by inspection):

```
slug(path) = path.replace(/^\//, "").replace(/[/.]/g, "-")
// /Users/vuphan/Dev/ai-14all/.worktrees/bugs-hardening
//   → "Users-vuphan-Dev-ai-14all--worktrees-bugs-hardening"
```

The slug is **lossy** (not safely reversible), so resolution is done by **forward-slugifying known worktrees and matching**, at snapshot time (robust against a worktree becoming "known" after its file was already scanned):

- ezio events set `cwd = <dir-slug>` (the raw slug).
- `matchCwd(cwdOrSlug, known)` in `worktree-map.ts` gains a second pass: try the existing real-path match first; if no hit, compare `slug(known.path)` against the input. Claude/codex feed real paths (first pass); ezio feeds slugs (second pass).
- Unmatched ezio slug → the event lands in the untracked bucket (already handled).

### 4.6 Native limits

`ProviderRateLimits` (renamed from `CodexRateLimits` — generic shape, still only produced by codex in Slice 1) is stored per provider in the aggregator: `providerLimits: Map<AgentProviderId, ProviderRateLimits>`. The snapshot builds a `LimitGauge` only for drivers with `nativeLimits:true` and a captured value. There is **no proxy path** — `budget.ts`, the tier tables, the budget editor, and the `LimitGauge.real` discriminator are deleted.

### 4.7 Daily series (for the stacked chart)

The chart needs per-day, per-provider totals over the current week / month. The aggregator gains a **per-provider daily counter** (`bucketMs = 24h`, window ≈ 35 days) summing billable tokens. The snapshot exposes:

```ts
interface DailyPoint { dayStartMs: number; tokens: Record<AgentProviderId, number>; }
```

"Current week" = calendar week (local, Monday start); "current month" = calendar month. Day buckets are local-day aligned.

### 4.8 Cost estimation (notional)

Cost must be computed **per model**: rates differ by model, and an unrecognized model must be excluded rather than guessed. The `(provider, cwd)` rows and the per-provider daily series both collapse the model dimension, so cost is computed from a **dedicated per-`(provider, model)` token ledger** the aggregator maintains alongside them — never re-derived from those reduced totals.

**Aggregator ledger.** Alongside the `(provider, cwd)` rows, the aggregator accumulates `costLedger: Map<string, TokenTotals>` keyed by `${provider}\u0000${model}` (a NUL separator, written here as the escape `\u0000` to keep this spec plain text, chosen to avoid delimiter collisions; every `UsageEvent` already carries `model`). This is the only structure that retains per-model token totals, and it is the sole input to cost.

**Pricing registry** maps an exact `(provider, model)` to a list-price rate. Lookup is **strict** — a miss returns `null`. There is deliberately **no provider-default fallback**: guessing a rate for an unrecognized model is exactly the "silently counted" failure mode we forbid.

```ts
// services/usage/cost/pricing.ts
interface ModelRate { inputPerM: number; outputPerM: number; cacheReadPerM: number; } // USD per 1M tokens
function rateFor(provider: AgentProviderId, model: string): ModelRate | null; // strict; null on miss (no default)
// services/usage/cost/cost.ts
function estimateCostUsd(t: TokenTotals, rate: ModelRate): number;            // pure multiply, priced entry only
function buildCostSnapshot(ledger: Map<string, TokenTotals>): CostSnapshot;   // walks the ledger per (provider, model)
```

`buildCostSnapshot` walks the ledger entry by entry. For each `(provider, model)`, `rate = rateFor(provider, model)`:
- **hit** → add `estimateCostUsd(tokens, rate)` to `perProvider[provider]` and `total`.
- **miss (`null`)** → add the entry's billable tokens to `unpricedTokens`; contribute **nothing** to any dollar figure.

A provider whose models are *all* unpriced is therefore absent from `perProvider` (rendered `—`); a provider with mixed models prices only the known ones and reports the rest via `unpricedTokens`. The per-provider daily-series chart is unaffected — it remains a pure token count and never needs a rate.

- Cost is **notional** ("API-equivalent value"), surfaced with that framing in the UI.
- Unknown/unpriced model → excluded from every total and surfaced as `unpricedTokens` (never silently zero-counted, never guessed via a default rate).
- Claude rates: source from the `claude-api` skill at implementation time. Codex/ezio (OpenAI) rates: list-price per model; ezio runs on the codex provider (e.g. GPT-class, 272k context).

### 4.9 Lifetime (Slice 2)

Two cumulative numbers, persisted in `userData` (the in-memory aggregator resets each launch):

- **in app** — tokens/$ accrued while the app was running (app-uptime-gated). The must-have.
- **all-time** — tokens/$ across all history on the machine (full-history scan + persisted offsets). The additive; ship if the full scan proves cheap and reliable, else ship in-app only.

```ts
interface LifetimeSnapshot {
  inApp:  { tokens: number; costUsd: number | null };
  allTime?: { tokens: number; costUsd: number | null };
}
```

---

## 5. Data model changes (`shared/models/usage.ts`)

- `UsageProvider` → alias of `AgentProviderId` (union widens 2 → 5).
- `CodexRateLimits` → **`ProviderRateLimits`** (generic; codex still the only producer).
- `LimitGauge`: drop `real: boolean` (all gauges are now native).
- **Remove**: `UsageConfig.fiveHourBudget` / `weeklyBudget` / `weeklyResetDay` / `weeklyResetHour`. `UsageConfig` becomes `{ range: "week" | "month"; includeUntracked: boolean }`.
- **Capability DTO → canonical here.** The `StoreKind` / `TimeSource` / `CwdSource` value unions and the `ProviderTelemetryCapabilities` interface live in this shared module — **not** in the node-only driver module — so `ProviderTelemetryInfo` (and therefore `UsageSnapshot`, which the renderer consumes) carries no node-only type. The driver module (`services/usage/providers/types.ts`) imports this DTO; the dependency runs service → shared, never the reverse.
- **New**:

```ts
// Capability descriptor — plain, serializable, renderer-safe. Node-only drivers
// import this; it imports nothing from services/.
type StoreKind  = "jsonl-tree" | "sqlite-dir" | "none";
type TimeSource = "per-event" | "file-mtime" | "none";
type CwdSource  = "in-line" | "dir-slug" | "none";
interface ProviderTelemetryCapabilities {
  tokenLog: boolean;      // emits parseable per-turn token usage on disk
  storeKind: StoreKind;
  timeSource: TimeSource; // ezio = "file-mtime"; inert (cursor/antigravity) = "none"
  cwdSource: CwdSource;   // ezio = "dir-slug";   inert (cursor/antigravity) = "none"
  nativeLimits: boolean;  // codex = true
}

interface ProviderTelemetryInfo {
  id: AgentProviderId; label: string; brand: string;   // identity from providerDef()
  capabilities: ProviderTelemetryCapabilities;
  hasData: boolean;                                     // produced ≥1 event this run
}
interface CostSnapshot {
  perProvider: Partial<Record<AgentProviderId, number>>; // priced notional $ per provider (absent ⇒ rendered "—")
  total: number;                                         // Σ priced $; excludes unpriced tokens
  currency: "USD";
  notional: true;
  unpricedTokens: number;                                // billable tokens whose (provider, model) had no rate — surfaced, never $-counted
}

interface UsageSnapshot {
  generatedAtMs: number;
  providers: ProviderTelemetryInfo[];   // hybrid UI list (worker-declared, not a renderer constant)
  series: DailyPoint[];                  // daily buckets by provider, ~35d
  rows: UsageRow[];                      // per worktree+provider (since-launch + windowed)
  totals: TokenTotals;
  cost: CostSnapshot | null;             // Slice 1 (notional $)
  codexLimits: LimitGauge | null;        // native; collapsed in UI; only when present
  lifetime?: LifetimeSnapshot;           // Slice 2
  config: UsageConfig;
}
```

`UsageRow` is unchanged in shape; `UsageEvent` is unchanged (already carries `model`).

---

## 6. Pipeline wiring

- **Host** (`electron/main/services/usage-host.ts`): drop the hardcoded `claudeRoot` / `codexRoot` / `credentialsPath`. Pass only `home` (`os.homedir()`) and `userDataDir`. The worker imports the driver registry (server-side) and derives roots via `driver.roots(home)`.
- **Worker** (`electron/main/services/usage-worker.ts`): `sweep()` and the directory watchers iterate `jsonlDrivers × driver.roots(home)`. `resetRecentOffsets` already takes a root list. Remove the Claude-tier read (no longer needed — `credentials.ts` is deleted).
- **Worker protocol** (`services/usage/worker-protocol.ts`): config loses the three path fields and the budget/reset fields; gains nothing (drivers own roots). `setBudgets` / `setWeeklyReset` messages are removed; `setRange` (`"week"|"month"`) replaces them for the chart default.
- **Renderer IPC surface** (`shared/contracts/commands.ts`, `electron/preload/index.ts`, `electron/main/ipc.ts`): remove `usage.setBudgets` and `usage.setWeeklyReset` from the command contract, the preload bridge, and the main `ipcMain.handle("usage:…")` handlers; add `usage.setRange(range)`. `setEnabled` / `setIncludeUntracked` / `onSnapshot` stay.
- **Snapshot** (`services/usage/snapshot.ts`): build `providers[]` from the registry (identity + capabilities + `hasData`); `series[]` from the aggregator's daily counters; `rows[]` as today (generic over the provider key, with the dir-slug match in §4.5); `codexLimits` from `providerLimits.get("codex")`; `cost` via `buildCostSnapshot` over the aggregator's per-`(provider, model)` ledger (§4.8) — not from `rows` / `series`. Delete `buildClaudeGauge` / `buildCodexGauge` (replaced by `driver.buildGauge`).

---

## 7. UI (locked design)

### 7.1 Chipbar — dense daily stacked bar

Replaces the per-provider gauge rows. A compact daily stacked bar (one bar per day, segments by provider brand color), an inline `W·M` toggle (week default; month ≈ 30 daily bars), the period total + notional `$`, and a `▾` to open the popover. Iterates `snapshot.series` and `snapshot.providers` (brand colors from the registry — no renderer-side provider constant, no `usage-prov--claude/codex` hardcodes). Density: ~34px tall; 5px bars (week) / 3px bars (month). Inert / zero-data providers contribute no segments.

### 7.2 Popover — drill-down

Four stacked blocks (anchored panel from the `▾`):

1. **Chart** — the larger weekly/monthly stacked-by-provider chart with its own `Week·Month` toggle, period total + `$`, day labels, legend.
2. **Breakdown** — a grouping toggle `Provider · Workspace · Worktree`:
   - **Provider** (default): flat roll-up — each provider with a share bar, tokens, and `$`, plus a `total` footer.
   - **Workspace / Worktree**: the workspace → worktree·provider tree (today's grouping), tokens + `$`.
3. **Lifetime** (Slice 2) — two cards: `in app` (while the app was open) and `all-time` (on this machine), each tokens + notional `$`.
4. **Codex limits · native** — collapsed to one glanceable line (`▸ Codex limits · native … 5h 41% · wk 23%`) that expands to the 5h + weekly gauges. Rendered **only** when `codexLimits` is present.

**Removed from the popover:** the budget editor, the budget-settings gear, and all weekly-reset controls.

---

## 8. Staging

The design is staged so each slice is independently shippable and reviewable. The full design above is the target; Slice 1 is the immediate implementation.

- **Slice 1 — Generic capture + analytics reframe + new UI + cost.**
  Driver registry (`claude`/`codex`/`ezio` real; `cursor`/`antigravity` inert); generic `processJsonlFile`; new snapshot shape (`providers[]`, `series[]`, `cost`, `codexLimits`); delete the budget proxy; the new chipbar + popover with the Provider/Workspace/Worktree breakdown; notional `$` cost. Lifetime cards are stubbed/hidden.
- **Slice 2 — Lifetime persistence.**
  Persisted ledger: in-app cumulative (app-uptime-gated) + all-time (full-history scan); lifetime cards in the popover. Both if the full scan is cheap/reliable; else in-app only.

Slice 1 touches ~20 files — the implementation plan (writing-plans) must phase it: **(a)** model + driver types, **(b)** the three real drivers + token-math, **(c)** generic scanner + truncation + cwd-slug match, **(d)** aggregator (providerLimits + daily series), **(e)** snapshot + cost, **(f)** worker/host/protocol, **(g)** chipbar + popover, **(h)** delete budget/credentials, **(i)** tests. No single step should exceed a reviewable diff.

---

## 9. Edge cases

- **Inert provider** (cursor/antigravity): `roots()` is empty → no fs access, no watcher; appears in `providers[]` with `hasData:false`; contributes nothing to chart/roll-up.
- **ezio mtime coarseness**: every record in a file is stamped with the file's mtime. A long session file spanning the app-launch boundary attributes its earlier turns to the latest mtime — bounded over-attribution to recent windows. **Documented limitation.**
- **ezio file truncation/rotation** (`unknown-0.record.jsonl` rewritten shorter): detected by size < cached offset → offset resets to 0.
- **ezio slug unmatched** (worktree not in `known`): event → untracked bucket.
- **Same cwd, two providers**: two rows (provider is part of the aggregation key) — already handled.
- **Unpriced model**: the per-`(provider, model)` ledger entry finds no rate → its tokens go to `cost.unpricedTokens` and add `$0` to no total; a provider whose models are all unpriced is absent from `cost.perProvider` and renders `—` (no silent zero, no guessed default rate).
- **Mixed priced/unpriced models on one provider**: only the priced models contribute dollars; the unpriced remainder is surfaced via `cost.unpricedTokens`, so each per-provider `$` is honest about the tokens it actually covers.
- **Codex limits absent** (no recent `rate_limits` line): the limits block is hidden.
- **Sparse chart days**: zero-height bars; the chart still renders the full week/month axis.

---

## 10. Testing

- **Parity**: generic `processJsonlFile` + the claude/codex drivers reproduce the old `processClaudeFile`/`processCodexFile` output on golden fixtures.
- **ezio driver**: `record.jsonl` fixture → correct `ezioTokens` mapping (`input = contextTokens − cachedTokens`, `raw = contextTokens + output`), mtime stamping, dir-slug → cwd resolution.
- **Registry**: `roots(home)` per driver; inert drivers return `[]`.
- **Type-boundary guard**: a static import-graph assertion that `shared/models/usage.ts` and the renderer (`src/**`) never import `services/usage/providers/*` (the node-only driver module), and that `ProviderTelemetryInfo.capabilities` resolves to the shared `ProviderTelemetryCapabilities` DTO. Fails the build if a node-only driver type leaks into shared/renderer.
- **`matchCwd`**: real-path match (claude/codex) + dir-slug match (ezio), incl. the `.worktrees` case.
- **`buildSnapshot`**: 5 drivers (3 with data, 2 inert) → `providers[]` with correct `hasData` and inert capabilities exposed as `timeSource:"none"` / `cwdSource:"none"`; `series[]` daily-by-provider; `codexLimits` only for codex; and — with a provider emitting **≥2 distinct models including one unpriced** — `cost.perProvider` prices only the known models, the unknown model's tokens land in `cost.unpricedTokens`, and `cost.total` excludes them.
- **Truncation reset** in `changed()`.
- **Pricing / cost ledger**: `buildCostSnapshot` over a per-`(provider, model)` ledger with multiple priced models sums `Σ tokens × rate(provider, model)` per provider; an unpriced model contributes `$0`, increments `unpricedTokens`, and leaves a fully-unpriced provider absent from `perProvider` (→ `—`). Also asserts `rateFor` returns `null` (no provider-default fallback) on an unknown `(provider, model)`.
- **E2E**: extend the `AI14ALL_E2E_USAGE_SNAPSHOT` fixture with `providers[]`, `series[]`, `cost`, `codexLimits` → the chipbar renders the dense weekly stacked bar; the popover renders the provider roll-up + collapsed codex limits; inert providers render no segments.

---

## 11. File-by-file (Slice 1)

**New**
- `services/usage/providers/types.ts` — driver interface + node-only parse types (`ParseCtx`, `JsonlLineResult`, `GaugeContext`); capability DTO is **imported** from `shared/models/usage.ts`, not defined here
- `services/usage/providers/{claude,codex,ezio,cursor,antigravity}.ts` — drivers
- `services/usage/providers/index.ts` — registry
- `services/usage/cost/pricing.ts` — strict `(provider,model)` → rate lookup (`null` on miss; no default)
- `services/usage/cost/cost.ts` — `estimateCostUsd` + `buildCostSnapshot` (walks the per-model ledger)
- `src/features/telemetry/UsageChart.tsx` — stacked daily bar (shared by chip + popover)
- `tests/unit/usage/type-boundary.test.ts` — import-graph guard: `shared/**` + `src/**` never import `services/usage/providers/*` (§10)

**Modified**
- `shared/models/usage.ts` — model deltas (§5), incl. the canonical `ProviderTelemetryCapabilities` DTO + `StoreKind`/`TimeSource`/`CwdSource` unions (so no shared/renderer type depends on the node-only driver module)
- `services/usage/aggregator.ts` — `providerLimits` map + per-provider daily series + per-`(provider, model)` cost ledger
- `services/usage/scanner.ts` — generic `processJsonlFile` + truncation detection (keep thin claude/codex wrappers for tests)
- `services/usage/token-math.ts` — add `ezioTokens`
- `services/usage/snapshot.ts` — `providers[]`/`series[]`/`cost`/`codexLimits`; remove proxy gauges
- `services/usage/worktree-map.ts` — dir-slug match in `matchCwd`
- `services/usage/worker-protocol.ts` — config deltas; `setRange` replaces budget/reset messages
- `electron/main/services/usage-host.ts` — pass `home`/`userDataDir`; drop roots/creds
- `electron/main/services/usage-worker.ts` — driver-iterated sweep/watch; drop tier read
- `shared/contracts/commands.ts` — drop `usage.setBudgets`/`setWeeklyReset`; add `usage.setRange`
- `electron/preload/index.ts` — same usage IPC surface change
- `electron/main/ipc.ts` — drop the `usage:setBudgets`/`usage:setWeeklyReset` handlers; add `usage:setRange`
- `src/features/telemetry/UsageStrip.tsx` — A1 dense chip
- `src/features/telemetry/UsagePopover.tsx` — new layout; remove budget editor

**Removed**
- `services/usage/budget.ts` — proxy tier tables
- `services/usage/credentials.ts` — Claude-tier read (only used by the proxy)
- `BudgetEditor` (within `UsagePopover.tsx`)
- `tests/unit/usage/budget.test.ts`, `tests/unit/usage/credentials.test.ts` — cover the deleted modules

**Tests updated (not new)**
- `tests/unit/usage/usage-settings.test.ts` — budget settings gone; assert the range control instead
- `tests/unit/usage/usage-popover.test.tsx` — new popover layout (chart, provider roll-up, collapsed limits)
- `tests/unit/usage/snapshot.test.ts`, `tests/unit/usage/scanner.test.ts` — new snapshot shape + generic `processJsonlFile` parity

---

## 12. Open questions / future

- **antigravity SQLite reader** — a future `storeKind:"sqlite-dir"` driver decoding the protobuf blobs, if its usage becomes worth surfacing.
- **ezio context-fill gauge** — `contextLimit` is captured; a context-window-fill indicator could use it.
- **Per-live-session attribution** — tap the launcher/whisper processes for exact timing instead of scraping disk; would also give ezio real per-turn timestamps.
- **Pricing freshness** — list-price rates drift; consider a single dated rate table with a "last verified" note.
