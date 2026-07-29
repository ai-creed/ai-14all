# ai-14all — insights worker: decouple O(N) work from the 3s tick (E1 follow-up)

## 1. What this is

The E1 performance follow-up raised by the app-focus-collector final review: the
insights worker's 3-second tick performs two operations whose cost grows with
the total number of stored observations (N), and the app-focus collector now
grows N by ~3,800 rows/day (≈1.4M rows at 365-day steady state):

1. **Retention prune every tick** — `pruneRetention()` runs
   `DELETE FROM observations WHERE event_ts < ?` on every tick
   (`services/insights/insights-worker-core.ts:54`), and no index has
   `event_ts` as its leading column (`services/insights/store/schema.ts:30-32`),
   so each call is a full-table scan that almost always deletes nothing — the
   cutoff is UTC-day-aligned (`services/insights/retention.ts:11-13`), so at
   most one prune per UTC day can ever remove rows.
2. **`SELECT COUNT(*) FROM observations` every tick** — computed for the
   `observationCount` status field (`insights-worker-core.ts:39-41`). SQLite
   has no O(1) row count, so this walks the table.

A repo-wide consumer audit (this brainstorm) established that **no code
consumes** `observationCount`, `whisperAvailable`, or `lastPollAt`: the host's
status handler reads only `firstCaptureAt`
(`electron/main/services/insights-host.ts:458-463`), which drives the one-time
first-capture notice re-drive. `whisperAvailable` additionally costs a
whisper-DB query (`reader.listCollabIds()`) per tick.

This slice removes all per-tick O(N) work. It changes no user-visible
behavior.

## 2. Decisions locked

From brainstorming (Approach A, "structural fix"):

1. **Retention stays 365 days, uniform across kinds.** No per-kind policy, no
   rollups in this slice. The scan problem is solved structurally
   (cadence + index), so raw volume is not the constraint; retention is
   revisited only when the dashboard defines its aggregation needs.
2. **Prune on UTC-day rollover, not on a new timer.** The prune cutoff can
   only change when the UTC day changes, so the tick gates the prune on a
   `lastPrunedDay` marker instead of running it unconditionally. No new
   `setInterval`, no worker-shell changes.
3. **Delete the unused status queries rather than caching them.** The status
   message shrinks to the fields with a consumer contract
   (`lastPollAt`, `firstCaptureAt`). You can't pay for what you don't compute.
4. **Add the `event_ts`-leading index via a normal schema version bump**
   (v1 → v2), not an unversioned `CREATE INDEX IF NOT EXISTS`, so
   `user_version` keeps meaning "exactly this DDL has been applied."
5. **The notice delivery mechanism is untouched.** The status/`firstCapture`
   message pair and the host's re-drive logic took several review rounds to
   make race-free; nothing in this slice changes their semantics.

## 3. Current behavior (grounding)

- The worker shell arms `setInterval(() => core.tick(), pollIntervalMs)` with
  `pollIntervalMs: 3000` (`electron/main/services/insights-worker.ts:50`,
  `electron/main/index.ts:322`), and also calls `tick()` on boot and on each
  `flush` message.
- `tick()` (`insights-worker-core.ts:50-67`): `archiveOnce` (already bounded
  by the whisper watermark) → `pruneRetention` → post `status` → maybe post
  once-only `firstCapture`. Errors post `{kind:"error", scope:"tick"}`.
- `InsightsStatus` is `{ lastPollAt, observationCount, whisperAvailable,
  firstCaptureAt }` (`services/insights/worker-protocol.ts:10-14`).
- `migrate()` applies the frozen v1 DDL in one transaction and stamps
  `user_version = 1` (`schema.ts:79-87`).
- Indexes on `observations`: `(kind, event_ts)`, `(subject_id)`,
  `(source, event_ts)` — none serves a bare `event_ts < ?` range delete.

## 4. Design: prune on UTC-day rollover

`createInsightsWorkerCore` gains one piece of state:

```ts
let lastPrunedDay: string | null = null; // utcDay of the last SUCCESSFUL prune
```

In `tick()`, the unconditional `pruneRetention(deps.db, now)` becomes:

```ts
const day = utcDay(now);
if (day !== lastPrunedDay) {
	pruneRetention(deps.db, now);
	lastPrunedDay = day; // only reached when pruneRetention did not throw
}
```

Consequences (all intended):

- **Boot tick prunes.** A fresh core starts with `lastPrunedDay = null`, so
  the first tick after every worker start prunes once. This covers app
  restarts, worker crash re-forks, and machines that slept across multiple
  days (the cutoff is computed from `now`, so one prune catches up fully).
- **Rollover tick prunes.** The first tick whose `utcDay(now)` differs from
  the marker prunes; every other tick skips the DELETE entirely.
- **Failure retries.** `pruneRetention` throwing leaves `lastPrunedDay`
  unchanged (the existing `try/catch` posts `{scope:"tick"}`), so the next
  tick retries — a transient SQLite error cannot silently skip a day. A
  *persistently* failing prune retries per tick, which is the pre-existing
  behavior for a persistently failing tick body.
- **Inequality, not ordering.** The gate is `!==`, so a wall clock stepping
  *backwards* across midnight also triggers a prune. That is harmless:
  `pruneRetention` is idempotent and computes its cutoff from `now`.
- `flush`-triggered ticks pass through the same gate; no special case.
- `pruneRetention` itself (`services/insights/retention.ts`) is unchanged.

## 5. Design: slim the status message

`InsightsStatus` (`services/insights/worker-protocol.ts`) shrinks to:

```ts
export interface InsightsStatus {
	lastPollAt: number | null;
	firstCaptureAt: number | null;
}
```

- `status()` in the core drops the `COUNT(*)` query and its
  `reader.listCollabIds()` probe. Note the archiver's own
  `listCollabIds()` call (`services/insights/whisper/archiver.ts:110`) is
  ingestion, not status — it stays, so a tick goes from two whisper-DB
  enumerations to one. The reader dependency itself stays — `archiveOnce`
  still needs it.
- `firstCaptureAt` semantics are unchanged (read from meta via `getMeta`, a
  primary-key lookup).
- The host requires no change: `onMessage` already reads only
  `status.firstCaptureAt`. The notice re-drive path is byte-for-byte
  identical in behavior.
- Consumers of the dropped fields: none in `src/`, `electron/`, `services/`,
  or `shared/`. The only references are the producer and test fixtures
  (`tests/unit/insights/insights-host.test.ts`), which are updated.

## 6. Design: schema v2 — `event_ts`-leading index

`services/insights/store/schema.ts`:

```ts
export const TARGET_SCHEMA_VERSION = 2;

const DDL_V2 = `
CREATE INDEX idx_obs_ts ON observations (event_ts);
`;
```

`migrate()` restructures into sequential guarded steps, each stamping its own
version inside its own transaction so a crash mid-upgrade resumes at the
right step:

```ts
export function migrate(db: Database.Database): void {
	const current = db.pragma("user_version", { simple: true }) as number;
	if (current < 1)
		db.transaction(() => {
			db.exec(DDL_V1);
			db.pragma("user_version = 1");
		})();
	if (current < 2)
		db.transaction(() => {
			db.exec(DDL_V2);
			db.pragma("user_version = 2");
		})();
}
```

- `DDL_V1` stays frozen — it is history, never edited. A fresh DB runs both
  steps; an existing v1 store gets only the index.
- The one-time index build on an existing store happens at worker boot inside
  `boot()`'s existing `migrate(db)` call; at the projected steady-state
  volume this is sub-second, and the worker is not yet serving producer
  events at that point in `boot()`.
- With the index, the daily `DELETE ... WHERE event_ts < ?` is a range seek
  on `idx_obs_ts` plus per-row index maintenance on the (usually few)
  deleted rows — no full scan at any N.
- Index maintenance cost on the write path (~3,800 inserts/day) is
  negligible and is paid inside the existing atomic producer transaction.

## 7. Error handling & edge cases

- **Prune failure**: posts the existing `{kind:"error", scope:"tick"}`;
  `lastPrunedDay` does not advance; retried next tick (§4).
- **Worker restart mid-day**: the fresh core prunes on its boot tick — an
  extra idempotent, indexed prune; harmless.
- **`closeStore`**: the shell already clears the interval before the core
  closes the DB, so no tick (and no prune) can touch a closed handle;
  unchanged.
- **Migration crash between v1 and v2**: `user_version` is stamped per step
  inside each step's transaction, so a re-run resumes at the incomplete step.
- **E2E**: the insights e2e drives synthetic timestamps near `Date.now()`,
  which never approach the 365-day cutoff; the collector's own e2e poll
  seam (`pollIntervalMs: 86_400_000` under `AI14ALL_E2E`) is unrelated to
  the worker tick and is untouched. Existing e2e must stay green with no
  edits.

## 8. Acceptance criteria

- **AC1 — prune cadence.** With a fixed fake clock: the first tick prunes an
  expired row; a second expired row inserted afterwards survives any number
  of further same-UTC-day ticks; the first tick after `now` crosses UTC
  midnight prunes it.
- **AC2 — prune failure retry.** If `pruneRetention` throws on a tick, an
  error with `scope: "tick"` is posted and the *next* tick prunes again
  (the day marker did not advance).
- **AC3 — status shape.** The posted status message contains exactly
  `{ lastPollAt, firstCaptureAt }`; `status()` itself performs no reader
  calls and no `SELECT COUNT(*)` (a tick's only `listCollabIds()` call is
  the archiver's own, at `archiver.ts:110`); the first-capture notice
  re-drive behavior (worker restart with an existing `first_capture_at`
  re-announces via status, once-only `firstCapture` fires on a genuine first
  write) is unchanged.
- **AC4 — fresh migration.** `migrate()` on an empty DB lands at
  `user_version = 2` with `idx_obs_ts` present (verifiable via
  `sqlite_master`), and all v1 objects intact.
- **AC5 — in-place upgrade.** `migrate()` on a hand-built v1 store
  (v1 DDL + `user_version = 1` + seeded rows) adds the index, preserves all
  rows, stamps `user_version = 2`, and is idempotent when run again.
- **AC6 — query plan regression guard.** `EXPLAIN QUERY PLAN` for
  `DELETE FROM observations WHERE event_ts < ?` on a v2 store reports a
  search using `idx_obs_ts` and never a full table `SCAN`.

**Verification:** `pnpm typecheck && pnpm lint && pnpm test` green;
`pnpm test:e2e insights` green with no e2e edits.

## 9. Out of scope

- Retention window changes, per-kind retention, and daily rollups (§2.1).
- Any change to notice delivery, `firstCapture` semantics, or the host
  (§2.5).
- The archiver and its watermark (already bounded; untouched).
- Status-message cadence (still posted per tick — it is now two PK/meta
  lookups, i.e. O(1)).
- Any renderer/UI surface.
