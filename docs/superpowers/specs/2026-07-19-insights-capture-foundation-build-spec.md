# ai-14all — insights capture: instrumentation-foundation build spec (Phase 1, walking skeleton)

- **Date:** 2026-07-19
- **Status:** Build spec — approved in brainstorming, ready for an implementation plan.
- **Owner:** Vu
- **Precedes:** the implementation plan (writing-plans) for this slice.
- **Builds on:** `2026-07-19-usage-insights-capture-module-design.md` (the feasibility/architecture exploration — three-tier availability model, observation-store principle, coverage rule, phasing). This spec is the concrete Phase-1 design that exploration deferred.
- **Related:** `2026-07-17-hax-native-usage-driver-design.md` (the token-telemetry worker pattern this mirrors).

## 1. What this slice is

The first build slice of the decoupled insights-capture module: the **instrumentation foundation**, built as a **walking skeleton**. It delivers the durable substrate — a module-owned SQLite observation store, a sibling worker, the provenance/attribution schema, the privacy/consent contract, and idempotent writes — **and** threads exactly one real producer all the way through it (the whisper workflow-history archiver) so the spine is proven end-to-end and the schema is validated against real data before the remaining collectors commit to it.

Nothing is designed purely in the abstract: every mechanism this slice builds is exercised by the whisper tracer, except the parts explicitly scoped to a later phase (§9, §16).

**In scope:** module boundary + worker; the `observations` store, migrations, indexes, per-kind payload validation, and the first derived view; provenance + precision model; attribution columns (carried, not yet correlated); the consent/privacy contract (settings extension, master kill, one-time notice, disable, delete-all, retention knobs, path handling); idempotent-write delivery; the whisper archiver end-to-end with one typed read; the test story including the better-sqlite3 ABI rebuild.

**Out of scope (later phases):** provider-log backfill and app-managed/external attribution correlation (Phase 3); focus/idle, workspace, terminal, and agent-session live collectors and the acknowledge/retry live-delivery wiring (Phase 2); coverage-map query logic beyond a stub table (Phase 3); any dashboard UI (Phase 5).

## 2. Decisions locked (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Walking skeleton**, not pure foundation | Validate the schema against a real producer before other collectors depend on it. |
| D2 | **Whisper archiver** is the single tracer | Most time-critical source (whisper's DB prunes to ~2 days); richest test of the atomic-observations-derive-everything principle (one run fans out into related observation kinds); read-only and bounded. |
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

- Main → worker: `{ kind: "config", config }`, `{ kind: "setEnabled", enabled }`, `{ kind: "deleteAll" }`, `{ kind: "query", requestId, query }` (the read contract), `{ kind: "flush" }` (force a poll now, e.g. before shutdown).
- Worker → main: `{ kind: "status", status }` (heartbeat: last poll time, store row counts, whisper availability), `{ kind: "queryResult", requestId, result }`, `{ kind: "firstCapture" }` (drives the one-time notice), `{ kind: "error", scope, message }`.

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
  subject_id      TEXT,                 -- the entity: workflow_id, '<workflow_id>:<phase>'
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
- **Promoted vs payload.** Columns are the fields we query/join/index across kinds; kind-specific detail lives in `payload`. A registered zod schema per `kind` validates `payload` at write time in the worker; an unregistered kind or an invalid payload is a hard write error (never a silent junk row).

### 4.3 Coverage stub

```sql
CREATE TABLE coverage (
  source    TEXT NOT NULL,
  provider  TEXT,
  day       TEXT NOT NULL,         -- 'YYYY-MM-DD'
  complete  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, provider, day)
);
```

Defined now so provenance and the read contract can reference completeness, but its population and the detailed-if-complete-else-legacy query rule (exploration §5) are Phase 3. In this slice, the whisper archiver marks per-day completeness for its own `source` so `getWhisperRuns` can return a real completeness marker.

### 4.4 Migrations

Schema version tracked in `PRAGMA user_version`. A `migrate(db)` routine applies ordered steps from the DB's current `user_version` to the module's target, each step in a transaction. Version 1 is the schema in §4.2–4.3. The routine is idempotent (running against an already-current DB is a no-op) and is the only path that creates or alters tables.

### 4.5 Derived view — `whisper_runs`

Sessions, durations, and rollups are **queries/views over `observations`**, never a primary table (exploration §6.2.1). This slice ships one:

```sql
CREATE VIEW whisper_runs AS
-- latest observed state per workflow, joined to its phases
SELECT
  w.subject_id                              AS run_id,
  json_extract(w.payload,'$.collab_id')     AS collab_id,
  w.repo_id, w.workspace_rel,
  json_extract(w.payload,'$.workflow_type') AS workflow_type,
  json_extract(w.payload,'$.status')        AS status,
  json_extract(w.payload,'$.halt_reason')   AS halt_reason,
  w.occurred_start                          AS started_at,
  p.ended_at                                AS ended_at,
  (p.ended_at - w.occurred_start)           AS duration_ms,
  p.phase_count
FROM (
  SELECT o.* FROM observations o
  WHERE o.kind='whisper.workflow'
  AND o.event_ts = (SELECT MAX(o2.event_ts) FROM observations o2
                    WHERE o2.kind='whisper.workflow' AND o2.subject_id=o.subject_id)
) w
LEFT JOIN (
  SELECT subject_id_run AS run, MAX(occurred_end) AS ended_at, COUNT(*) AS phase_count
  FROM (SELECT *, substr(subject_id,1,instr(subject_id,':')-1) AS subject_id_run
        FROM observations WHERE kind='whisper.phase')
  GROUP BY run
) p ON p.run = w.subject_id;
```

(The exact SQL is illustrative — the phase-run key derivation may move to a stored column if a query proves it awkward; the contract is the derived shape, not this text.)

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

On the worker's **first successful capture**, it emits `{ kind: "firstCapture" }` once (guarded so it fires at most once per install). The main process, seeing this while `noticeShown === false`, shows a transparent notice ("ai-14all now records local, content-free usage insights — manage or delete these in Settings") and persists `noticeShown = true`. The notice is informational, not a second consent gate (consent already defaulted on per D4); it must link to the disable + delete-all controls.

### 7.4 Disable and delete-all

- **Disable:** setting `insights.enabled = false` (or the global opt-out) stops the worker. Existing data is retained unless deleted.
- **Delete-all:** an IPC (`insights:deleteAll` → worker `{ kind: "deleteAll" }`) that stops the poll, closes the DB handle, and deletes the `<userData>/insights/` directory (DB + WAL/SHM). Idempotent; safe when the store does not exist.

### 7.5 Retention

Separate knobs for detailed observations vs derived history, defined as module constants in this slice (surfaced in settings later): a default retention window for raw `observations` (generous, since local-only) with a periodic prune on the worker; derived `whisper_runs` are a view over whatever observations remain, so their horizon follows the observation window. Values are constants now, tunable without schema change.

### 7.6 Path handling

Store `repo_id` = a stable hash of the absolute repo root, `workspace_rel` = repo-relative path, and (for the future UI) a human `workspace_label` derived from the workspace root's basename kept only in `payload`. **No absolute home paths in the promoted analytics columns.** No file/spec *contents* ever; whisper's `workflow_type` and phase names are metadata, not content, and may be stored. Hashing/redaction of the human label is deferred until export or cross-machine sync exists (both out of scope — exploration §10).

## 8. Delivery — idempotent writes (the half this slice exercises)

Whisper archiving is inherently at-least-once against a durable source: the worker re-reads whisper's DB every poll and writes idempotently, so a missed or crashed poll self-heals on the next tick (until whisper's own ~2-day prune).

- **Deterministic `event_id`** = a stable hash of the observed content snapshot (for `whisper.workflow`: `workflow_id` + `status` + `halt_reason` + terminal timestamps + phase-outcome set; for `whisper.phase`: `workflow_id` + `phase_name` + `outcome` + `started_at`/`ended_at`). Re-observing an **unchanged** run yields the same `event_id` → the insert is a no-op. Observing a **changed** run yields a new `event_id` → a new observation row is appended. The store thus accumulates the distinct observed states over time — a true observation log, no collapse, no duplicates.
- **Write:** `INSERT INTO observations (...) VALUES (...) ON CONFLICT(event_id) DO NOTHING`. Idempotency is structural (the PK), so replays are always safe.
- The derived `whisper_runs` view takes the latest observation per `subject_id`, so the append-on-change log still yields one current row per run.

## 9. Delivery — acknowledge/retry outbox (interface only, wired Phase 2)

For ephemeral live producer events (focus/idle, lifecycle) that vanish if the worker crashes, the exploration mandates at-least-once over the unacknowledged `utilityProcess` `postMessage` channel. This slice **defines the interface** — a producer stamps a stable event ID; the worker `ack`s by ID after an idempotent insert; the main process holds an outbox/retry buffer and replays unacked events on reconnect/respawn — in `worker-protocol.ts`, but ships **no producer and no wiring**, because Phase 1 has no live producer to exercise it. It is fully implemented and validated in Phase 2 with the focus/idle collector, which is the first thing that needs it. Building it now, untested, is exactly the abstract-design risk the walking skeleton exists to avoid.

## 10. The tracer — whisper archiver, end-to-end

### 10.1 Reader extension

Add `readAllWorkflows(collabId)` to `whisper-store-reader.ts` alongside the existing `readActiveWorkflow` (`:141`): the same read-only DB handle (`?mode=ro`, `PRAGMA`/`SELECT` only — the module **must never write to whisper's DB**), but **drop the `ORDER BY updated_at DESC LIMIT 1`** (`:149`), keep `created_at`, and join `workflow_phases` (`started_at`, `ended_at`, `outcome`, `phase_name`, `chain_id`) and `collab` (`workspace_root`). Returns every run for the collab. The existing `user_version` gate (v6–7, `whisper-env-probe.ts:9`) is enforced before any read; an out-of-range or absent DB makes the archiver a visible no-op (records nothing; never partial/corrupt).

### 10.2 Trigger and ownership

The **insights worker** opens its own read-only whisper reader and runs its own poll loop (interval from config, default 3000 ms to match `whisper-driver.ts:36`), independent of the main-process whisper driver (D7). The whisper `state.db` path is resolved in the main process via the existing env probe and passed in the worker config. Each tick: for every known collab, `readAllWorkflows`, map to observations, write idempotently, update `coverage` for the days touched.

### 10.3 Observation mapping

- **`whisper.workflow`** per run: `subject_id = <workflow_id>`, `event_ts = updated_at`, `occurred_start = created_at`, `occurred_end = terminal end or NULL`, `ts_precision='exact'`, `source='whisper-archiver'`, `schema_version = user_version`, `origin='n/a'`, `repo_id`/`workspace_rel` from `collab.workspace_root`; `payload = { collab_id, workflow_type, status, halt_reason, phase_count, workspace_label }`.
- **`whisper.phase`** per phase: `subject_id = <workflow_id>:<phase_name>`, `occurred_start = started_at`, `occurred_end = ended_at`, `event_ts = ended_at ?? started_at`, `payload = { phase_name, outcome, chain_id }`.
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

## 11. File / module layout

```
services/insights/                     -- host-Node-testable core (no Electron)
  worker-protocol.ts                   -- MainToInsightsWorker / InsightsWorkerToMain
  store/
    schema.ts                          -- DDL, migrate(), PRAGMA user_version target
    observations.ts                    -- typed insert (idempotent), payload validation registry
    payload-schemas.ts                 -- per-kind zod schemas ('whisper.workflow'|'whisper.phase')
    views.ts                           -- whisper_runs derivation + getWhisperRuns
  whisper/
    archiver.ts                        -- poll loop, mapping, idempotent write, coverage update
  retention.ts                         -- prune (constants)
electron/main/services/
  insights-host.ts                     -- utilityProcess.fork, consent gating, config seed, IPC relay
  insights-worker.ts                   -- worker entry: wires store + archiver + protocol
shared/models/
  persisted-workspace-state.ts         -- add InsightsSettingsSchema to usageTelemetry (edit)
  persisted-settings.ts                -- extend the patch mirror (edit)
services/plugins/whisper/
  whisper-store-reader.ts              -- add readAllWorkflows (edit)
```

The `whisper-store-reader` extension is reused by the worker's reader; keep the read-only open path identical to the existing one.

## 12. Edge cases

- **Whisper DB absent / schema out of range** → archiver no-ops visibly (status reports `whisper: unavailable`); the store and worker still run for future producers.
- **Consent off at startup** → no worker, no DB handle, no directory created.
- **Consent flips on then off mid-poll** → worker stops cleanly; a partially-processed tick is safe (idempotent writes, next enabled start re-reads).
- **Run mutates between polls** (running → done) → a new `event_id` appends a new observation; `whisper_runs` reflects the latest; no duplicate run row.
- **Run pruned from whisper before first capture** → unrecoverable by design; not an error (that is the time-criticality this phase races).
- **Malformed / unregistered payload** → hard write error, surfaced via `{ kind: "error" }`; no silent junk row.
- **Two collabs, same workflow_id space** → `subject_id` is the workflow id; if whisper ids are only collab-unique, prefix with `collab_id` (verify against whisper's id scheme during implementation).
- **`utilityProcess` drops a pre-spawn message** → the host queues until `spawn` (existing pattern); worker config always arrives first.
- **Delete-all while a poll is in flight** → poll aborts, handle closes, directory removed; a re-enable recreates from schema v1 and re-reads whatever whisper still retains.
- **ABI mismatch** (`NODE_MODULE_VERSION`) → caught by the test harness rebuild step; document the rebuild in the module README.
- **Clock/timezone** → all timestamps stored as ms epoch UTC; day bucketing for `coverage` uses a defined local-vs-UTC rule (pick UTC for stability; note it).

## 13. Test plan

Runs on the host-Node ABI (`scripts/rebuild-better-sqlite3-host.mjs` before vitest). Existing test helpers are reused where they make the tests cleaner (temp-dir fixtures, settings builders).

- **Migrations:** empty DB → `migrate` creates v1; re-run is a no-op; `user_version` pinned.
- **Idempotent write:** same `event_id` inserted twice → one row; a changed snapshot → a second row; PK conflict path exercised.
- **Payload validation:** valid `whisper.workflow`/`whisper.phase` payloads accepted; malformed rejected; unregistered kind rejected.
- **Whisper archiver against a fixture `state.db`** (a temp *copy*, opened read-only — never the real DB): observations produced for every run + phase; re-run idempotent; `whisper_runs` durations/statuses/`halt_reason`/`phase_count` correct; collab join orphan-free; schema-version gate refuses an out-of-range DB; absent DB → visible no-op.
- **Derived view:** running-then-terminal sequence yields one current run row with the latest status and a correct `duration_ms`.
- **Read contract:** `getWhisperRuns(range)` filters to range and returns a `completeness` consistent with `coverage`.
- **Consent gating:** effective-false → `start()` opens nothing; master kill (`usageTelemetry.enabled=false`) overrides `insights.enabled=true`.
- **Settings nesting:** a `{ insights: { enabled: false } }` patch does not reset `noticeShown` (guards the §7.1 deep-merge).
- **Delete-all:** removes the `insights/` directory; idempotent when absent.
- **Provenance:** every written row has non-null `source`, `ts_precision`, `parser_version`, `schema_version`, `ingested_at`.

## 14. Acceptance criteria (definition of done for this slice)

1. With consent on and a whisper DB present, the insights worker spawns, creates `<userData>/insights/insights.db` at schema v1, and within one poll interval `getWhisperRuns` returns the machine's real whisper runs with correct durations, statuses, and workspace attribution.
2. Re-running / restarting produces no duplicate observations (idempotency holds).
3. Whisper's DB is never written to (verified: read-only open, no `INSERT`/`UPDATE`/`PRAGMA`-write against it).
4. Consent off (either toggle) → no worker, no store, no capture. Delete-all removes the store.
5. The one-time notice fires exactly once on first capture and sets `noticeShown`.
6. Every observation carries full provenance; no row stores content or an absolute home path.
7. The full test suite (§13) passes on the host-Node ABI, and the app still builds/runs on the Electron ABI.

## 15. Risks

- **Whisper id scheme** — if `workflow_id` is not globally unique, `subject_id` must include `collab_id`; resolve against the real schema during implementation (edge case in §12).
- **Settings deep-merge regression** — the deeper `insights` nest can silently reset sibling fields if the patch guard is not extended (§7.1); covered by a targeted test.
- **Second utility process cost** — one more `utilityProcess`; acceptable, and it exists only while consent is on.
- **View performance** — the `whisper_runs` latest-per-subject subquery may need the promoted-column refactor noted in §4.5 as history grows; revisit if a query is slow.
- **ABI drift** — the rebuild dance must be in the test/CI path or `NODE_MODULE_VERSION` surfaces late.

## 16. Follow-ups (next slices, not this one)

- **Phase 2 — live capture:** focus/idle, workspace, terminal, and agent-session collectors; the acknowledge/retry outbox (§9) wired and validated here.
- **Phase 3 — backfill:** provider-log importers (claude/codex/hax) keeping the fields the ledger drops; app-managed/external attribution correlation (§6); the coverage-map query rule over the stub table (§4.3).
- **Phase 4 — typed query API + data-quality validation** over the store.
- **Phase 5 — dashboard UI** on the read contracts, reusing the existing chart primitives.
