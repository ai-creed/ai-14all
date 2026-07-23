# ai-14all — insights app-focus/idle collector + at-least-once outbox (Phase 2, slice 1)

## 1. What this slice is

The first live-capture producer for the insights module: a main-process **app-focus/idle collector** that measures wall-clock app engagement as durable, idempotent interval observations, and the **at-least-once outbox** that carries them from the main process to the insights worker so a worker crash cannot drop a captured span.

It is the first of the Phase 2 collectors (§16 of the Phase 1 build spec) and is deliberately scoped to **one** producer. It is chosen first because the Phase 1 exploration (§9) names the focus/idle accumulator as the producer that most needs the outbox — its events are ephemeral and irrecoverable if not captured live — so building it first is what validates the at-least-once machinery against a real signal instead of an abstract stub.

**Why this signal.** "Time spent using the app" is a Tier-3 measure with **no existing source** (Phase 1 exploration §3.2/§4): window focus/blur are logged only to a shell-event log that is off in packaged builds and pruned at 3 days, and there is no `powerMonitor`/system-idle detection anywhere in `electron/`. This collector is the first real measurement of app time, and wall-clock engagement can come *only* from this signal — never from provider logs.

## 2. Decisions locked (from brainstorming)

1. **Live capture before UI.** Accumulate richer signals before committing to any dashboard chart; the chart shape is decided later, from data.
2. **Focus/idle collector first**, and it builds the outbox for real (the §9 interface was never actually added to `worker-protocol.ts`, so there is no dead stub to reconcile).
3. **Two measures: `app_focused_ms` and `app_engaged_ms`.** Focused = window has OS focus; engaged = focused **and** the system is not idle past a threshold. Both are captured so the dashboard can later distinguish "app in the foreground" from "actually interacting."
4. **App-level attribution, not per-worktree.** Spans carry no repo attribution in this slice. Per-worktree time needs an "active-worktree-changed-at-T" signal, which is the *workspace collector* — a separate Phase 2 producer. Coupling it in here would pull that collector forward; instead the future view joins app-focus spans against workspace-active spans.
5. **In-memory outbox** bounded and replayed on worker respawn — the mandated durability boundary is *worker* crash, not full-app crash.

## 3. Scope & boundary

**In scope:** the collector (main process), two observation kinds (`app.focused` / `app.engaged`), the outbox protocol additions + main-side replay buffer, a read measure (`getAppTime(range)` → `focusedMs`/`engagedMs`/completeness), unit tests, and an e2e extension.

**Out of scope (deliberate):**
- Per-worktree / per-workspace attribution (workspace collector, a later slice).
- The other Phase 2 collectors (workspace, terminal, agent-session).
- Any dashboard UI. This slice adds no renderer surface and no new setting.
- Durable-across-app-restart delivery (YAGNI — see §6).

**Reused unchanged:** the consent / master-kill gate (`usageTelemetry.insights.enabled` + `usageTelemetry.enabled`), the one-time notice, delete-all, the retention prune, the observation store and its content-hash idempotency, and the §7.6 privacy resolver / absolute-path write guard.

## 4. Capture mechanism

The collector lives in a new main-process module and follows the electron-free-core + thin-Electron-shell split the module already uses (mirroring `insights-worker-core` + `insights-worker`).

- **`focus-core.ts` (electron-free, unit-tested):** a pure state machine. Inputs are timestamped signals — `focus`, `blur`, `idle-poll(idleSeconds)`, `suspend`, `flush(now)`. Outputs are **closed span records** `{ kind: "app.focused" | "app.engaged", startMs, endMs, reason }`. It holds at most one open focused span and, nested within it, at most one open engaged span. No Electron, no timers, no clock of its own — the shell feeds it `nowMs`.

- **`app-focus-collector.ts` (Electron shell, thin):** wires the real signals into the core and forwards emitted spans to the host's outbox:
  - `BrowserWindow` `focus` / `blur` (the app already emits these at `electron/main/index.ts:697/713`).
  - `powerMonitor.getSystemIdleTime()` polled every **15 s** while focused (no poll while blurred — nothing to measure).
  - `powerMonitor` `suspend` and app `before-quit` → `flush`, closing any open spans so sleep/quit time is never miscounted.

**Span rules (in the core):**
- A **focused span** opens on `focus` and closes on `blur`, `suspend`, or `flush`. Its duration is `app_focused_ms`.
- An **engaged sub-span** exists only inside a focused span. It opens when input is present (idle-time `<` threshold) and closes when idle-time reaches the **threshold = 60 s** (a constant this slice, not user-configurable), or when the focused span itself closes. Its duration is `app_engaged_ms`. When the idle poll shows idle crossed the threshold, the engaged span is closed at `end = pollNow − idleSeconds*1000` (the moment input actually stopped), not at poll time — so poll granularity does not inflate engagement. On the next poll showing input resumed, a new engaged span opens at that input moment.
- **Clamp:** any span whose computed `endMs < startMs` (e.g. a backward wall-clock jump) is clamped to `endMs = startMs` (zero duration), never negative.

Spans are computed in the **main process** — the long-lived process — so a *worker* crash loses nothing already closed; main holds closed spans in the outbox until acked. A full *app* crash can lose only the single in-progress open span; graceful quit flushes it. This is exactly the boundary the §9 at-least-once mandate targets.

## 5. Observation model

Two new observation kinds on the existing `observations` spine. **No schema migration** — they are new `kind` values, and every column they need already exists and is nullable (`repo_id`/`workspace_rel`/`branch`, plus the pre-provisioned `app_run_id`). Schema stays at v1.

| kind | one row per | occurred_start / end | event_ts | measure |
| --- | --- | --- | --- | --- |
| `app.focused` | focus→blur span | span start / end | span end | `app_focused_ms` |
| `app.engaged` | engaged sub-span | span start / end | span end | `app_engaged_ms` |

Common fields:
- **`event_id` = `sha256Short([kind, occurred_start, occurred_end].join(NUL), 24)`.** This is what makes at-least-once *safe*: an outbox replay re-sends the byte-identical span, re-hashes to the same id, and `INSERT … ON CONFLICT DO NOTHING` no-ops. Only genuinely distinct spans produce distinct rows. (A focused and an engaged span with identical bounds hash differently because `kind` is in the input.)
- **`source = "app-focus-collector"`**, `parser_version = 1`, `ts_precision = "exact"`, `schema_version` = the store's own `user_version` (this data originates in-app, not from an external DB), `ingested_at` = worker insert time.
- **`subject_id = "app"`** — app spans have no natural entity id; `event_id` provides uniqueness. `app_run_id` = an id for the current app launch (so a future view can bucket by session); it is opaque and content-free.
- **Attribution: none.** `repo_id` / `workspace_rel` / `branch` are `NULL`. `origin = "n/a"`.
- **`payload = { reason: "blur" | "idle" | "suspend" | "quit" }`** — the span's close cause, allowlisted and content-free. There are no path fields at all, so the §7.6 absolute-path write guard passes trivially.

**Why no view / no current-revision dedup.** Unlike `whisper.workflow` (re-observed as a run mutates running→terminal, hence the `whisper_runs` current-revision window), a focus/engaged span is **immutable once closed** and is written exactly once (retries collapse by `event_id`). So `getAppTime` is a direct aggregation over the raw rows — no `ROW_NUMBER` window, no view.

## 6. The outbox — at-least-once delivery

The producer (main) and the store owner (worker) are different processes; the worker can crash or be intentionally stopped (delete-all). The outbox guarantees every closed span is delivered at least once, and idempotency (§5) makes "at least once" equal "exactly once" in effect.

**Protocol additions (`worker-protocol.ts`):**
- Main → worker: `{ kind: "producerEvent"; eventId: string; observation: ObservationInput }`
- Worker → main: `{ kind: "ack"; eventId: string }` — sent **after** the idempotent insert commits.

**Worker side (`insights-worker-core.ts`):** a `producerEvent` handler inserts the observation idempotently, marks `coverage` for each UTC day the span touches (a span straddling UTC midnight marks both days), sets `first_capture_at` once on the first successful write (so app-focus capture alone can drive the one-time notice on a machine with no whisper), and posts `ack`. Delivery of the notice still rides the existing per-tick `status` message, so no extra push is needed from this path.

**Main side (`outbox.ts`, an electron-free class the `InsightsHost` composes):**
- Unacked events held in a bounded `Map<eventId, event>` (insertion-ordered).
- On produce: add to the map and post to the worker (through the host's existing spawn-aware `post()` queue).
- On `ack`: delete from the map.
- **Replay:** on every worker `spawn` (first start *and* every respawn), after config is seeded, re-post all still-unacked events. This is the crash-recovery path.
- **Bound:** cap at **500** unacked events; on overflow, drop the oldest and `log` the dropped count — never a silent truncation. Overflow is only reachable if the worker is down for a long stretch (consent off, or a wedged worker not respawning); at one span every few minutes, 500 is hours of buffer.
- **In-memory only.** Survives worker crash/respawn (the mandated case). Not persisted across a full app restart — a just-closed span lost on quit is negligible, and the mandate is worker crash, not app crash. Stated explicitly so the boundary is a decision, not an accident.

**Consent / lifecycle interactions:**
- Consent off → the collector is not running and produces nothing; the outbox is empty. `setEnabled(false)` stops the collector and clears the buffer.
- Delete-all → the existing `closeStore` → `storeClosed` handshake runs; replay is paused while the store closes; a re-enable brings up a fresh v1 store and any still-unacked events replay and insert idempotently.
- Master kill (`usageTelemetry.enabled = false`) → same as consent off.

## 7. Read surface

A second named query parallel to `getWhisperRuns`, over the same correlated-request IPC machinery (`InsightsHost.query` pattern, requestId-correlated, timeout-guarded).

```ts
getAppTime(range: { fromMs: number; toMs: number }): {
  focusedMs: number;
  engagedMs: number;
  completeness: "complete" | "partial" | "unknown";
}
```

- **Inclusion = clip-to-range**, explicitly different from `getWhisperRuns`' start-inclusion. `getWhisperRuns` counts discrete runs (a run belongs to the one period it started in). App time *accumulates duration*, so a span straddling a range boundary is **clipped**: for each span of the kind, add `max(0, min(occurred_end, toMs) − max(occurred_start, fromMs))`. `focusedMs` sums `app.focused`; `engagedMs` sums `app.engaged`. Naming this rule explicitly is the same discipline §10.4 applied to the whisper query.
- **`completeness`** is derived from `coverage` for `source = "app-focus-collector"`, exactly like the archiver: `complete` if every UTC day the range touches is marked complete, `partial` if some are, `unknown` if none. It stays truthful under retention because `coverage` is pruned in lockstep with `observations` (§8).

**Plumbing:** `worker-protocol.ts` gains `appTime` in the `InsightsQuery` union and an `AppTimeResult`; `insights-worker-core` branches its `query` handler on `query.name`; `insights-host` gains `queryAppTime(range)`; `insights-ipc` + preload + the shared contract expose it — the same six-file read path the Phase 1 query bridge established.

## 8. Consent, privacy, retention

- **Consent & master kill:** unchanged. The collector runs only while effective consent is on; it is started/stopped on the same `setEnabled` path as the worker, so master kill and the per-sub-preference toggle both silence it with no new setting.
- **Privacy:** app spans carry **no path and no content** — `repo_id`/`workspace_rel`/`branch` are `NULL`, the payload is a single enum close-reason, `app_run_id` is opaque. The §7.6 absolute-path write guard still runs and has nothing to reject.
- **Retention:** inherited unchanged. `pruneRetention` deletes observations past `OBSERVATION_RETENTION_DAYS` by `event_ts` and prunes `coverage` in lockstep on the same UTC-day horizon; app spans (whose `event_ts` is the span end) age out on the same clock, and `getAppTime` completeness reverts to `unknown` for a pruned day — never a false `complete`.

## 9. File / module layout

```
services/insights/
  worker-protocol.ts          -- add producerEvent/ack, appTime query + AppTimeResult (edit)
  insights-worker-core.ts     -- handle producerEvent (idempotent insert + coverage + first_capture + ack); appTime query branch (edit)
  outbox.ts                   -- bounded unacked buffer; ack removal; replay list (new, electron-free)
  app-focus/
    focus-core.ts             -- pure focus/idle span state machine (new, electron-free)
  store/
    app-time-view.ts          -- getAppTime aggregation (clip-to-range sum + coverage completeness) (new)
electron/main/services/
  insights-host.ts            -- compose outbox; produce(); replay on spawn; queryAppTime(); start/stop collector with setEnabled (edit)
  app-focus-collector.ts      -- Electron shell: BrowserWindow focus/blur + powerMonitor idle poll/suspend + before-quit flush → host.produce (new)
electron/main/
  insights-ipc.ts             -- expose insights:queryAppTime; wire collector's window ref + app lifecycle (edit)
electron/preload/index.ts     -- expose insights.queryAppTime (edit)
shared/contracts/commands.ts  -- AppTimeResult mirror type + queryAppTime contract (edit)
tests/unit/insights/
  app-focus/focus-core.test.ts        -- span state-machine cases (new)
  outbox.test.ts                      -- ack/replay/bound/idempotent-replay (new)
  store/app-time-view.test.ts         -- clip-to-range sums + completeness (new)
  insights-worker-core.test.ts        -- producerEvent handling + appTime query (edit)
  insights-host.test.ts               -- produce→post, ack→remove, respawn→replay (edit)
tests/e2e/insights.test.ts            -- focus/idle → getAppTime nonzero, survives worker restart (edit)
```

## 10. Edge cases

- **System sleep / resume** → `powerMonitor` `suspend` closes any open focused/engaged span (reason `"suspend"`), so sleep time is never counted as focused. A later `focus`/input reopens fresh spans.
- **Graceful quit** → `before-quit` flushes open spans (reason `"quit"`); the outbox is in-memory, so events not yet acked at quit are lost by design (negligible, single span).
- **Blur with no open focused span** (spurious/duplicate) → ignored; no negative or zero-length row.
- **Idle already past threshold when focus arrives** → the focused span opens, but no engaged span opens until the first input (idle-time drops below threshold).
- **Idle poll granularity** → an engaged span closes at `pollNow − idleSeconds*1000`, the true moment input stopped, so the 15 s poll never inflates `app_engaged_ms`.
- **Backward wall-clock jump** (NTP/DST) → a span with `end < start` is clamped to zero duration, never negative.
- **Span straddling UTC midnight** → written as one row; `coverage` marks **both** UTC days it touches; `getAppTime` clip-to-range attributes the correct ms to each queried range.
- **Rapid focus/blur flicker** → many tiny raw spans; the view sums them (no min-span floor — YAGNI).
- **Worker down at produce time** (consent flip mid-span, or crash) → the span is buffered and replayed on respawn; bounded at 500 with a logged drop count.
- **Duplicate delivery** (replay after a crash that occurred between insert and ack) → the re-sent span has the same `event_id` → one row (content-hash idempotency).
- **First capture is an app span, no whisper present** → `first_capture_at` is set on the first producer write, so the one-time notice fires from app-focus capture alone.

## 11. Test plan

Host-Node ABI (vitest), mirroring Phase 1's split of electron-free core tests + a real-Electron e2e.

- **`focus-core` state machine** (no Electron): a focus→blur sequence yields one `app.focused` span with the right bounds; an idle-poll crossing the threshold splits `app.engaged` at `pollNow − idle`; input resuming opens a second engaged span; engaged never exists outside a focused span; `suspend`/`flush` close open spans with the right reason; a backward-time span clamps to zero.
- **`outbox`**: produce adds + posts; `ack` removes; a still-unacked event is re-listed for replay; overflow past 500 drops the oldest and reports the dropped count; replay of an already-inserted event is idempotent (same `event_id` → one row).
- **`app-time-view` (`getAppTime`)**: sums `focusedMs`/`engagedMs` correctly; a boundary-straddling span is clipped to the ms inside the range; a fully-outside span contributes zero; `completeness` reflects `coverage` (`complete`/`partial`/`unknown`); a pruned day reverts to `unknown`.
- **`insights-worker-core`**: a `producerEvent` inserts once, marks coverage for each touched UTC day, sets `first_capture_at` once, and posts `ack`; a duplicate `producerEvent` inserts no second row but still acks; the `appTime` query returns the aggregated result.
- **`insights-host`**: `produce` posts a `producerEvent` and buffers it; an `ack` clears the buffer; a worker respawn replays unacked events after config; `queryAppTime` resolves the correlated result and falls back to an empty result with no worker; `setEnabled(false)` stops the collector and clears the buffer.
- **e2e** (extends `tests/e2e/insights.test.ts`): drive synthetic focus/idle, assert `getAppTime` returns nonzero focused/engaged, and that a worker restart mid-flight replays the buffered span without double-counting.

## 12. Acceptance criteria (definition of done for this slice)

1. With consent on, the app-focus collector runs in the main process, observes real `BrowserWindow` focus/blur and `powerMonitor` idle, and emits `app.focused`/`app.engaged` spans that reach the store; within the poll interval `getAppTime(range)` returns nonzero `focusedMs`/`engagedMs` for a period the user was active.
2. A span delivered more than once (outbox replay after a simulated worker crash between insert and ack) produces exactly one row (content-hash idempotency); `getAppTime` never double-counts it.
3. A closed span survives a worker respawn: it is buffered in the main-side outbox and replayed after the worker restarts, then inserted.
4. The outbox is bounded (500) and reports dropped events rather than silently truncating; it clears on `setEnabled(false)`.
5. Consent off (either toggle) → no collector, no producing, empty buffer, no store writes. Delete-all still works via the host-owned path.
6. App spans store no path and no content: `repo_id`/`workspace_rel`/`branch` are `NULL`, payload is a single enum reason, and the absolute-path write guard passes; provenance (`source`/`ts_precision`/`parser_version`/`schema_version`/`ingested_at`) is complete on every row.
7. `getAppTime(range)` uses clip-to-range accumulation (a boundary-straddling span contributes only its in-range ms) and derives `completeness` from `coverage` consistent with retention.
8. Sleep/suspend and graceful quit close open spans so neither sleep nor post-quit time is counted as focused/engaged.
9. No schema migration (store stays v1); the full unit suite passes on the host-Node ABI and the app still builds/runs on the Electron ABI; the insights e2e (extended) passes.

## 13. Risks

- **`powerMonitor` is system-wide idle, not app-specific.** `getSystemIdleTime()` reports idle across all apps, so "engaged" means focused **and** the machine saw input somewhere — a user reading a long doc in the focused app with no input reads as idle. This is the accepted definition of engagement (input-driven); it is documented, not a defect, and the raw `app.focused` span still captures foreground time independently.
- **Wall-clock, not monotonic.** Spans use `Date.now()`; NTP/DST jumps are handled by the zero-clamp, but a forward jump inflates a single open span's duration. Rare and bounded to one span; acceptable for this measure.
- **In-memory outbox loses buffered-but-unacked spans on a full app crash.** Deliberate (§6); the mandate is worker crash. If a later signal proves this loss material, a disk-backed outbox is an additive follow-up.
- **Collector/host coupling.** The collector must start/stop exactly with effective consent; a leak (collector running while disabled) would produce with no consumer. Covered by the `setEnabled` host test.
- **Idle-poll cost.** A 15 s timer only while focused is negligible; no poll while blurred.

## 14. Follow-ups (later slices, not this one)

- **Workspace collector** — active-worktree spans; the view then joins app-focus spans against workspace-active spans for **per-project** engaged time.
- **Terminal and agent-session collectors** — the remaining Phase 2 producers, each reusing this outbox.
- **Per-day `getAppTime` series** — a daily projection for charting, added once the dashboard chart is chosen.
- **Disk-backed outbox** — only if app-crash loss proves material.
