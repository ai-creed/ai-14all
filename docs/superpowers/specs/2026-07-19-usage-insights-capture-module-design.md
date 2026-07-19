# ai-14all — usage & productivity insights: data-capture module (exploration / feasibility)

- **Date:** 2026-07-19
- **Status:** Exploration — for review. Not an implementation spec. Precedes the instrumentation design.
- **Owner:** Vu
- **Related:** `2026-07-17-hax-native-usage-driver-design.md` (the token-telemetry pipeline this reuses), memory `mem-2026-07-17-ezio-telemetry-blind-spot-whisper-9700c5`

## 1. Goal

Explore a "full-feature dashboard" that shows a user whether ai-14all is improving their productivity over time — workspaces worked in, providers used, session durations, ai-whisper workflow outcomes (success/failed), time spent in the app, and derived productivity trends.

This document is the **first of two**. It answers one question only: *what can we actually know, and from where?* It classifies every desired insight by data availability, measures how much history we can reconstruct from data that already exists on disk, and proposes a **decoupled data-capture module** as the thing we build first. The dashboard UI is explicitly deferred until the capture layer exists and has accumulated data. The instrumentation design (the detailed build spec for that module) is the second document, written after we discuss the open decisions in §8.

**Build order (agreed):** data-capture module first → let it accumulate + backfill → UI later. The module is deliberately decoupled so it does not tangle into the app before the UI justifies the integration.

## 2. Method

Findings below were produced by reading the actual source and **inspecting the real data on this machine** (the developer's own environment) read-only. Every "verified" claim carries a `file:line` reference or a live-data observation. Nothing here is inferred from documentation alone. Where a store was queried (whisper's `state.db`), access was strictly read-only (`?mode=ro`, `PRAGMA`/`SELECT` only) per the project constraint against modifying an external integration's data store.

## 3. The three-tier availability model

The original framing was two buckets ("have it" vs "need to capture it"). Real inspection shows a sharper, more useful **middle tier**: data that *already exists on disk* but the app throws away or never queries. That middle tier is where most of the requested value is, and it is recoverable **retroactively** — no waiting weeks for new instrumentation to accumulate.

| Tier | Definition | Can it show history on day one? |
|---|---|---|
| **T1 — Available now** | Already persisted in the app's durable store and (mostly) already surfaced in the UI | Yes |
| **T2 — Backfillable now** | Data exists in raw on-disk sources (provider logs, whisper's DB) but the app aggregates it away or never reads it. A one-time importer reconstructs it | Yes, bounded by source retention |
| **T3 — Needs new capture** | No source exists anywhere. Must instrument and accumulate forward | No — starts empty, fills over weeks |

### 3.1 Tier 1 — available now

Source: the token-usage ledger `usage-ledger.json` (Electron `userData`), schema v3. It is the **only** durable historical time-series the app keeps today: day-grained buckets keyed by `cwd \0 provider \0 model → TokenTotals{input,output,billable,raw}` (`services/usage/ledger.ts:37-43,112-124`). Live observation: 95 day-buckets spanning **2026-03-31 → 2026-07-18** (~110 days). Surfaced in the header telemetry chip + popover (`src/features/telemetry/`), scopes Session/Week/Month/All-time, provider/workspace/worktree breakdowns, plus codex native rate-limit gauges.

Directly answerable today:
- Token volume (in/out/billable) per day, and its trend.
- Which **providers** were used and their share over time (claude, codex, ezio/hax; Cursor + Antigravity are inert — invisible).
- Per-**workspace / per-worktree** activity, token-weighted (a usable *proxy* for "which workspaces were worked in", not a true open/worked count).
- **Model** mix (in the bucket key; not currently surfaced in the UI).
- Notional cost trend — **estimate only** (blended per-provider median rates, `services/usage/cost/pricing.ts`), never real billed cost.
- Codex rate-limit consumption (5h + weekly windows).

Tier-1 limits baked into the persisted shape: no turn/session **counts**, no **duration**, no sub-day granularity (the hourly series is since-launch-only and never serialized), and session identity is dropped at aggregation.

### 3.2 Tier 2 — backfillable now (the high-value middle)

Everything the ledger discards is **still on disk** in the raw sources, and whisper's full workflow history is **still in its database**. Two independent sub-sources.

#### 3.2a Raw provider logs (token/session/turn detail)

The parsers already extract a rich per-turn `UsageEvent{provider,timestampMs,cwd,sessionId,model,input,output,billable,raw}` (`shared/models/usage.ts:14-24`) but `ingestEvent` immediately collapses it to a day-bucket, **structurally discarding** `sessionId`, per-event timestamp, turn counts, and (for hax) `elapsed_ms` + real cost. A separate importer that re-parses the raw lines and keeps those fields reconstructs:

| Metric | claude | codex | hax/ezio | Limiting factor |
|---|---|---|---|---|
| Per-session wall-clock **duration** | **YES** (max−min per-event ts, grouped by sessionId) | **YES** | **PARTIAL** — start = header `timestamp`, end ≈ file mtime; active time = Σ`elapsed_ms` | hax rows carry no per-turn timestamp (`hax-source.ts:38`, mtime-stamped) |
| Turn / message **counts** | **YES** | **YES** | **YES** | none — raw is per-turn |
| Real **cost** | PARTIAL (needs a rate card) | PARTIAL (needs a rate card) | **YES** — engine-reported `cost_total`/`cost_in`/`cost_out` per turn | only hax logs actual $; parser currently discards it |
| Historical **hourly / sub-day** | **YES** (real ISO per event) | **YES** | **PARTIAL** — session-start hour only | hax mtime-stamping |
| Per-**session** attribution | **YES** | **YES** | **YES** | ledger drops sessionId; raw retains it |
| Active-vs-idle **within** a session | **YES** (inter-turn gaps) | **YES** | **PARTIAL** — active per turn = `elapsed_ms`; idle gaps not locatable | hax lacks per-turn timestamps |
| Per-workspace/worktree attribution **historically** | **YES** (`cwd` per line) | **YES** | **YES** (absolute `cwd` in header) | none |

Real-data confirmation: hax `turn_usage` rows carry `elapsed_ms` and full `cost_*` (354 of a 400-row sample had the complete set); claude and codex lines carry real per-event ISO timestamps and `sessionId`.

#### 3.2b Whisper's `state.db` (workflow run history)

The app is a **live read-only observer** that only ever reads the single latest workflow per collab — `readActiveWorkflow` is `ORDER BY updated_at DESC LIMIT 1` and it drops `created_at` (`services/plugins/whisper/whisper-store-reader.ts:141-191`). But whisper's DB **retains every run**. The "no history" behavior is a query choice, not a schema gap. Live inspection of the real DB (`~/.ai-whisper/state.db`, `user_version = 7`, in the app's supported range `whisper-env-probe.ts:9`):

| Metric | Verdict | Evidence |
|---|---|---|
| Total runs **started** over time | **YES** | `workflows.created_at` NOT NULL, real ISO ms; 10 runs across 8 collabs live |
| Success vs **failed**/canceled/halted | **YES** | `workflows.status` persists terminal values (live: `done=6, canceled=2, running=1, halted=1`); `halt_reason` for detail |
| Per-run **duration** | **YES** | start = `created_at`; end = `max(workflow_phases.ended_at)` (cleaner than `updated_at`); 42/42 terminal phases populated |
| Breakdown by **type** | **YES** | `workflows.workflow_type` (live: `spec-driven-development=9, quick-task=1`) |
| Per-**workspace** attribution | **YES** | `workflows.collab_id → collab.workspace_root`; live join clean, 0 orphans, 6 workspaces incl. worktree paths |
| Day/week **granularity** | **YES** | real ISO timestamps, bucket trivially |

Caveats to resolve (§8): (a) **define which statuses count as "failed"** — `halted` can mean "escalated, awaiting manual completion" (recoverable) rather than a true failure, and `escalated` lives at phase/chain level, not workflow status; (b) prefer `workflow_phases.ended_at` over `updated_at` for a precise end; (c) history depth is bounded by whisper's own retention (only ~2 days on this fresh dev DB) with no independent app-side archive.

### 3.3 Tier 3 — needs new capture (no source exists)

These have **no** on-disk source to reconstruct from. They must be instrumented and will start empty.

- **Time spent using the app** — wall-clock, active-vs-idle, focus-time. Measured nowhere. `launchMs` only anchors token buckets (`electron/main/services/usage-host.ts:17`); window focus/blur are logged as *discrete events* to a shell-event log that is **off in packaged builds** and pruned at 3 days (`services/diagnostics/shell-event-log-service.ts`), never differenced into "minutes focused"; there is **no** `powerMonitor`/system-idle detection anywhere in `electron/`.
- **True workspace lifecycle** — created / opened / closed / last-active. `workspace-state.json` is a current-state snapshot with **zero timestamps** (`shared/models/persisted-workspace-state.ts`); it is not an append log. (Token activity is a proxy, per T1, but not a true "worked in" signal.)
- **Durable agent-session lifecycle** — the transition stream `active → waiting → ready → failed` with timestamps and provider. It exists *ephemerally*: the session-status MCP channel stamps `reportedAt` and forwards to the renderer to drive the sidebar (`services/mcp/ai14all-mcp-server.ts:252-301`) but **does not persist** it; process `status`/`lastActivityAt` live only in renderer memory; the sole timestamped stream is the opt-in, off-by-default, 7-day-TTL diagnostics logger (`services/diagnostics/agent-attention-logger.ts`) — a troubleshooting artifact, not an analytics store.

## 4. Your five questions, mapped

1. **Workspaces worked in during a period** — T1 proxy (token activity per worktree/day) now; **T3** for a true open/worked-in count with real lifecycle timestamps.
2. **Which providers used / how long each active session** — providers: **T1**. Session duration: **T2** (claude/codex exact from raw; hax partial via header-start→mtime + Σ`elapsed_ms`).
3. **Whisper workflows executed, success/failed** — **T2**, fully. Reconstructable retroactively from `state.db`; ongoing capture = keep reading it.
4. **Time spent using the app** — **T3**. No source; must instrument (focus/idle accumulator).
5. **Productivity over time** — derived. Token/cost trend and workflow-throughput trend are **T1/T2** (available soon); the app-engagement dimension is **T3**.

**Headline:** three of the five headline asks (providers, session durations, workflow outcomes) are recoverable *now* from data already on disk. Only genuine app-engagement time (#4) and a true workspace-worked count (#1) require forward instrumentation that must accumulate before it shows anything.

## 5. Backfill depth and the two hard ceilings

Retention reach measured on this machine (today = 2026-07-19):

| Source | Volume | Oldest | Backfill reach |
|---|---|---|---|
| `~/.claude/projects` | 1.5 GB / 5,506 files | 2026-06-12 | **~37 days** |
| `~/.codex/sessions` | 412 MB / 294 files | 2026-04-01 | **~109 days** |
| `~/.local/state/hax/sessions` | 256 MB / 1,139 files | 2026-05-30 | **~50 days** |
| `usage-ledger.json` (aggregated) | 2.9 MB / 95 day-buckets | 2026-03-31 | ~110-day span |
| `~/.ai-whisper/state.db` | 31 MB | ~2 days (fresh dev DB) | whisper's own retention |

Two ceilings shape any backfill:

1. **The hax per-turn timestamp gap.** hax `turn_usage` rows have no per-row timestamp, so the scanner stamps every turn in a file with the file's mtime (`services/usage/providers/ezio.ts:18`, `scanner.ts:162`). For hax you get session-start (header timestamp) and per-turn active compute (`elapsed_ms`), but you **cannot** place turns on a wall-clock timeline or measure inter-turn idle. claude/codex have real per-event timestamps and reconstruct fully. (Per-row hax timestamps are already a tracked upstream ask — see the hax-driver spec §7.)
2. **Claude's ~30-day log rotation.** Claude Code's default `cleanupPeriodDays` deletes sessions older than ~30 days, so claude backfill is capped near 37 days — well short of codex (~109 d) and the ledger (~110 d).

**Complementarity, not replacement.** The aggregated ledger reaches back to March (deep but thin: day/provider/model tokens only); the raw logs reach back weeks (shallow but rich: sessions, turns, cost, timing). A rebuild *purely* from raw would **lose** the pre-06-12 claude history that only survives in the ledger. The module should therefore treat the ledger as the authoritative deep-history token source and the raw importers as the enrichment source for the recent window — not overwrite one with the other.

## 6. Proposed architecture — a decoupled capture module

Direction only; the detailed build spec is the follow-up document.

### 6.1 Boundary and rationale

A standalone **insights capture module** that owns its own durable store, ingests from the raw sources + whisper's DB + (later) live app events, and exposes a **read-only query API** that a future dashboard consumes. It writes to *its own* store, never mutating the app's ledger, `workspace-state.json`, or whisper's DB. This is the decoupling the build-order calls for: the app depends on the module through one narrow query interface, and the module can be built, tested, and backfilled entirely before any UI exists.

**Process boundary (recommended): a sibling worker/service**, following the precedent already in the codebase — token telemetry runs in a spawned worker (`electron/main/services/usage-host.ts` + `services/usage/usage-worker.ts`). An "insights worker" owns its SQLite store, runs the backfill importers off the main thread, and subscribes to app lifecycle events over IPC. Alternative (in-main service) is simpler to wire but tangles more into the app — rejected against the stated goal.

### 6.2 Store (recommended: SQLite)

| Option | Verdict | Trade-off |
|---|---|---|
| Extend the JSON ledger | **No** | Cannot hold session/turn/workflow/lifecycle grain; a flat day-bucket map does not scale to per-session or per-event records |
| **New SQLite store, module-owned** | **Recommended** | `better-sqlite3` is already bundled (used to read whisper's DB; code-nav also uses per-worktree SQLite). Time-range queries, joins, counts, and durations are exactly what SQL is for |
| Append-only JSONL + in-memory index | No | Simple to write, painful to query time-ranges/joins; rebuild cost grows with history |

**Build note (native module):** `better-sqlite3` compiles a single native binary bound to one ABI, so it must be rebuilt for the target runtime — Electron ABI for the app, host-Node ABI for vitest (`scripts/rebuild-better-sqlite3-host.mjs`). The module's test story must account for this rebuild dance; a mismatch throws `NODE_MODULE_VERSION`. See memory `mem-2026-06-03`.

Rough record shape (to detail in the build spec): a `sessions` table (provider, cwd/worktree, start, end, active-ms, turns, tokens, cost, cost_is_estimated), a `workflow_runs` table (type, status, started_at, ended_at, workspace, phase outcomes), and — for T3 — `app_activity` (focus/idle intervals) and `workspace_lifecycle` (open/close/last-active) tables.

### 6.3 Three ingestion paths

1. **Backfill importers (T2, one-time + incremental).** Re-parse the raw provider logs keeping the fields the ledger drops (reuse `claude-source`/`codex-source`/`hax-source` parsers; stop discarding hax `elapsed_ms`/`cost_*`). Read whisper's `state.db` with a *full-history* query (drop the `LIMIT 1`, keep `created_at`, join phases + collab). Idempotent, re-runnable, offset-cached like the existing scanner.
2. **Whisper live reader (T2, ongoing).** The same full-history query on the existing 3s poll / event-socket trigger keeps the `workflow_runs` table current as new runs complete.
3. **Live collectors (T3, forward-only).** An app focus/idle accumulator (window focus/blur + `powerMonitor` idle), workspace open/close events, and a durable tap on the existing session-status MCP channel + attention bridge to persist agent-session state transitions.

### 6.4 Query API (for the future UI)

One read-only surface — e.g. "series(metric, scope, range, groupBy)" and "totals(scope, range)" — returning shapes the existing chart primitives can render. No UI is built now; this just fixes the contract so the module is complete and testable on its own.

### 6.5 Reuse

The existing CSS-only chart primitives (`UsageChart`, `Gauge`), formatters (`format.ts`), rolling-window helpers (`rollup.ts`/`ledger.ts`), and the snapshot→IPC→`useUsageSnapshot` plumbing all carry over to the eventual UI — no charting dependency is needed. The raw parsers carry over to the importers.

## 7. Instrumentation needed for Tier 3 (to discuss)

The forward-only capture the module must add (detail + options belong in the build spec):
- **App engagement:** focus/blur interval accounting + OS idle detection (`powerMonitor.getSystemIdleTime`), accumulated per day; define the idle threshold.
- **Workspace lifecycle:** add created/opened/closed/last-active timestamps and an open/close event trail (today `workspace-state.json` has none).
- **Agent-session lifecycle:** persist the session-status transition stream (state, provider, reportedAt) that today only drives the sidebar transiently.

## 8. Open decisions to resolve before the build spec

1. **Store + process boundary** — confirm SQLite in a sibling insights worker (§6.1–6.2).
2. **"Failed" definition for workflows** — which of `halted`/`canceled`/`escalated` count as failure vs recoverable/manual-complete (§3.2b).
3. **Backfill vs ledger authority** — confirm the complementarity rule (ledger = deep token history; raw = recent rich enrichment; never overwrite) (§5).
4. **Backfill scope for v1** — ship importers in v1, or land live capture first and backfill later?
5. **Privacy / retention** — the module reads `cwd`s, spec paths, and session content locations. Confirm it stays local-only, honors the existing telemetry opt-out, and set its own retention policy.
6. **hax timestamp ceiling** — accept session-grain for hax now, or block on the upstream per-row-timestamp ask (recommend: accept now).

## 9. Phasing recommendation

- **Phase 0 (this doc):** feasibility + architecture direction. ← you are here.
- **Phase 1:** the module skeleton — SQLite store + query API + whisper full-history reader + raw-log importers (all T2). Ships *real historical value* immediately (providers, session durations, workflow outcomes) with no waiting.
- **Phase 2:** T3 live collectors (app engagement, workspace + session lifecycle). Starts accumulating forward.
- **Phase 3:** the dashboard UI on top of the query API, reusing the existing chart primitives.

Phase 1 alone answers three of the five headline questions from data that already exists.

## 10. Out of scope (for this doc)

- The dashboard UI (Phase 3) — layout, widgets, interactions.
- Detailed table schemas, migration plans, and test plans (the build spec).
- Real per-provider **billed** cost for claude/codex (needs an external rate card; hax already reports actual cost).
- Cursor / Antigravity token capture (both providers are inert today).
- Cross-machine / cloud aggregation — local-only for now.

## 11. Risks

- **Source retention caps history.** claude ~37 d, whisper DB as small as its own pruning allows. Backfill is a one-shot opportunity that shrinks daily — the sooner importers exist, the more history is captured before rotation deletes it.
- **Upstream format drift.** Raw log and `state.db` schemas are owned by claude/codex/hax/whisper; a rename silently breaks an importer. Mitigation: defensive parsers (existing pattern) + a schema-version gate (whisper already gated to v6–7).
- **hax mtime stamping** distorts intra-day placement for cold backfill of multi-day hax files (existing, accepted limitation).
- **Double-count seam** where a run is present in both the ledger and a raw import — must dedupe on the complementarity rule (§5), not blind-merge.
- **whisper DB availability** — everything T2/whisper hinges on the DB being present, schema in range, and collabs not pruned; capture nothing silently when absent (visible, not corrupt).

## 12. Appendix — evidence index

- Ledger shape & discards: `services/usage/ledger.ts:37-43,62-67,112-124`; `ledger-store.ts:55-63`; live `usage-ledger.json` v3, 95 buckets 2026-03-31→07-18.
- Raw parsers & discarded fields: `services/usage/providers/{claude,codex,ezio}.ts`, `{claude,codex,hax}-source.ts`, `token-math.ts`, `shared/models/usage.ts:14-24`.
- hax rows carry `elapsed_ms`+`cost_*`, no per-turn timestamp: `hax-source.ts:38-48`; `ezio.ts:18`; `scanner.ts:162`; hax-driver spec §2.
- Retention reaches (measured): claude 2026-06-12, codex 2026-04-01, hax 2026-05-30.
- Whisper read-contract & LIMIT 1: `whisper-store-reader.ts:141-191` (SELECT 147-149); env gate `whisper-env-probe.ts:9`; snapshot `shared/models/ecosystem-plugin.ts:70-88`.
- Whisper real DB: `user_version=7`; `workflows` 10 rows/8 collabs; `status` done=6/canceled=2/running=1/halted=1; `workflow_phases` 43 rows, `started_at`/`ended_at`/`outcome` populated; `collab.workspace_root` join 0 orphans.
- T3 absence: `electron/main/services/usage-host.ts:17` (launchMs); `services/diagnostics/shell-event-log-service.ts` (off in prod, 3-day TTL); `services/diagnostics/agent-attention-logger.ts` (opt-in, 7-day); no `powerMonitor` in `electron/`; `shared/models/persisted-workspace-state.ts` (no timestamps); `services/mcp/ai14all-mcp-server.ts:252-301` (reportedAt not persisted).
- Existing UI + reusable primitives: `src/features/telemetry/{UsageStrip,UsagePopover,UsageChart,Gauge,format,rollup}.tsx/.ts`; `src/app/components/MainColumnChrome.tsx:147`.
