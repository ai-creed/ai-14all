# ai-14all — insights capture: instrumentation-foundation build spec (Phase 1, walking skeleton)

- **Date:** 2026-07-19
- **Status:** Build spec — approved in brainstorming; revised after SDD reviewer round 1 (view correctness, coverage-key idempotency, host-side delete-all, notice delivery/verification contract, range semantics, retention scope). Ready for an implementation plan.
- **Owner:** Vu
- **Precedes:** the implementation plan (writing-plans) for this slice.
- **Builds on:** `2026-07-19-usage-insights-capture-module-design.md` (the feasibility/architecture exploration — three-tier availability model, observation-store principle, coverage rule, phasing). This spec is the concrete Phase-1 design that exploration deferred.
- **Related:** `2026-07-17-hax-native-usage-driver-design.md` (the token-telemetry worker pattern this mirrors).

## 1. What this slice is

The first build slice of the decoupled insights-capture module: the **instrumentation foundation**, built as a **walking skeleton**. It delivers the durable substrate — a module-owned SQLite observation store, a sibling worker, the provenance/attribution schema, the privacy/consent contract, and idempotent writes — **and** threads exactly one real producer all the way through it (the whisper workflow-history archiver) so the spine is proven end-to-end and the schema is validated against real data before the remaining collectors commit to it.

Nothing is designed purely in the abstract: every mechanism this slice builds is exercised by the whisper tracer, except the parts explicitly scoped to a later phase (§9, §16).

**In scope:** module boundary + worker; the `observations` store, migrations, indexes, per-kind payload validation, and the first derived view; provenance + precision model; attribution columns (carried, not yet correlated); the consent/privacy contract (settings extension, master kill, one-time notice with its renderer/Settings controls, disable, delete-all, single-horizon retention, path handling); idempotent-write delivery; the whisper archiver end-to-end with one typed read; the test story including the better-sqlite3 ABI rebuild.

**Out of scope (later phases):** provider-log backfill and app-managed/external attribution correlation (Phase 3); focus/idle, workspace, terminal, and agent-session live collectors and the acknowledge/retry live-delivery wiring (Phase 2); coverage-map query logic beyond a stub table (Phase 3); any dashboard UI (Phase 5).

## 2. Decisions locked (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Walking skeleton**, not pure foundation | Validate the schema against a real producer before other collectors depend on it. |
| D2 | **Whisper archiver** is the single tracer | Richest test of the atomic-observations-derive-everything principle (one run fans out into related observation kinds); a real producer to validate the schema; read-only against a durable store. (An earlier draft also justified this by "whisper prunes to ~2 days" — **struck as false** after source verification against `~/Dev/ai-whisper`; whisper never time-prunes `workflows`/`workflow_phases`. See §8.1 for the corrected retention facts and their cost consequence.) |
| D3 | **Spine + validated payload** event model | One physical `observations` table: shared columns carry the cross-cutting concerns the contracts mandate on every event (idempotency, provenance, attribution, precision); a per-kind JSON `payload` is schema-validated at write; hot dimensions are promoted to indexed columns. Adding a kind = register a payload schema, no migration. |
| D4 | **Consent: default-on + one-time notice** | `usageTelemetry.insights.enabled` default `true`, gated under `usageTelemetry.enabled` as a master kill; a one-time transparent notice on first capture; granular disable + delete-all. Captures the time-critical signals immediately on existing installs while staying informed and controllable. |
| D5 | **Separate insights worker** (deviation from exploration §6.1) | A dedicated `utilityProcess`, not a fold into the existing usage worker. The usage worker is scoped to the token ledger; insights is a broader, separately-consented, separately-deletable store. A separate worker is the decoupling the plan asks for. Cost: one extra utility process. |
| D6 | **Delivery contract split** (deviation from exploration §8.2) | The whisper tracer polls a durable source and upserts idempotently — it never rides lossy live IPC. So Phase 1 builds and exercises the **idempotency half** (deterministic event IDs, insert-on-conflict, safe replays); the **acknowledge/retry outbox half** (for ephemeral live events) is designed as an interface here but fully wired and validated with its first live consumer (focus/idle) in Phase 2. Keeps the walking skeleton honest. |
| D7 | **Insights worker owns its own read-only whisper reader + poll** | Not a tap on the main-process whisper driver (`whisper-driver.ts`). Keeps the tracer fully decoupled; durability comes from re-reading the durable DB, so no cross-process delivery guarantee is needed for whisper. |

## 3. Module architecture

### 3.1 Process boundary

A new module rooted at `services/insights/` (worker-side logic, portable/testable on host Node) plus an Electron host at `electron/main/services/insights-host.ts`, mirroring the existing `UsageHost` / `usage-worker` split.

- **`InsightsHost`** (main process) spawns the worker via `utilityProcess.fork(insightsWorkerPath, [], { serviceName: "ai14all-insights" })`, exactly as `usage-host.ts:75` does. It:
  - resolves configuration in the main process (userData dir, whisper `state.db` path via the existing env probe, poll interval, effective consent) and seeds it on the worker's `spawn` event, queuing any pre-spawn messages (the `utilityProcess` drops-before-spawn hazard is already handled this way in `usage-host.ts:84-92`);
  - gates on consent: `setEnabled(effective)` → `start()`/`stop()`; when disabled there is no worker, no reader, no store handle open — **zero cost when off** (mirrors `usage-host.ts:54,102-105`);
  - relays the worker's typed messages to the renderer over the existing `send(channel, payload)` seam (for the future UI; this slice only needs a status/heartbeat channel and the read-contract response).
- **`insights-worker.ts`** (built to `electron/main/services/insights-worker.js`, loaded by the host the same way `usage-host.ts:72-74` loads `./usage-worker.js`) owns the SQLite store, the whisper reader, and the poll loop. It never touches the app's ledger, `workspace-state.json`, or whisper's DB except read-only.

### 3.2 IPC protocol

A dedicated `services/insights/worker-protocol.ts` with `MainToInsightsWorker` and `InsightsWorkerToMain` unions, following `services/usage/worker-protocol.ts`. Phase-1 messages:

- Main → worker: `{ kind: "config", config }`, `{ kind: "setEnabled", enabled }`, `{ kind: "closeStore", requestId }` (release the DB handle so the host can delete the store — delete-all itself is **host-owned**, §7.4), `{ kind: "query", requestId, query }` (the read contract), `{ kind: "flush" }` (force a poll now, e.g. before shutdown).
- Worker → main: `{ kind: "status", status }` (heartbeat: last poll time, store row counts, whisper availability, and `firstCaptureAt` read from `meta` — this is what lets the host re-attempt notice delivery on **every** start, §7.3), `{ kind: "queryResult", requestId, result }`, `{ kind: "storeClosed", requestId }` (DB handle released; the host may now delete the directory), `{ kind: "firstCapture" }` (the live first-capture signal, §7.3), `{ kind: "error", scope, message }`.

The acknowledge/retry envelope for live producer events (stable event ID + `ack`/`nack` + retry buffer) is **declared in this protocol as an interface** but has no Phase-1 producer; it is wired in Phase 2. See §9.

## 4. The store

### 4.1 Location, engine, ABI

`better-sqlite3` (already bundled; used to read whisper's DB and by code-nav). The store lives at `<userData>/insights/insights.db` (WAL mode). The directory and file are created by the worker on first enabled start; **delete-all removes the whole `insights/` directory** (§7.4).

**Native-module ABI:** `better-sqlite3` compiles one binary bound to a single ABI, so it must be rebuilt for the target runtime — Electron ABI for the app, host-Node ABI for vitest (`scripts/rebuild-better-sqlite3-host.mjs`); a mismatch throws `NODE_MODULE_VERSION`. All worker-side store logic lives under `services/insights/` so it runs on the host-Node ABI under vitest without Electron. See memory `mem-2026-06-03`.

### 4.2 Schema — the `observations` spine

```sql
CREATE TABLE observations (
  event_id        TEXT PRIMARY KEY,     -- deterministic content hash → idempotency
  kind            TEXT NOT NULL,        -- e.g. 'whisper.workflow', 'whisper.phase'
  source          TEXT NOT NULL,        -- e.g. 'whisper-archiver'
  subject_id      TEXT,                 -- the entity: workflow_id (workflow) | phase_run_id (phase)
  event_ts        INTEGER,              -- ms epoch; the source event time
  ts_precision    TEXT NOT NULL,        -- 'exact' | 'mtime' | 'session-start' | 'derived'
  occurred_start  INTEGER,              -- interval kinds only, else NULL
  occurred_end    INTEGER,              -- interval kinds only, else NULL
  -- provenance
  parser_version  INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL,     -- source schema version (e.g. whisper user_version)
  ingested_at     INTEGER NOT NULL,     -- when the worker wrote the row
  -- attribution (populated for provider-usage kinds; 'n/a' for others in this slice)
  origin          TEXT NOT NULL DEFAULT 'n/a',  -- 'app-managed'|'external'|'unknown'|'n/a'
  attribution_confidence REAL,
  attribution_method     TEXT,
  app_run_id           TEXT,
  terminal_session_id  TEXT,
  provider_session_id  TEXT,
  provider             TEXT,
  repo_id         TEXT,                 -- stable hash of the absolute repo root
  workspace_rel   TEXT,                 -- repo-relative path
  branch          TEXT,
  payload         TEXT NOT NULL         -- per-kind JSON, validated at write
);
CREATE INDEX idx_obs_kind_ts    ON observations (kind, event_ts);
CREATE INDEX idx_obs_subject    ON observations (subject_id);
CREATE INDEX idx_obs_source_ts  ON observations (source, event_ts);
```

Design notes:
- **No stored "duration."** The labeled measures (`observed_usage_span_ms`, `provider_compute_ms`, …) are derived on read from `occurred_start`/`occurred_end`/payload, never persisted as one ambiguous field (exploration §3.2a).
- **No content, ever.** No prompts, responses, terminal output, or file contents. `payload` holds only content-free structured facts (statuses, counts, ids, timestamps).
- **Promoted vs payload.** Columns are the fields we query/join/index across kinds; kind-specific detail lives in `payload`. A registered `.strict()` zod schema per `kind` validates `payload` at write time in the worker; an unregistered kind or an invalid payload is a hard write error (never a silent junk row).
- **Path privacy is enforced, not assumed.** Workspace attribution is stored as an opaque `repo_id` + repo-relative `workspace_rel` + basename `workspace_label` via the §7.6 resolver, and a write-time guard rejects any absolute-filesystem-path string in any column or `payload` leaf. See §7.6.

### 4.3 Coverage and meta tables

```sql
CREATE TABLE coverage (
  source    TEXT NOT NULL,
  provider  TEXT NOT NULL DEFAULT 'n/a',  -- sentinel, never NULL (see note)
  day       TEXT NOT NULL,                -- 'YYYY-MM-DD' (UTC)
  complete  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, provider, day)
);
```

**`provider` is `NOT NULL` with an `'n/a'` sentinel — this is load-bearing, not cosmetic.** SQLite permits NULLs in the columns of an ordinary rowid table's composite `PRIMARY KEY` (a long-standing deviation from the SQL standard), so a nullable `provider` would let two `(whisper-archiver, NULL, 2026-07-19)` rows coexist and there would be no single authoritative completeness marker per source/day — breaking the §10.2–10.4 completeness guarantee. The whisper archiver (which has no provider dimension) writes `provider='n/a'`, and completeness is written with an explicit upsert: `INSERT INTO coverage(source,provider,day,complete) VALUES (...) ON CONFLICT(source,provider,day) DO UPDATE SET complete=excluded.complete`, keyed on all three columns so it is idempotent.

Defined now so provenance and the read contract can reference completeness, but its population and the detailed-if-complete-else-legacy query rule (exploration §5) are Phase 3. In this slice, the whisper archiver marks per-day completeness for its own `source` so `getWhisperRuns` can return a real completeness marker.

The v1 schema also includes a small durable key/value table for module state that is not an observation:

```sql
CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
```

In this slice `meta` holds `first_capture_at` — the durable "capture has occurred" marker that drives at-least-once notice delivery (§7.3). It is part of **v1** (§4.4), so the migration creates it and a migration-plus-restart test verifies it exists.

### 4.4 Migrations

Schema version tracked in `PRAGMA user_version`. A `migrate(db)` routine applies ordered steps from the DB's current `user_version` to the module's target, each step in a transaction. Version 1 is the schema in §4.2–4.3 — the `observations`, `coverage`, **and `meta`** tables; a migration-plus-restart test asserts all three exist at v1. The routine is idempotent (running against an already-current DB is a no-op) and is the only path that creates or alters tables.

### 4.5 Derived view — `whisper_runs`

Sessions, durations, and rollups are **queries/views over `observations`**, never a primary table (exploration §6.2.1). This slice ships one:

Because the store **appends a new observation on every change** (§8), a run and each of its phases have *many* rows. The view must therefore collapse to the **current revision** of each entity before it derives anything — otherwise stale snapshots leak in and phases are counted more than once. Two rules make the derivation deterministic and correct:

1. **Current-revision ordering.** The current row for any `subject_id` is the one with the greatest `event_ts`, tie-broken by `ingested_at` then `event_id` (a deterministic total order — required because two snapshots can share the same source `updated_at`). Applied per workflow *and* per phase.
2. **Phases keyed by their own `subject_id` = whisper `phase_run_id`.** A phase's identity is its whisper `phase_run_id` — the `workflow_phases` primary key — **not** `<workflow_id>:<phase_name>`. `phase_name` carries no uniqueness constraint (verified: `workflow_phases` has `phase_run_id TEXT PRIMARY KEY`, `phase_name TEXT NOT NULL` with no unique index), so keying on the name would collapse two same-named phase runs into one and undercount. The `run_id` (workflow id) is carried in the phase payload for grouping. `phase_count` counts **current phase snapshots only** (one per `phase_run_id`), so a phase that moved running→ended is counted once, not twice, and two distinct phases sharing a name count as two.

**Run duration comes from the workflow's own terminal timestamp** (`occurred_end`, set to `max(phase.ended_at)` at the moment the run goes terminal — §10.3), never from re-maxing phase rows in the view. While a run is still running, `occurred_end` (and thus `duration_ms`) is `NULL`.

```sql
CREATE VIEW whisper_runs AS
WITH wf AS (
  SELECT o.*,
         ROW_NUMBER() OVER (PARTITION BY o.subject_id
           ORDER BY o.event_ts DESC, o.ingested_at DESC, o.event_id DESC) AS rev
  FROM observations o WHERE o.kind = 'whisper.workflow'
),
ph AS (
  SELECT o.*, json_extract(o.payload,'$.run_id') AS run_id,
         ROW_NUMBER() OVER (PARTITION BY o.subject_id
           ORDER BY o.event_ts DESC, o.ingested_at DESC, o.event_id DESC) AS rev
  FROM observations o WHERE o.kind = 'whisper.phase'
),
ph_current AS (
  SELECT run_id, COUNT(*) AS phase_count
  FROM ph WHERE rev = 1
  GROUP BY run_id
)
SELECT
  wf.subject_id                              AS run_id,
  json_extract(wf.payload,'$.collab_id')     AS collab_id,
  wf.repo_id, wf.workspace_rel,
  json_extract(wf.payload,'$.workflow_type') AS workflow_type,
  json_extract(wf.payload,'$.status')        AS status,
  json_extract(wf.payload,'$.halt_reason')   AS halt_reason,
  wf.occurred_start                          AS started_at,
  wf.occurred_end                            AS ended_at,      -- run terminal ts; NULL while running
  (wf.occurred_end - wf.occurred_start)      AS duration_ms,   -- NULL while running
  COALESCE(ph_current.phase_count, 0)        AS phase_count
FROM wf
LEFT JOIN ph_current ON ph_current.run_id = wf.subject_id
WHERE wf.rev = 1;
```

(The exact SQL is illustrative; the *contract* is the two derivation rules above plus the terminal-timestamp duration — an implementation may substitute a correlated subquery for the window functions, but must preserve deterministic current-revision selection, once-per-phase counting, and workflow-terminal duration.)

## 5. Provenance & precision

Every row carries `source`, `event_ts` + `ts_precision`, `parser_version`, `schema_version` (the source's own schema version), and `ingested_at`. `ts_precision` is mandatory and honest: `'exact'` for whisper's real ISO timestamps, `'mtime'`/`'session-start'` reserved for the provider-log importers (Phase 3). This is the substrate the coverage rule and attribution depend on, and it is what lets a later reader know how much to trust a timestamp.

## 6. Attribution

The attribution columns (`origin`, `attribution_confidence`, `attribution_method`, `app_run_id`, `terminal_session_id`, `provider_session_id`, `provider`, `repo_id`, `workspace_rel`, `branch`) exist from version 1 so no later migration is needed. In this slice:

- Whisper observation kinds set `origin='n/a'` — a whisper workflow run is not a provider AI session, so the app-managed/external distinction does not apply to it. `repo_id`/`workspace_rel` are still populated from the collab's `workspace_root`.
- The correlation that populates `app-managed | external | unknown` for provider-usage kinds (via `register_agent_session`'s `resumeCommand` → provider-native `session_id`, exploration §6.3) is **Phase 3**, landing with the provider-log importers that first produce those kinds.

## 7. Consent & privacy contract

### 7.1 Settings

Extend `UsageTelemetrySettingsSchema` (`shared/models/persisted-workspace-state.ts:87`) with a nested `insights` object:

```ts
const InsightsSettingsSchema = z.object({
  enabled:     z.boolean().default(true),
  noticeShown: z.boolean().default(false),
});
// within UsageTelemetrySettingsSchema:
insights: InsightsSettingsSchema.default({ enabled: true, noticeShown: false }),
```

Existing persisted snapshots without `insights` round-trip: the zod default fills it at read. **Implementation note:** the nested-patch handling in `settings-service.ts:113-129` (and the `UsageTelemetryPatchSchema` mirror in `persisted-settings.ts:68`) currently deep-merges one level for `usageTelemetry`; adding a deeper `insights` nest requires the patch path to deep-merge `insights` too, so a `{ insights: { enabled: false } }` patch does not reset `noticeShown`. This is the same class of bug the existing code comments already warn about — extend the same guard.

### 7.2 Effective consent (master kill)

```
effectiveInsightsEnabled = usageTelemetry.enabled && usageTelemetry.insights.enabled
```

`InsightsHost.setEnabled(effectiveInsightsEnabled)` is called on startup and on every settings write. Turning off `usageTelemetry.enabled` (the existing global telemetry opt-out) force-stops the insights worker regardless of the `insights` sub-toggle.

### 7.3 One-time notice

The notice is informational, not a second consent gate (consent already defaulted on per D4), but it is **new user-visible behavior**, so it needs a defined delivery path, actionable controls, and e2e coverage (AGENTS.md:159 — user-visible behavior is not done until the e2e suite covers it). The full contract:

- **Durable capture marker (not an emit-once guard).** On its **first successful capture**, the worker records `meta.first_capture_at` in the *same transaction* as the first observations, and emits `{ kind: "firstCapture" }`. This records that *capture has occurred* — deliberately **not** a "notice already emitted" flag. A one-way emitted-guard gives at-most-once *emission*, not guaranteed *delivery*: if the worker exits or the `utilityProcess` message is lost between the commit and delivery, such a guard would suppress the notice forever and the user would see nothing.
- **At-least-once delivery, terminated by an ack.** The host delivers the notice when it learns capture has occurred **and** `usageTelemetry.insights.noticeShown === false`. It learns this two ways: the live `firstCapture` message, **and** the periodic `status`, which carries `firstCaptureAt` from `meta` — so **every worker start re-checks** and re-delivers if the notice was never acknowledged. The host forwards `insights:notice` to the renderer; the renderer shows the transparent notice ("ai-14all now records local, content-free usage insights — manage or delete these in Settings") and **acknowledges** via `insights:noticeAck`; only on that ack does the host persist `noticeShown = true`. Because `first_capture_at` stays set and `noticeShown` stays false through any crash or lost message between commit and delivery, the next start delivers — guaranteed delivery, deduplicated by the ack. (This is the §9 outbox idea in miniature: a durable source-of-truth plus a host-persisted terminal ack. After a delete-all the store's `first_capture_at` is gone, but `noticeShown` lives in settings and survives, so a user who already saw the notice is not shown it again.)
- **Controls (the actionable part).** The preload exposes `insights.setEnabled(enabled)` and `insights.deleteAll()`, backed by main-process IPC handlers `insights:setEnabled` and `insights:deleteAll` (§7.4). The Settings dialog (`SettingsDialog.tsx`, within the existing Usage/telemetry section) gains the **insights enable toggle** and a **"Delete insights data"** action; the notice's links deep-link there.
- **Verification.** Unit tests cover: the durable `first_capture_at` marker; that a **crash / lost message injected between the `meta` commit and delivery** still yields delivery on the next worker start (driven by `firstCaptureAt` in `status`); and that `noticeShown` persists **only** after a renderer `insights:noticeAck`, so re-delivery stops exactly once. An **e2e test** covers the user-visible flow — first capture surfaces the notice, post-ack it never reappears, the toggle stops capture, and delete-all clears the store — extending (not replacing) the existing e2e suite (AGENTS.md:159–160).

### 7.4 Disable and delete-all

- **Disable:** setting `insights.enabled = false` (or the global opt-out) stops the worker. Existing data is retained unless deleted.
- **Delete-all is host-owned, so it works whether or not the worker is running.** This is required, not incidental: §3.1 means a *disabled* module has **no worker**, yet a user who disables insights and *then* deletes retained data must still succeed (privacy contract; §14.4). Routing deletion through the worker would make it unreachable in exactly that case. So the `insights:deleteAll` IPC is handled in the main process by `InsightsHost`: (a) if the worker is running, send `{ kind: "closeStore" }` and await `storeClosed` to release the DB handle (needed so the file is deletable on Windows), then stop the worker; (b) if the worker is already stopped, skip straight ahead; (c) the host removes the `<userData>/insights/` directory (DB + WAL/SHM) via `fs`. Idempotent; safe when the store does not exist and safe to call while disabled. A later re-enable recreates the store from schema v1.

### 7.5 Retention

**Phase 1 has a single retention horizon, not separate detailed-vs-derived knobs.** The store holds exactly one grain of durable *observational* data in this slice — raw `observations` (the `meta` table is module state, not history, and is not pruned). `whisper_runs` is a *view*: it owns no bytes and therefore cannot have an independent horizon, so a separate "derived-history retention knob" would be meaningless here (the contradiction the reviewer flagged). Concretely: one module constant `OBSERVATION_RETENTION_DAYS` (default generous — e.g. 365 — since the data is local-only and content-free), with the cutoff aligned to a **UTC day boundary**, enforced on worker start and on a daily timer by pruning **both grains in lockstep**: `DELETE FROM observations WHERE event_ts < cutoff` **and** `DELETE FROM coverage WHERE day < cutoffDay`. Pruning `coverage` on the same horizon is mandatory for truthful completeness (§10.4): otherwise a retained coverage row could keep certifying `complete` for a day whose observations are gone. Derived views follow their surviving observations by construction. The exploration's "separate retention rules for detailed vs aggregated records" (exploration §8.1) applies in **Phase 3**, when persisted aggregate records first exist and actually have bytes to retain independently (recorded in §16). The constant, the pruning schedule, and the prune tests are specified in §13; the value is tunable without a schema change.

### 7.6 Path handling

Path and identity handling is a **privacy invariant with an enforced write guard**, not a convention. Three parts, each test-pinned (§13):

**1. Workspace identity resolver.** `collab.workspace_root` is an absolute path and must never be stored raw. A resolver `resolveWorkspaceIdentity(workspaceRoot)` (`services/insights/store/path-identity.ts`, **filesystem-only** so it is host-Node-testable and needs no `git` binary) maps it to content-free identity:
- Discover the enclosing repo by walking up for a `.git` entry. If `.git` is a **file** (a linked worktree), read its `gitdir:` pointer and follow it to the **common** git dir; the canonical repo root is that common dir's parent. If `.git` is a **directory**, the canonical repo root is the directory containing it. The **worktree root** is the directory holding the `.git` entry.
- `repo_id` = a stable hash (SHA-256 → first 16 hex) of the canonical repo root's realpath. Opaque and group-able; the path itself is never stored.
- `workspace_rel` = the worktree root relative to the canonical repo root when it is inside it (`""` for the main tree, e.g. `.worktrees/dashboard-design` for a nested worktree). If the worktree is **outside** the repo root (a linked worktree elsewhere on disk), store only its **basename** — never a `..`-escaping or absolute path.
- `branch` = the worktree's current branch (from `.git/HEAD`), the worktree snapshot the productivity thesis needs (exploration §6.3).
- **Fallback:** if `workspace_root` is in no git repo, `repo_id` = hash of its realpath and `workspace_rel` = its basename — still no absolute path in any column.

**2. Payload allowlist.** Each per-kind zod payload schema is `.strict()` — an **allowlist** that rejects unknown keys at write — so whisper fields are copied by explicit enumeration, never by spreading a row. `spec_path`, `name`, `workflow_context`, `role_bindings`, and any handoff/request/handback text are **excluded**: `spec_path` is a filesystem path and the rest can carry free-text content. Only content-free metadata is allowed: `workflow_type`, `status`, `halt_reason`, `collab_id`, `workflow_id`, `phase_run_id`, `phase_name`, `phase_index`, `outcome`, `chain_id`, and the basename-only `workspace_label`.

**3. Absolute-path write guard.** The store's insert path runs a final assertion over **every** string value — promoted columns and every leaf of `payload` — that **rejects any absolute-filesystem-path shape** (matching `^(/|~|[A-Za-z]:[\\/])` or a UNC `\\` prefix) as a hard write error. This turns "no absolute path in any row" (§14.6) into an enforced, regression-tested invariant rather than a spot-check. No prompt/response/terminal/file **content** is ever stored; whisper's `workflow_type` and phase names are metadata, not content, and are permitted.

Hashing/redaction of the basename `workspace_label` is deferred until export or cross-machine sync exists (both out of scope — exploration §10); until then the label is local-only and basename-only.

## 8. Delivery — idempotent writes (the half this slice exercises)

Whisper archiving is inherently at-least-once against a durable source: the worker re-reads whisper's DB every poll and writes idempotently, so a missed or crashed poll self-heals on the next tick.

- **Deterministic `event_id`** = a stable hash of the observed content snapshot (for `whisper.workflow`: `workflow_id` + `status` + `halt_reason` + terminal timestamps + phase-outcome set; for `whisper.phase`: `phase_run_id` + `outcome` + `started_at`/`ended_at` — keyed on the unique `phase_run_id`, never `phase_name`). Re-observing an **unchanged** run yields the same `event_id` → the insert is a no-op. Observing a **changed** run yields a new `event_id` → a new observation row is appended. The store thus accumulates the distinct observed states over time — a true observation log, no collapse, no duplicates.
- **Write:** `INSERT INTO observations (...) VALUES (...) ON CONFLICT(event_id) DO NOTHING`. Idempotency is structural (the PK), so replays are always safe.
- The derived `whisper_runs` view collapses to the **current revision** per `subject_id` using a deterministic total order (latest `event_ts`, tie-broken by `ingested_at` then `event_id`), so the append-on-change log still yields exactly one current row per run and counts each phase once (§4.5).

### 8.1 Read-cost bound (whisper retention — source-verified)

**Corrects a false assumption in earlier drafts (§D2).** An earlier draft claimed the per-tick read was "bounded" because "whisper prunes its DB to ~2 days." That is false. Verified against the canonical source at `~/Dev/ai-whisper` (not the installed `dist`):

- Whisper's only time-based cleanup is the hourly `createDiagnosticsSweep` (`packages/broker/src/runtime/diagnostics-sweep.ts`). It deletes **only** diagnostics rows: `relay_capture_diagnostics` and `relay_evaluator_diagnostics` at `DEFAULT_RETENTION_DAYS = 30`, and `relay_turn_event_diagnostics` plus turn-event `.jsonl` logs at `DEFAULT_EVENT_LOG_RETENTION_DAYS = 3` (all env-overridable). It never touches `workflows` or `workflow_phases`.
- The **only** deletion of `workflows`/`workflow_phases` is explicit collab purge (`packages/broker/src/storage/repositories/collab-repository.ts`, design doc `2026-06-30-collab-purge-design.md`) — an operator action, not a time horizon.
- The dashboard's 30-day `--all` view is `listAllWorkflowSummaries(sinceMs)` — a **read-time query window**, not a prune. Rows older than 30 days remain in `state.db`.

**Consequence:** a `readAllWorkflows(collabId)` full scan returns every run a *live* collab has ever accumulated (removed only by collab purge), so the per-tick work of `archiveOnce` (read + re-hash + insert-on-conflict of the whole history) grows without bound as a long-lived collab racks up runs — it is **not** bounded by any time prune. At the current poll interval (3000 ms) this rescans the entire per-collab history every tick. Today's volume is tiny (a fresh machine holds a handful of runs), so there is no live problem, but the design must not rely on a prune that does not exist.

**Mitigation (Task 15):** persist a per-source high-water mark in `meta` (an ISO timestamp = the max `updated_at` / phase `started_at` / `ended_at` seen), and have `readAllWorkflows` accept a `sinceUpdatedAt` argument so each tick reads only runs that could have changed. Idempotency (§8, above) remains the correctness backstop — the watermark only skips rows that provably cannot have changed; the boundary is re-read every tick (a `>=` comparison) and re-hashes to the same `event_id`, a safe no-op. **Watermark caveat (source-verified):** `closeWorkflowPhaseRun` (`UPDATE workflow_phases SET ended_at, outcome`) does **not** bump the parent `workflows.updated_at`. In all four current call sites in `workflow-control.ts` it co-occurs with a workflow-level write (`setWorkflowStatus` / `updateWorkflowContext` / phase-advance), but that is an undocumented internal coupling of an external project. The watermark must therefore key on phase activity too — a `workflows.updated_at`-only filter would be fragile against a whisper refactor that closes a phase without touching its workflow row.

## 9. Delivery — acknowledge/retry outbox (interface only, wired Phase 2)

For ephemeral live producer events (focus/idle, lifecycle) that vanish if the worker crashes, the exploration mandates at-least-once over the unacknowledged `utilityProcess` `postMessage` channel. This slice **defines the interface** — a producer stamps a stable event ID; the worker `ack`s by ID after an idempotent insert; the main process holds an outbox/retry buffer and replays unacked events on reconnect/respawn — in `worker-protocol.ts`, but ships **no producer and no wiring**, because Phase 1 has no live producer to exercise it. It is fully implemented and validated in Phase 2 with the focus/idle collector, which is the first thing that needs it. Building it now, untested, is exactly the abstract-design risk the walking skeleton exists to avoid.

## 10. The tracer — whisper archiver, end-to-end

### 10.1 Reader extension

Add `readAllWorkflows(collabId)` to `whisper-store-reader.ts` alongside the existing `readActiveWorkflow` (`:141`): the same read-only DB handle (`?mode=ro`, `PRAGMA`/`SELECT` only — the module **must never write to whisper's DB**), but **drop the `ORDER BY updated_at DESC LIMIT 1`** (`:149`), keep `created_at`, and join `workflow_phases` (`phase_run_id`, `phase_index`, `phase_name`, `chain_id`, `started_at`, `ended_at`, `outcome` — carrying `phase_run_id`, the phase primary key, so distinct same-named phase runs stay distinct) and `collab` (`workspace_root`). Returns every run for the collab. The existing `user_version` gate (v6–7, `whisper-env-probe.ts:9`) is enforced before any read; an out-of-range or absent DB makes the archiver a visible no-op (records nothing; never partial/corrupt).

### 10.2 Trigger and ownership

The **insights worker** opens its own read-only whisper reader and runs its own poll loop (interval from config, default 3000 ms to match `whisper-driver.ts:36`), independent of the main-process whisper driver (D7). The whisper `state.db` path is resolved in the main process via the existing env probe and passed in the worker config. Each tick: for every known collab, `readAllWorkflows`, map to observations, write idempotently, update `coverage` for the days touched.

### 10.3 Observation mapping

- **`whisper.workflow`** per run: `subject_id = <workflow_id>`, `event_ts = updated_at`, `occurred_start = created_at`, `occurred_end =` **the run's terminal timestamp** `= max(workflow_phases.ended_at)` when the run is in a terminal `status`, else `NULL` (exploration §3.2b prefers max-phase-end over `updated_at` for a precise run end; capturing it onto the workflow observation lets the view read one authoritative end without re-maxing phase rows), `ts_precision='exact'`, `source='whisper-archiver'`, `schema_version = user_version`, `origin='n/a'`, `repo_id`/`workspace_rel`/`branch` resolved from `collab.workspace_root` via the §7.6 resolver (never the raw path); `payload = { collab_id, workflow_type, status, halt_reason, workspace_label }` (allowlisted; basename-only label; `spec_path`/`name`/`workflow_context` are **excluded** per §7.6).
- **`whisper.phase`** per phase: `subject_id = <phase_run_id>` (the whisper `workflow_phases` primary key — globally unique; `phase_name` is **not** unique, so it must not be the identity), `occurred_start = started_at`, `occurred_end = ended_at`, `event_ts = ended_at ?? started_at`, `payload = { run_id, phase_run_id, phase_name, phase_index, outcome, chain_id }` (`run_id = <workflow_id>` so the view can group current phase snapshots per run).
- `event_id` per §8.

**No success/failure classification here.** Raw `status`, `halt_reason`, and per-phase `outcome` are recorded verbatim; whether `halted`/`canceled`/`escalated` counts as failure is a versioned read-time analytics policy (exploration §3.2b, §8), not a capture decision.

### 10.4 Read contract

One typed method on the module's read surface, reachable over IPC (`{ kind: "query", query: { name: "whisperRuns", range } }` → `queryResult`):

```ts
getWhisperRuns(range: { fromMs: number; toMs: number }): {
  runs: WhisperRunRow[];        // from the whisper_runs view, filtered to range
  completeness: "complete" | "partial" | "unknown";  // from coverage for the range
}
```

`WhisperRunRow = { runId, collabId, repoId, workspaceRel, workflowType, status, haltReason, startedAt, endedAt, durationMs, phaseCount }`. This single call proves the full spine: whisper DB → worker read → observation write → derived view → typed read, with provenance-backed completeness.

**Range inclusion is by run start, half-open, UTC — stated so the test can catch a wrong implementation.** A run is in the result iff `fromMs <= started_at < toMs`, where `started_at` is the workflow's `occurred_start` (`created_at`). Rationale: this answers "workflows executed *during* a period" unambiguously — a run belongs to the single period it started in, so adjacent ranges never double-count a boundary run (`fromMs` inclusive, `toMs` exclusive), and a still-running run (no `ended_at`) is included by its start. Period/day boundaries are computed in **UTC**, matching the `coverage.day` rule (§4.3). Overlap-based ("runs active during") and completion-based ("runs completed during") inclusion are **out of scope** for this slice; if the dashboard later needs them they are added as separate, explicitly-named query variants, never by silently redefining this one.

`completeness` is derived from `coverage` for `source='whisper-archiver'`: `complete` if every UTC day the range touches is marked complete, `partial` if some are, `unknown` if none are recorded. This stays truthful under retention because `coverage` is pruned in lockstep with `observations` on the same UTC-day horizon (§7.5): a day whose observations were pruned no longer has a coverage row to certify it, so its completeness reverts to `unknown` — never a false `complete`.

## 11. File / module layout

```
services/insights/                     -- host-Node-testable core (no Electron)
  worker-protocol.ts                   -- MainToInsightsWorker / InsightsWorkerToMain
  store/
    schema.ts                          -- DDL, migrate(), PRAGMA user_version target
    observations.ts                    -- typed insert (idempotent), payload validation registry
    payload-schemas.ts                 -- per-kind zod schemas ('whisper.workflow'|'whisper.phase')
    views.ts                           -- whisper_runs derivation + getWhisperRuns
    path-identity.ts                   -- resolveWorkspaceIdentity() + absolute-path write guard (§7.6)
  whisper/
    archiver.ts                        -- poll loop, mapping, idempotent write, coverage update
  retention.ts                         -- prune (constants)
electron/main/services/
  insights-host.ts                     -- utilityProcess.fork, consent gating, config seed, IPC relay
  insights-worker.ts                   -- worker entry: wires store + archiver + protocol
  ipc.ts                               -- register insights:setEnabled / insights:deleteAll / insights:noticeAck handlers; forward insights:notice (edit)
shared/models/
  persisted-workspace-state.ts         -- add InsightsSettingsSchema to usageTelemetry (edit)
  persisted-settings.ts                -- extend the patch mirror (edit)
services/plugins/whisper/
  whisper-store-reader.ts              -- add readAllWorkflows (edit)
<preload bridge>                       -- expose insights.setEnabled / insights.deleteAll to the renderer (edit)
src/features/settings/components/
  SettingsDialog.tsx                   -- insights enable toggle + "Delete insights data" action (edit)
src/app/…                              -- one-time notice surface listening on 'insights:notice' (new)
```

The `whisper-store-reader` extension is reused by the worker's reader; keep the read-only open path identical to the existing one. The renderer/preload/Settings entries above are the user-visible surface the §7.3 notice contract requires; they carry the e2e coverage AGENTS.md:159 mandates.

## 12. Edge cases

- **Whisper DB absent / schema out of range** → archiver no-ops visibly (status reports `whisper: unavailable`); the store and worker still run for future producers.
- **Consent off at startup** → no worker, no DB handle, no directory created.
- **Consent flips on then off mid-poll** → worker stops cleanly; a partially-processed tick is safe (idempotent writes, next enabled start re-reads).
- **Run mutates between polls** (running → done) → a new `event_id` appends a new observation; `whisper_runs` collapses to the current revision per §4.5, so one run row, **each phase counted once** (a phase's running and ended snapshots do not both count), and `duration_ms` from the run's terminal timestamp.
- **Two workflow snapshots share the same `updated_at`** → current-revision selection stays deterministic via the `ingested_at` then `event_id` tiebreak (§4.5); the view never flickers between equally-timed rows.
- **`coverage` upsert for an already-recorded day** → keyed on `(source, provider, day)` with the non-null `'n/a'` provider sentinel, so it updates the one authoritative row instead of inserting a duplicate (§4.3).
- **Range-boundary run** → `started_at == toMs` is excluded, `started_at == fromMs` is included (half-open, UTC), so every run lands in exactly one period (§10.4).
- **Run removed from whisper before first capture** → unrecoverable by design; not an error. Source-verified (§8.1): whisper never time-prunes `workflows`/`workflow_phases`, so the only way a run vanishes before the archiver sees it is an **explicit collab purge** — not a time race. The archiver records whatever whisper still retains at poll time.
- **Malformed / unregistered payload** → hard write error, surfaced via `{ kind: "error" }`; no silent junk row.
- **Phase identity** → phases are keyed by `phase_run_id` (the `workflow_phases` PK), never `phase_name`; two phase runs sharing a name stay two current rows and `phase_count` counts both (§4.5). `workflow_id` is the `workflows` PK (verified globally unique), so a workflow's `subject_id` needs no `collab_id` prefix.
- **`utilityProcess` drops a pre-spawn message** → the host queues until `spawn` (existing pattern); worker config always arrives first.
- **Delete-all while a poll is in flight** → host sends `closeStore`, awaits `storeClosed`, stops the worker, then removes the directory (§7.4); a re-enable recreates from schema v1 and re-reads whatever whisper still retains.
- **Delete-all while disabled (no worker running)** → the host deletes the `insights/` directory directly, no worker required (§7.4); succeeds and is idempotent.
- **First-capture message lost before delivery** → `meta.first_capture_at` is set but `noticeShown` stays false, so the next worker start's `status` re-drives delivery (§7.3); the notice is guaranteed, not dropped.
- **Retention prunes a fully-aged UTC day** → both its `observations` and its `coverage` row are deleted in lockstep on the day cutoff (§7.5), so `getWhisperRuns` completeness for that day is `unknown`, never a false `complete`.
- **Workspace root is a linked worktree, or not a git repo at all** → the §7.6 resolver still yields an opaque `repo_id` plus a repo-relative-or-basename `workspace_rel` and basename label; a linked worktree's `.git` *file* `gitdir:` pointer resolves to the common repo's `repo_id`; a non-git path falls back to a hashed `repo_id` + basename. No absolute path is ever stored.
- **A whisper field carries an absolute path or free-text content** (e.g. `spec_path`) → the strict payload allowlist drops it and the absolute-path write guard rejects any absolute-path string that slips into any column or payload leaf (§7.6); the write fails loudly rather than persisting it.
- **ABI mismatch** (`NODE_MODULE_VERSION`) → caught by the test harness rebuild step; document the rebuild in the module README.
- **Clock/timezone** → all timestamps stored as ms epoch UTC; day bucketing for `coverage` uses a defined local-vs-UTC rule (pick UTC for stability; note it).

## 13. Test plan

Runs on the host-Node ABI (`scripts/rebuild-better-sqlite3-host.mjs` before vitest). Existing test helpers are reused where they make the tests cleaner (temp-dir fixtures, settings builders).

- **Migrations:** empty DB → `migrate` creates v1 with **all three tables** (`observations`, `coverage`, `meta`); reopening the DB after a restart still finds `meta`; re-run is a no-op; `user_version` pinned.
- **Idempotent write:** same `event_id` inserted twice → one row; a changed snapshot → a second row; PK conflict path exercised.
- **Payload validation:** valid `whisper.workflow`/`whisper.phase` payloads accepted; malformed rejected; unregistered kind rejected.
- **Whisper archiver against a fixture `state.db`** (a temp *copy*, opened read-only — never the real DB): observations produced for every run + phase; re-run idempotent; `whisper_runs` durations/statuses/`halt_reason`/`phase_count` correct; collab join orphan-free; schema-version gate refuses an out-of-range DB; absent DB → visible no-op. Includes a **duplicate-phase-name fixture** (two phase runs with the same `phase_name` but distinct `phase_run_id`) asserting `phase_count = 2`.
- **Derived view correctness (the reviewer's core failure):** a running→terminal sequence in which a phase itself went running→ended yields **exactly one** `whisper_runs` row; `phase_count` counts each phase once **keyed by `phase_run_id`** (not its historical snapshots, and two same-named phase runs count as two); `duration_ms` derives from the run's terminal `occurred_end`, not a re-max of phase rows in the view; `status`/`halt_reason` reflect the current revision; and two snapshots sharing an `updated_at` resolve deterministically via the `ingested_at`/`event_id` tiebreak.
- **Read contract & range inclusion:** `getWhisperRuns(range)` applies half-open UTC start-time inclusion — a run with `started_at == fromMs` is returned, one with `started_at == toMs` is not, a still-running run is included by its start — and returns a `completeness` consistent with `coverage`.
- **Coverage upsert idempotency:** two completeness upserts for `(whisper-archiver, 'n/a', day)` leave exactly one row; the `'n/a'` sentinel plus the three-column key make NULL-provider duplication impossible.
- **Consent gating:** effective-false → `start()` opens nothing; master kill (`usageTelemetry.enabled=false`) overrides `insights.enabled=true`.
- **Settings nesting:** a `{ insights: { enabled: false } }` patch does not reset `noticeShown` (guards the §7.1 deep-merge).
- **Delete-all:** removes the `insights/` directory; idempotent when absent. **Disable → delete-all:** with the worker already stopped (consent off), delete-all still removes the store via the host-owned path (§7.4).
- **First-capture notice (delivery, not just emission):** `meta.first_capture_at` is set durably at first capture; a **crash / lost `firstCapture` message injected between the `meta` commit and delivery** still yields delivery on the next worker start (driven by `firstCaptureAt` in `status`); `noticeShown` persists **only** after a renderer `insights:noticeAck`, so the notice is delivered at-least-once and then terminated exactly once. An **e2e test** covers the flow — notice appears, post-ack never reappears, the Settings toggle stops capture, delete-all clears the store — extending (not replacing) the existing suite (AGENTS.md:159–160).
- **Retention prune (observations + coverage in lockstep):** an observation older than `OBSERVATION_RETENTION_DAYS` is deleted by the prune on worker start and `whisper_runs` reflects it; the pruned day's `coverage` row is deleted in the same pass, so `getWhisperRuns` completeness for that day is `unknown`, **not** a false `complete` — the reviewer's retention-vs-completeness case.
- **Path/identity privacy (the reviewer's gap):** `resolveWorkspaceIdentity` maps a fixture `workspace_root` to an opaque `repo_id` (stable hash — assert it is not the path and is deterministic), a repo-relative `workspace_rel` (no leading `/`, no home dir), and a basename-only `workspace_label`; a **linked-worktree** fixture (a `.git` *file* with a `gitdir:` pointer) resolves to the **common** repo's `repo_id` with a basename/relative `workspace_rel`; a **non-git** path falls back to a hashed `repo_id` + basename. A **prohibited-payload** test asserts the strict allowlist drops `spec_path`/`name`/`workflow_context` and that the absolute-path write guard **rejects** a payload (or column) carrying any absolute path, so **no stored row — promoted column or payload leaf — contains an absolute path or a `spec_path`-like field**.
- **Provenance:** every written row has non-null `source`, `ts_precision`, `parser_version`, `schema_version`, `ingested_at`.

## 14. Acceptance criteria (definition of done for this slice)

1. With consent on and a whisper DB present, the insights worker spawns, creates `<userData>/insights/insights.db` at schema v1, and within one poll interval `getWhisperRuns` returns the machine's real whisper runs with correct durations, statuses, and workspace attribution.
2. Re-running / restarting produces no duplicate observations (idempotency holds).
3. Whisper's DB is never written to (verified: read-only open, no `INSERT`/`UPDATE`/`PRAGMA`-write against it).
4. Consent off (either toggle) → no worker, no store, no capture. **Delete-all succeeds even after disabling** (host-owned, no worker required), removes the store, and is idempotent.
5. The one-time notice is **delivered at least once and then exactly once** — driven by the durable `meta.first_capture_at`, re-attempted on every worker start until a renderer `insights:noticeAck` persists `noticeShown = true`, so a crash or lost message between capture and delivery cannot drop it — links to a working disable toggle and delete-all action in Settings, and is covered by the e2e suite (AGENTS.md:159).
6. Every observation carries full provenance; no row — promoted column or payload leaf — stores content or an absolute path. Enforced by the §7.6 resolver (opaque `repo_id`, repo-relative `workspace_rel`, basename label), the strict payload allowlist (excluding `spec_path`/free-text fields), and the absolute-path write guard, each covered by a test (§13).
7. The full test suite (§13) passes on the host-Node ABI, and the app still builds/runs on the Electron ABI.
8. `whisper_runs` is correct under the append-on-change log: a run observed running-then-terminal (including a phase that went running→ended) yields exactly one row; phases are keyed by `phase_run_id`, so each phase counts once and two same-named phase runs count as two; `duration_ms` comes from the run's terminal timestamp.
9. `getWhisperRuns(range)` uses half-open UTC start-time inclusion, so every run lands in exactly one period and boundary runs are never double-counted.
10. Observations past `OBSERVATION_RETENTION_DAYS` are pruned on worker start, and `coverage` is pruned in lockstep on the same UTC-day horizon so completeness never falsely reports `complete` for a pruned day; no separate derived-history store exists in this slice (single retention horizon).

## 15. Risks

- **Whisper id scheme** — resolved against the real schema (`make-whisper-fixture-db.ts`): `workflow_id` is the `workflows` PK and `phase_run_id` the `workflow_phases` PK (both globally unique), so `subject_id` uses them directly; `phase_name` is non-unique and must never serve as an identity (§4.5, §10.3).
- **Path/content leakage** — whisper rows carry an absolute `workspace_root` and a `spec_path`; a naive copy would leak them into a durable analytics store. Neutralized by the §7.6 resolver (opaque `repo_id` + repo-relative `workspace_rel`), the strict payload allowlist, and the absolute-path write guard — all test-pinned (§13).
- **Settings deep-merge regression** — the deeper `insights` nest can silently reset sibling fields if the patch guard is not extended (§7.1); covered by a targeted test.
- **Second utility process cost** — one more `utilityProcess`; acceptable, and it exists only while consent is on.
- **View performance** — the `whisper_runs` current-revision window over `observations` may need supporting indexes or a promoted/materialized-column refactor as history grows; revisit if a query is slow. Its *correctness* is pinned by the §4.5 derivation rules and their tests (§13), so any perf refactor must preserve deterministic current-revision selection, once-per-phase counting, and terminal-timestamp duration.
- **SQLite footguns are load-bearing here** — NULLs are permitted in a rowid table's composite `PRIMARY KEY` (neutralized by the coverage `'n/a'` sentinel, §4.3) and current-revision ordering can tie (neutralized by the `ingested_at`/`event_id` tiebreak, §4.5). Both are correctness-critical and covered by dedicated tests, not left to intuition.
- **ABI drift** — the rebuild dance must be in the test/CI path or `NODE_MODULE_VERSION` surfaces late.

## 16. Follow-ups (next slices, not this one)

- **Phase 2 — live capture:** focus/idle, workspace, terminal, and agent-session collectors; the acknowledge/retry outbox (§9) wired and validated here.
- **Phase 3 — backfill:** provider-log importers (claude/codex/hax) keeping the fields the ledger drops; app-managed/external attribution correlation (§6); the coverage-map query rule over the stub table (§4.3); and the exploration's separate detailed-vs-aggregated retention rules (§7.5), once persisted aggregate records first exist and have independent bytes to retain.
- **Phase 4 — typed query API + data-quality validation** over the store.
- **Phase 5 — dashboard UI** on the read contracts, reusing the existing chart primitives.
