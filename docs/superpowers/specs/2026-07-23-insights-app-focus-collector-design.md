# ai-14all — insights app-focus/idle collector + at-least-once outbox (Phase 2, slice 1)

## 1. What this slice is

The first live-capture producer for the insights module: a main-process **app-focus/idle collector** that measures wall-clock app engagement as durable, idempotent interval observations, and the **at-least-once outbox** that carries them from the main process to the insights worker so a worker crash cannot drop a captured span.

It is the first of the Phase 2 collectors (§16 of the Phase 1 build spec) and is deliberately scoped to **one** producer. It is chosen first because the Phase 1 exploration (§9) names the focus/idle accumulator as the producer that most needs the outbox — its events are ephemeral and irrecoverable if not captured live — so building it first is what validates the at-least-once machinery against a real signal instead of an abstract stub.

**Why this signal.** "Time spent using the app" is a Tier-3 measure with **no existing source** (Phase 1 exploration §3.2/§4): window focus/blur are logged only to a shell-event log that is off in packaged builds and pruned at 3 days, and there is no `powerMonitor`/system-idle detection anywhere in `electron/`. This collector is the first real measurement of app time, and wall-clock engagement can come *only* from this signal — never from provider logs.

## 2. Decisions locked

From brainstorming:

1. **Live capture before UI.** Accumulate richer signals before committing to any dashboard chart; the chart shape is decided later, from data.
2. **Focus/idle collector first**, and it builds the outbox for real (the §9 interface was never actually added to `worker-protocol.ts`, so there is no dead stub to reconcile).
3. **Two duration measures: `app_focused_ms` and `app_engaged_ms`.** Focused = window has OS focus; engaged = focused **and** the system is not idle past a threshold. Both are captured so the dashboard can later distinguish "app in the foreground" from "actually interacting."
4. **App-level attribution, not per-worktree.** Spans carry no repo attribution in this slice. Per-worktree time needs an "active-worktree-changed-at-T" signal, which is the *workspace collector* — a separate Phase 2 producer.
5. **In-memory outbox** bounded and replayed on worker respawn — the mandated durability boundary is *worker* crash, not full-app crash.

Refined during design review (these are now binding design decisions, not open questions):

6. **Completeness comes from recorded collector uptime, never from "a span touched this day."** A forward-only live collector cannot certify app time during intervals it was not running (consent off, app closed, crashed), so completeness is derived from explicit `app.uptime` intervals and never certifies an unobserved interval (§7).
7. **The worker-side write is one atomic transaction, and `ack` is posted only after it commits** — insert + any coverage/`first_capture_at` update together — so a crash mid-write can never leave metadata unrepaired and a replay is always a clean idempotent no-op or a clean full write (§6).
8. **The host owns worker-crash recovery.** On an unexpected worker `exit` the host clears its stale process state and, only while consent remains enabled, re-forks the worker; the new worker gets config first, then the unacked outbox replays (§6).

## 3. Scope & boundary

**In scope:** the collector (main process), three observation kinds (`app.focused` / `app.engaged` / `app.uptime`), the outbox protocol additions + main-side replay buffer + host crash-recovery lifecycle, the persistence and validation edits those rows require (`app_run_id` column write, strict per-kind payload schemas), a read measure (`getAppTime(range)` → `focusedMs`/`engagedMs`/completeness), unit tests, and an e2e extension with a bounded test seam.

**Out of scope (deliberate):**
- Per-worktree / per-workspace attribution (workspace collector, a later slice).
- The other Phase 2 collectors (workspace, terminal, agent-session).
- Any dashboard UI. This slice adds no renderer surface and no new setting.
- Durable-across-app-restart delivery (YAGNI — see §6).

**Reused unchanged:** the consent / master-kill gate (`usageTelemetry.insights.enabled` + `usageTelemetry.enabled`), the one-time notice, delete-all, the retention prune, the observation store and its content-hash idempotency, and the §7.6 privacy resolver / absolute-path write guard.

## 4. Capture mechanism

The collector lives in a new main-process module and follows the electron-free-core + thin-Electron-shell split the module already uses (mirroring `insights-worker-core` + `insights-worker`).

- **`focus-core.ts` (electron-free, unit-tested):** a pure state machine. Inputs are timestamped signals — `start`, `focus`, `blur`, `idle-poll(idleSeconds)`, `suspend`, `resume`, `stop`, `flush(now)`. Outputs are **closed span records** `{ kind, startMs, endMs, reason }`. It holds the current running interval, at most one open focused span, and — nested within it — at most one open engaged span. No Electron, no timers, no clock of its own; the shell feeds it `nowMs`.

- **`app-focus-collector.ts` (Electron shell, thin):** wires the real signals into the core and forwards emitted spans to the host's outbox:
  - `BrowserWindow` `focus` / `blur` (the app already emits these at `electron/main/index.ts:697/713`).
  - `powerMonitor.getSystemIdleTime()` polled every **15 s** while focused (no poll while blurred). Each poll is also a **segmentation boundary** (see the focused/engaged rules), so an uninterrupted active session still persists durable rows within one poll interval.
  - `powerMonitor` `suspend` / `resume`, app `before-quit`, and `setEnabled(false)` → the matching core input: `suspend`/`stop`/quit close or drop open spans; `resume` reopens a new uptime interval.
  - A single opaque **`app_run_id`** (`crypto.randomUUID()`), generated once when the collector starts for this app launch and stamped on every span it emits, so a future view can bucket by launch. It is content-free and never a path.

**Span rules (in the core):**
- A **focused span** opens on `focus`. To keep an uninterrupted session observable within one poll interval (AC1), it is **segmented at each idle poll**: every poll while focused emits the elapsed focused segment `[lastBoundary, now]` as a durable `app.focused` row (reason `poll`) and resets the boundary. It also closes on `blur`, `suspend`, or `flush`. Close reasons: `poll` | `blur` | `suspend` | `quit`. Contiguous segments sum to the true focused duration, so segmentation changes row count, not totals.
- An **engaged sub-span** exists only inside a focused span. It opens when input is present (idle-time `<` **threshold = 60 s**, a constant this slice) and, like the focused span, is **segmented at each idle poll**: a poll that still shows input emits the elapsed engaged segment `[lastBoundary, now]` (reason `poll`) and resets the boundary. A poll showing idle crossed the threshold closes the engaged span at `end = pollNow − idleSeconds*1000` (the moment input actually stopped, reason `idle`), so poll granularity never inflates engagement; a later poll showing input resumed opens a new engaged span at that input moment. It also closes when the focused span closes. Close reasons: `poll` | `idle` | `blur` | `suspend` | `quit`.
- An **uptime interval** (`app.uptime`) tracks when the collector was actually running and watching. It opens on `start` (collector enabled + window created) **and on `resume`** (after a `suspend`), and closes on `stop` (`setEnabled(false)`), `suspend`, or `quit` — the span `[collectorStart, collectorStop]`, independent of focus. It is what §7 uses to certify completeness, so unlike the engagement spans it **is** written on disable: it certifies only the consent-on window (see the disable ordering in §6). The in-progress interval is emitted only when it closes; a crash therefore under-certifies (safe) rather than over-certifies. Close reasons: `disabled` | `suspend` | `quit`.
- **`resume` after `suspend`:** opens a new uptime interval at the resume moment; if the window is focused at resume (`BrowserWindow.isFocused()`), a new focused span opens too and an engaged span opens on the next input-present poll; if not focused, the collector waits for the next `focus`.
- **`stop` (disable) drops engagement, finalizes uptime:** open focused/engaged spans are **dropped without emission** (no engagement time is captured at or after the disable instant — AC5), while the uptime interval is finalized to `[start, stopMoment]` and emitted (reason `disabled`) as the closing act of the consented window. The race-free ordering is in §6.
- **Clamp:** any span whose computed `endMs < startMs` (e.g. a backward wall-clock jump) is clamped to `endMs = startMs` (zero duration), never negative.

Spans are computed in the **main process** — the long-lived process — so a *worker* crash loses nothing already closed; main holds closed spans in the outbox until acked. A full *app* crash can lose only the in-progress open spans; graceful quit flushes them. This is exactly the boundary the §9 at-least-once mandate targets.

**Test seam.** The shell's real signal sources (`BrowserWindow`, `powerMonitor`) are replaced by a bounded injectable input when `AI14ALL_E2E` is set: the shell then also accepts an enumerated set of synthetic signals (`focus`, `blur`, `idle(idleSeconds)`, `suspend`, `resume`, `flush`) and a `crashWorker` command over a test-only IPC channel (§11). The seam exists only under the E2E flag; no production code path depends on it.

## 5. Observation model

Three new observation kinds on the existing `observations` spine. **No schema migration** — they are new `kind` values, and every column they need already exists and is nullable. Schema stays at v1. Two Phase-1 persistence/validation modules must be extended so these rows can be written and validated (§9):

- **`store/observations.ts`** — `ObservationInput` and its `COLUMNS`/bind list currently omit `app_run_id` (the schema column exists but the typed insert never writes it). Add an optional `appRunId?: string | null` field, bind it to the `app_run_id` column, and include it in the `assertNoAbsolutePathsDeep` guard list. Other live-collector columns (`terminal_session_id`, `provider_session_id`, `attribution_*`) stay unwritten this slice.
- **`store/payload-schemas.ts`** — the registry has only whisper kinds; `insertObservation` throws on an unregistered kind and zod-validates every payload. Register strict schemas for the three new kinds (below), so a non-enum reason is rejected loudly rather than persisted.

| kind | one row per | occurred_start / end | event_ts | measure |
| --- | --- | --- | --- | --- |
| `app.focused` | focus→blur span | span start / end | span end | `app_focused_ms` |
| `app.engaged` | engaged sub-span | span start / end | span end | `app_engaged_ms` |
| `app.uptime` | collector running interval | collector start / stop | stop | (completeness source, §7) |

Strict payload schemas (`.strict()`, non-enum rejected):
- `app.focused`: `{ reason: "poll" | "blur" | "suspend" | "quit" }`
- `app.engaged`: `{ reason: "poll" | "idle" | "blur" | "suspend" | "quit" }`
- `app.uptime`: `{ reason: "disabled" | "suspend" | "quit" }`

`poll` marks a segment closed at an idle-poll boundary while the span is still open (§4) — it is the mechanism that keeps an active session durable within one poll interval; the other reasons mark real transitions.

Common fields:
- **`event_id` = `sha256Short([kind, app_run_id, occurred_start, occurred_end].join(NUL), 24)`.** This is what makes at-least-once *safe*: an outbox replay re-sends the byte-identical span, re-hashes to the same id, and `INSERT … ON CONFLICT DO NOTHING` no-ops. `kind` and `app_run_id` are in the hash so a focused/engaged pair with identical bounds, and identical-bounds spans across two launches, stay distinct.
- **`source = "app-focus-collector"`**, `parser_version = 1`, `ts_precision = "exact"`, `schema_version` = the store's own `user_version` (this data originates in-app), `ingested_at` = worker insert time.
- **`subject_id = "app"`**; **`app_run_id`** = the opaque per-launch id (persisted to the promoted column).
- **Attribution: none.** `repo_id` / `workspace_rel` / `branch` are `NULL`; `origin = "n/a"`. There are no path fields at all, so the §7.6 absolute-path write guard passes trivially and the tests assert these columns stay `NULL`.

**Why no view / no current-revision dedup.** Unlike `whisper.workflow` (re-observed as a run mutates), a focus/engaged/uptime interval is **immutable once closed** and is written exactly once (retries collapse by `event_id`). So `getAppTime` is a direct aggregation over the raw rows — no `ROW_NUMBER` window, no view.

## 6. The outbox — at-least-once delivery

The producer (main) and the store owner (worker) are different processes; the worker can crash or be intentionally stopped (delete-all). The outbox guarantees every closed span is delivered at least once, and idempotency (§5) makes "at least once" equal "exactly once" in effect.

**Protocol additions (`worker-protocol.ts`):**
- Main → worker: `{ kind: "producerEvent"; eventId: string; observation: ObservationInput }`
- Worker → main: `{ kind: "ack"; eventId: string }` — sent **only after** the write transaction commits.

**Worker side (`insights-worker-core.ts`) — atomic write, then ack.** A `producerEvent` handler runs a **single SQLite transaction** that: inserts the observation idempotently, sets `first_capture_at` once if this is the first successful write, and commits. `ack` is posted **only after** the transaction commits. Because the transaction is atomic, a crash can only leave the store fully-before or fully-after the write — never a row without its `first_capture_at`, and never metadata without its row. A replay after a crash-between-insert-and-ack therefore finds either nothing (does the full write) or the committed row (insert no-ops, `first_capture_at` already set) and acks cleanly. App-focus rows do **not** write the day-grained `coverage` table (completeness is uptime-based, §7); the atomic-then-ack rule still governs the insert + `first_capture_at`.

**Main side (`outbox.ts`, an electron-free class the `InsightsHost` composes):**
- Unacked events held in a bounded `Map<eventId, event>` (insertion-ordered).
- On produce: add to the map and post to the worker (through the host's spawn-aware `post()` queue).
- On `ack`: delete from the map.
- **Replay:** on every worker `spawn` (first start *and* every respawn), **after** config is seeded, re-post all still-unacked events. This is the crash-recovery path.
- **Bound:** cap at **500** unacked events; on overflow, drop the oldest and `log` the dropped count — never a silent truncation. Overflow is only reachable if the worker is down for a long stretch.
- **In-memory only.** Survives worker crash/respawn (the mandated case). Not persisted across a full app restart — a just-closed span lost on quit is negligible, and the mandate is worker crash. Stated explicitly so the boundary is a decision, not an accident.

**Host crash-recovery lifecycle (`insights-host.ts`).** Today the host subscribes only to worker `message` and `spawn` (`insights-host.ts:110/113`) and has **no** unexpected-exit handling — so a worker crash currently leaves a dead handle and no replay. This slice adds an `exit` listener that:
1. clears stale process state (`this.proc = null`, `spawned = false`) so the host is not wedged pointing at a dead worker;
2. **re-forks only while consent remains enabled** (a crash during a disabled/stopping state must not resurrect a worker — the deliberate `stop()`/delete-all paths set a flag the exit handler checks, distinguishing an intentional kill from a crash);
3. on the new worker's `spawn`, config is sent first (existing seed order), then the outbox replays the unacked events.

**Consent / lifecycle interactions:**
- **Consent off (`setEnabled(false)`) — race-free disable ordering (AC5):** because `produce()` posts to the worker immediately, clearing the buffer afterward cannot retract an already-posted message, so the disable path must never *emit* engagement output in the first place. The order is: (1) **disarm the collector's engagement sink** — detach focused/engaged emission and **drop** the open focused/engaged spans, so nothing engagement-related is produced at or after the disable instant; (2) emit only the **finalizing `app.uptime` interval** `[start, now]`, which certifies the consent-on observation window and is required for truthful completeness (§7); (3) stop the worker (kill / closeStore) and mark the stop intentional so the `exit` handler does not re-fork; (4) clear the buffer. Engagement segments already posted by an earlier poll are pre-disable, legitimately-consented captures, not new capture. The engagement-vs-metadata split is deliberate: user-activity time is dropped on disable; the observation-window metadata that says *how much of the consented period was watched* is finalized.
- Delete-all → the existing `closeStore` → `storeClosed` handshake runs (an intentional stop); a re-enable brings up a fresh v1 store and any still-unacked events replay and insert idempotently.
- Master kill (`usageTelemetry.enabled = false`) → same as consent off.

## 7. Read surface & completeness

A second named query parallel to `getWhisperRuns`, over the same correlated-request IPC machinery (`InsightsHost.query` pattern, requestId-correlated, timeout-guarded).

```ts
getAppTime(range: { fromMs: number; toMs: number }): {
  focusedMs: number;
  engagedMs: number;
  completeness: "complete" | "partial" | "unknown";
}
```

- **Duration = clip-to-range**, explicitly different from `getWhisperRuns`' start-inclusion. `getWhisperRuns` counts discrete runs; app time *accumulates duration*, so a span straddling a boundary is **clipped**: for each `app.focused`/`app.engaged` span, add `max(0, min(occurred_end, toMs) − max(occurred_start, fromMs))`. `focusedMs` sums `app.focused`; `engagedMs` sums `app.engaged`.
- **Completeness = coverage of the range by recorded `app.uptime` intervals — never "a span touched this day."** A live forward-only collector knows nothing about app time during intervals it was not running, so certifying a whole day from the mere presence of a span would falsely certify unobserved time (e.g. before a consent-off gap earlier that day). Instead: intersect the query range with the union of `app.uptime` intervals, then report `complete` iff the union covers the entire range, `partial` iff it covers some, `unknown` iff none. A consent-off (or app-closed) gap within a day is an interval with no `app.uptime` coverage → the range that includes it is `partial`, never `complete`.
- This is a **deliberately different completeness mechanism from the archiver's day-grained `coverage` table**, and correctly so: the archiver reads the *entire* source for a day and can certify the day; a forward-only live collector can certify only the sub-day intervals it actually watched, which the boolean day table cannot express. App-focus therefore writes no `coverage` rows.
- **Truthful under retention:** `app.uptime` observations are pruned like any observation (by `event_ts` on the `OBSERVATION_RETENTION_DAYS` horizon), so once a day's uptime rows age out, ranges over that day revert to `unknown` — the same lockstep property the archiver gets from coverage pruning, achieved here via observation pruning.

**Plumbing:** `worker-protocol.ts` gains `appTime` in the `InsightsQuery` union and an `AppTimeResult`; `insights-worker-core` branches its `query` handler on `query.name` and computes the aggregation (sum + uptime-interval coverage); `insights-host` gains `queryAppTime(range)`; `insights-ipc` + preload + the shared contract expose it — the same six-file read path the Phase 1 query bridge established.

## 8. Consent, privacy, retention

- **Consent & master kill:** unchanged. The collector runs only while effective consent is on; it is started/stopped on the same `setEnabled` path as the worker, so master kill and the per-sub-preference toggle both silence it with no new setting.
- **Privacy:** app spans carry **no path and no content** — `repo_id`/`workspace_rel`/`branch` are `NULL`, payloads are a single enum close-reason, `app_run_id` is opaque. The §7.6 absolute-path write guard still runs (now covering `app_run_id`) and has nothing to reject.
- **Retention:** inherited unchanged. `pruneRetention` deletes observations past `OBSERVATION_RETENTION_DAYS` by `event_ts`; app spans (whose `event_ts` is the span end) age out on the same clock, and `getAppTime` completeness reverts to `unknown` for a range whose `app.uptime` rows were pruned — never a false `complete`.

## 9. File / module layout

```
services/insights/
  worker-protocol.ts          -- add producerEvent/ack, appTime query + AppTimeResult (edit)
  insights-worker-core.ts     -- producerEvent handler: ONE txn {insert + first_capture_at}, ack AFTER commit; appTime query branch (edit)
  outbox.ts                   -- bounded unacked buffer; ack removal; replay list (new, electron-free)
  app-focus/
    focus-core.ts             -- pure focus/idle/uptime span state machine (new, electron-free)
  store/
    observations.ts           -- add app_run_id to ObservationInput + COLUMNS + bind + abs-path guard (edit)
    payload-schemas.ts        -- strict app.focused/app.engaged/app.uptime reason schemas (edit)
    app-time-view.ts          -- getAppTime: clip-to-range sums + uptime-interval completeness (new)
electron/main/services/
  insights-host.ts            -- compose outbox; produce(); worker `exit` listener → clear state + consent-gated re-fork; replay-after-config on spawn; queryAppTime(); start/stop collector with setEnabled (edit)
  app-focus-collector.ts      -- Electron shell: BrowserWindow focus/blur + powerMonitor idle poll/suspend + before-quit flush + app_run_id; E2E-gated injectable signals (new)
electron/main/
  insights-ipc.ts             -- expose insights:queryAppTime; wire collector window ref + app lifecycle; register E2E-only __insightsTest channel (inject signals + crashWorker) (edit)
electron/preload/index.ts     -- expose insights.queryAppTime; expose __insightsTest under AI14ALL_E2E (edit)
shared/contracts/commands.ts  -- AppTimeResult mirror type + queryAppTime contract (edit)
tests/unit/insights/
  app-focus/focus-core.test.ts        -- span state-machine cases incl. uptime open/close (new)
  outbox.test.ts                      -- ack/replay/bound/idempotent-replay (new)
  store/app-time-view.test.ts         -- clip-to-range sums + uptime completeness + gap→partial (new)
  store/observations.test.ts          -- persist app_run_id; NULL attribution retained; reject non-enum payload (edit/new)
  insights-worker-core.test.ts        -- producerEvent atomic write + ack-after-commit + replay-after-partial-write; appTime query (edit)
  insights-host.test.ts               -- produce→post, ack→remove, unexpected-exit→consent-gated re-fork→config-first→replay (edit)
tests/e2e/insights.test.ts            -- inject focus/idle via seam; getAppTime nonzero; forced worker crash → replay, no double-count (edit)
```

## 10. Edge cases

- **Unexpected worker exit (crash)** → host `exit` listener clears state and re-forks *only if consent is still enabled*; the new worker gets config first, then unacked spans replay. An intentional `stop()`/delete-all kill sets a flag so the same exit does **not** re-fork.
- **Crash between insert and ack** → the write is one atomic transaction, so the store is fully-before or fully-after; replay is a clean full-write or a clean no-op, and `first_capture_at` is never left unset for a persisted row.
- **Disable→enable within one UTC day** → two `app.uptime` intervals with a gap; `getAppTime` over the day is `partial`, never a false `complete` — the gap is never certified.
- **Uninterrupted active session** → focused/engaged spans are segmented at each idle poll, so a durable `app.focused` (and `app.engaged`) row exists within one poll interval and `getAppTime` is nonzero **before any blur or flush** (AC1).
- **System sleep → resume** → `powerMonitor` `suspend` closes any open focused/engaged span (reason `suspend`) and the uptime interval, so sleep time is never counted or certified. `powerMonitor` `resume` opens a **new** uptime interval; if the window is focused a new focused span opens (engaged on next input), else the collector awaits `focus`. Suspend→resume therefore yields two uptime intervals with the sleep gap uncertified.
- **Disable with an open span / in-flight producer message** → the collector's engagement sink is disarmed and open focused/engaged spans are dropped *before* any worker delivery, so no engagement is written at or after consent-off; only the finalizing `app.uptime` interval (consent-on window) is written (§6).
- **Graceful quit** → `before-quit` flushes open spans and closes the uptime interval (reason `quit`); in-memory outbox events not yet acked at quit are lost by design (negligible).
- **In-progress uptime never persisted (crash / still-running)** → completeness under-certifies (`unknown`/`partial`) rather than over-certifies — the safe direction.
- **Blur with no open focused span** (spurious/duplicate) → ignored; no negative or zero-length row.
- **Idle already past threshold when focus arrives** → the focused span opens, but no engaged span opens until the first input.
- **Idle poll granularity** → an engaged span closes at `pollNow − idleSeconds*1000`, the true moment input stopped, so the 15 s poll never inflates `app_engaged_ms`.
- **Backward wall-clock jump** → a span with `end < start` is clamped to zero duration, never negative.
- **Span straddling UTC midnight** → written as one row; `getAppTime` clip-to-range attributes the correct ms to each queried range; uptime coverage math is interval-based so midnight is not special.
- **Rapid focus/blur flicker** → many tiny raw spans; the view sums them (no min-span floor — YAGNI).
- **Duplicate delivery** (replay after a crash) → same `event_id` → one row (content-hash idempotency).
- **First capture is an app span, no whisper present** → `first_capture_at` is set on the first producer write, so the one-time notice fires from app-focus capture alone.
- **Non-enum payload** → `insertObservation`'s strict zod parse throws before any write; surfaced as an `{ kind: "error" }`, never a junk row.

## 11. Test plan

Host-Node ABI (vitest), mirroring Phase 1's split of electron-free core tests + a real-Electron e2e.

- **`focus-core` state machine** (no Electron): a focus→(poll)→(poll)→blur sequence yields **contiguous** `app.focused` segments (reason `poll`) that sum to the total focused duration, the last closed on `blur`; an idle-poll crossing the threshold closes `app.engaged` at `pollNow − idle` (reason `idle`) while an input-present poll emits an engaged segment (reason `poll`); input resuming opens a new engaged span; engaged never exists outside a focused span; **`suspend`→`resume` closes the uptime interval and opens a new one**; **`stop` (disable) drops open focused/engaged spans (no row) but finalizes the `app.uptime` interval** (reason `disabled`); `quit`/`flush` close open spans; a backward-time span clamps to zero.
- **`outbox`**: produce adds + posts; `ack` removes; a still-unacked event is re-listed for replay; overflow past 500 drops the oldest and reports the dropped count; replay of an already-inserted event is idempotent (same `event_id` → one row).
- **`store/observations`**: an `app.focused`/`app.engaged`/`app.uptime` observation persists its `app_run_id` to the promoted column and keeps `repo_id`/`workspace_rel`/`branch` `NULL`; a payload with a `reason` outside the kind's enum is rejected by the strict schema (throws, no row).
- **`app-time-view` (`getAppTime`)**: sums `focusedMs`/`engagedMs` correctly; a boundary-straddling span is clipped to the ms inside the range; a fully-outside span contributes zero; completeness is `complete` when uptime covers the range, `partial` across a disable→enable gap in one UTC day, `unknown` with no uptime; a pruned day reverts to `unknown`.
- **`insights-worker-core`**: a `producerEvent` inserts once inside one transaction, sets `first_capture_at` once, and posts `ack` only after commit; a **replay-after-partial-write** case (an event whose row already exists but whose ack was lost) re-runs the atomic transaction, adds no second row, leaves `first_capture_at` intact, and re-acks; the `appTime` query returns the aggregated result.
- **`insights-host`**: `produce` posts a `producerEvent` and buffers it; an `ack` clears the buffer; an **unexpected worker `exit`** clears process state and re-forks a new worker **while consent is enabled**, sends config first, then replays unacked events — and does **not** re-fork when the stop was intentional (`setEnabled(false)`/delete-all); `queryAppTime` resolves the correlated result and falls back to empty with no worker; `setEnabled(false)` stops the collector and clears the buffer. **AC5 disable regression:** with an open focused span **and a producer message already in-flight**, `setEnabled(false)` disarms the engagement sink first so no `app.focused`/`app.engaged` row is created from the disable moment, delivers only the finalizing `app.uptime` interval, and does not re-fork.
- **e2e** (extends `tests/e2e/insights.test.ts`): with the **bounded test seam** (`AI14ALL_E2E`-gated `window.ai14all.__insightsTest`), inject `focus` then an **active idle-poll** (idle below threshold) to force a segment, and **query `getAppTime` before any `blur`/`flush`** — asserting nonzero focused/engaged within the poll window (AC1) over the real IPC/query path; then inject more activity, issue the seam's `crashWorker` command mid-flight, and assert the buffered span is replayed after the host re-forks the worker, with `getAppTime` not double-counting it; also inject `suspend`→`resume` and assert a second `app.uptime` interval. The seam accepts only the enumerated signals (`focus`, `blur`, `idle`, `suspend`, `resume`, `flush`, `crashWorker`) and exists only under the E2E flag.

## 12. Acceptance criteria (definition of done for this slice)

1. With consent on, the app-focus collector runs in the main process, observes real `BrowserWindow` focus/blur and `powerMonitor` idle/suspend/resume, and emits `app.focused`/`app.engaged`/`app.uptime` intervals that reach the store. Because focused/engaged spans are **segmented at each idle poll**, an uninterrupted active session persists a durable row within one poll interval, so `getAppTime(range)` returns nonzero `focusedMs`/`engagedMs` for an active period **before any blur or flush**.
2. The worker-side write is a single atomic transaction (insert + `first_capture_at`) and `ack` is posted only after it commits; a span delivered more than once — including a replay after a simulated crash between insert and ack — produces exactly one row with consistent metadata, and `getAppTime` never double-counts it.
3. A closed span survives an unexpected worker exit: the host clears its stale process state, re-forks the worker **only while consent is enabled**, sends config first, then replays the unacked span, which is inserted. An intentional stop/delete-all does not re-fork.
4. The outbox is bounded (500) and reports dropped events rather than silently truncating; it clears on `setEnabled(false)`.
5. Consent off (either toggle) → the collector's engagement sink is disarmed and open focused/engaged spans are **dropped before any worker delivery**, so no engagement is written at or after consent-off even with an open span and an in-flight producer message; only the finalizing `app.uptime` interval (consent-on window) is written; the buffer is cleared and the worker is not re-forked. Delete-all still works via the host-owned path.
6. App spans store no path and no content: `repo_id`/`workspace_rel`/`branch` are `NULL`, `app_run_id` is persisted to its promoted column, payloads pass the strict per-kind schema (non-enum reasons rejected) and the absolute-path guard; provenance is complete on every row.
7. `getAppTime(range)` uses clip-to-range duration and derives completeness from recorded `app.uptime` intervals only, so a disable→enable gap within a UTC day yields `partial` and no unobserved interval is ever certified `complete`.
8. Sleep/suspend and graceful quit close open focused/engaged spans and the uptime interval so neither sleep nor post-quit time is counted or certified; `powerMonitor` `resume` reopens a new uptime interval (and a focused span if focused), so collection and completeness continue after resume.
9. No schema migration (store stays v1); the full unit suite passes on the host-Node ABI and the app still builds/runs on the Electron ABI; the extended insights e2e drives the bounded test seam (synthetic focus/idle **queried before any blur/flush**, suspend→resume, and a forced worker crash) against the real IPC/query path and passes.

## 13. Risks

- **`powerMonitor` is system-wide idle, not app-specific.** `getSystemIdleTime()` reports idle across all apps, so "engaged" means focused **and** the machine saw input somewhere. This is the accepted definition of engagement (input-driven); documented, not a defect, and `app.focused` still captures foreground time independently.
- **Wall-clock, not monotonic.** Spans use `Date.now()`; NTP/DST jumps are handled by the zero-clamp, but a forward jump inflates a single open span. Rare and bounded to one span; acceptable.
- **In-memory outbox loses buffered-but-unacked spans on a full app crash.** Deliberate (§6); the mandate is worker crash. A disk-backed outbox is an additive follow-up if this loss proves material.
- **Uptime under-certification during long sessions.** The in-progress uptime interval is certified only after it closes, so completeness reads `partial`/`unknown` for the current session until the collector stops or the app quits. This under-certifies (safe) and matters only to a future dashboard; a periodic-heartbeat refinement is a follow-up if needed.
- **Test-seam surface.** The E2E-gated `__insightsTest` channel must be strictly flag-guarded and accept only enumerated signals, or it becomes an injection surface in production. Covered by the flag gate and enumerated-signal validation.
- **Row volume from poll-boundary segmentation.** Segmenting focused/engaged at the 15 s poll produces up to ~4 focused + ~4 engaged rows per active minute (thousands/day under heavy use), all pruned on the retention horizon. Acceptable for SQLite; if it ever matters, a coarser segment cadence or a read-time open-span snapshot is an additive follow-up — the durable segment stays the crash-safe source of truth.

## 14. Follow-ups (later slices, not this one)

- **Workspace collector** — active-worktree spans; the view then joins app-focus spans against workspace-active spans for **per-project** engaged time.
- **Terminal and agent-session collectors** — the remaining Phase 2 producers, each reusing this outbox and crash-recovery lifecycle.
- **Per-day `getAppTime` series** — a daily projection for charting, added once the dashboard chart is chosen.
- **Uptime heartbeat** — refresh the open uptime interval periodically so long live sessions certify sooner, if the dashboard needs it.
- **Disk-backed outbox** — only if app-crash loss proves material.
