# Samantha Integration — Slice 4 (S4): Harden — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorm complete; implementation plan pending)
**Repo footprint:** ai-14all only (Samantha-side counterpart deferred)
**Security surface:** low — S3 already landed every guard with blast radius

## Context

S4 is the fourth slice of the ai-14all ↔ ai-samantha integration. The high-level
roadmap (`docs/superpowers/specs/2026-06-21-samantha-14all-integration-highlevel-design.md`,
§5/§8) names S4 "Harden" and scopes it to four things: **reconnect**, **dedup
verification**, **integration tests**, and **GUI smoke**. (The roadmap's original
"cross-repo integration tests / both repos" wording for S4 is **deliberately amended by this
spec** — see §1 scope and §9 — to ai-14all-side hermetic integration tests now, with the
two-process cross-repo counterpart deferred. The roadmap doc is updated to match.)

S1 delivered rich observe; S2 added the benign command channel (`focus-worktree`,
`session-report`); S3 ("Real act") added the one capability with real blast radius
— `instruct-session` — behind a two-layer gate (Samantha-side voice read-back +
ai-14all-side registration token, `acting_enabled` toggle, and audit log), routing
through the sanctioned `WhisperCommand` surface or state-aware `sendInput`, rejecting
(never queueing) when not at a safe input point.

A grounding pass over the current code reframed what S4 must actually build:

- **Reconnect is mostly already built.** The driver re-registers on a 404 (Samantha
  restart), forces a fresh full snapshot on reconnect (`lastBody = null`), runs a 30s
  keep-alive PATCH, and the WS command client auto-reconnects. `samantha-driver.test.ts`
  already covers rebuild / reconnect / keep-alive / 404-recovery. **Missing is only
  polish:** both reconnect loops use a flat 3s delay — no exponential backoff, no jitter,
  no manual fast-path.
- **"Dedup" is two different things.** *Outbound* event dedup (don't re-speak the same
  `attentionRequired`) already exists and is tested — the driver diffs `lastSignals`
  before POSTing. *Inbound command* dedup (a re-sent `instruct-session` frame with the
  same `requestId` firing the instruction **twice**) is **genuinely absent**. This gap
  matters more after S3, because the command now drives a real agent.
- **Integration tests:** one happy-path e2e exists (`plugins-samantha.test.ts` —
  register / snapshot / event / focus / session-report) plus a working in-repo mock
  server. There is no `instruct-session` e2e, no reconnect-drop e2e, no crash-recovery
  e2e, and no dedup e2e.
- **GUI smoke:** absent — only an untested health link in `PluginsPanelDialog`.

So the roadmap's four-piece framing is partly already shipped. S4 completes it, with the
real new safety mechanism being **inbound command dedup**.

## 1. Goal & scope

Harden the duplex link and the S3 act path to production quality. S4 is a single slice
delivering all four pieces:

1. **Inbound command dedup** — make every command idempotent by `requestId` so a re-sent
   frame never double-executes within the dedup (TTL) window (and `instruct-session` never
   double-delivers). The cache never evicts a still-live entry, so the guarantee holds for the
   full window with no overflow loophole — see §4.
2. **Reconnect hardening** — replace flat-delay reconnect with capped exponential backoff
   plus jitter, retrying forever, and add a manual "Reconnect now" UI fast-path.
3. **Integration tests** — extend the in-repo mock server and the e2e suite to cover the
   instruct-session wired path, dedup replay, socket drop / auto-reconnect, manual
   reconnect, and crash / 404 re-register.
4. **GUI smoke** — a component test and an e2e click-through for the Samantha health
   label and the new reconnect control.

**S4 touches only ai-14all.** Dedup defends against frames Samantha *sends us*; reconnect,
backoff, the manual reconnect path, the IPC, the button, and the tests are all our side;
the integration tests run against the in-repo mock. The Samantha-side counterpart (a real
two-process harness, and the S3-deferred token *wire*) is explicitly deferred. S4 ships
without a cross-repo change. The roadmap (§5/§8) originally listed S4 as touching *both*
repos with an ai-samantha "integration test counterpart"; that entry is **deliberately
amended** to match this scoping — ai-14all-side hardening with hermetic in-repo integration
tests now, the two-process counterpart deferred — and the roadmap doc is updated accordingly
(see §9).

The security surface is low: S3 froze the trust boundary, the gates, and the routing.
S4 adds no new capability, no new acting policy, and no new external surface.

## 2. Decisions locked

- **Scope:** all four pieces in one slice (not split, not tests-only).
- **Dedup model:** dispatcher-level idempotency cache that **replays the cached
  `CommandResult` for all commands** (not acting-only, not reject-with-error). True
  idempotency for every capability.
- **Dedup placement:** a decorator wrapping the existing pure dispatcher, so the
  dispatcher stays pure and the cache is the only new state.
- **Reconnect policy:** retry forever with capped exponential backoff + jitter, **plus**
  a manual "Reconnect now" UI fast-path that resets the backoff and attempts immediately.
  No max-retry / give-up dead state.
- **Test harness:** extend the in-repo mock server for S4 ("1 for now"); the real
  two-process cross-repo harness is deferred ("2 later").
- **GUI smoke:** both layers — a component test and an e2e click-through.
- **Repo split:** ai-14all only; Samantha-side counterpart deferred.

## 3. Architecture

Four small units, each behind an existing seam. No new architecture — this is hardening.

### Component map

| Unit | New / changed | Responsibility |
| --- | --- | --- |
| **Idempotent dispatcher** | `services/plugins/samantha/idempotent-dispatcher.ts` *(new)* | Wrap the pure dispatcher; dedup commands by `requestId`. |
| **Reconnect backoff** | `services/plugins/samantha/reconnect-backoff.ts` *(new)* | Pure capped-exponential-with-jitter delay generator, shared by both reconnect loops. |
| **WS command client** | `services/plugins/samantha/samantha-command-client.ts` *(changed)* | Drive reconnect timing from a backoff instance; reset on open. |
| **Driver** | `services/plugins/samantha/samantha-driver.ts` *(changed)* | Own the HTTP backoff; wrap the dispatcher; expose `reconnectNow()`. |
| **IPC / preload** | `electron/main/index.ts` + preload/IPC contract *(changed)* | New `plugins.samantha.reconnect` channel → `driver.reconnectNow()`. |
| **Panel** | `src/features/plugins/components/PluginsPanelDialog.tsx` *(changed)* | "Reconnect now" button when disconnected. |
| **Tests** | `tests/unit/plugins/samantha/*`, `tests/e2e/plugins-samantha.test.ts`, `tests/e2e/fixtures/samantha-mock-server.ts` *(new + changed)* | Unit, integration e2e, GUI. |

The WS command client is handed the *wrapped* dispatcher, so its `dispatch → replyOn`
flow is unchanged; the only wiring change is at construction (the driver/main wraps before
injecting). Both reconnect loops swap their flat delay for a backoff instance.

## 4. Unit: Idempotent dispatcher (dedup)

### Interface

```ts
type Dispatcher = { dispatch(frame: CommandFrame): Promise<CommandResult> }

createIdempotentDispatcher(
  inner: Dispatcher,
  opts: { ttlMs: number; max: number; now?: () => number },
): Dispatcher
```

Keyed by `frame.requestId` (already a required, validated field) in an
**insertion-ordered Map**:

```ts
type Entry =
  | { state: "in-flight"; promise: Promise<CommandResult> }
  | { state: "done"; result: CommandResult; ts: number }
```

### `dispatch()` logic

1. Prune expired `done` entries (`ts + ttlMs < now()`) — lazy, no background timer.
2. If an entry exists: **in-flight → return the same promise** (coalesce, no second
   execute); **done → replay `result`** (no execute).
3. No entry → first reclaim capacity by pruning expired entries; if the Map is still at `max`
   with **every** resident entry live (within TTL), refuse with a retryable `internal` result
   **without** calling `inner` or recording an entry (back-pressure — never evict a live entry;
   see *Bounds & lifetime*). Otherwise record the **in-flight entry synchronously before
   awaiting `inner`**, then call `inner.dispatch(frame)`; on settle, overwrite to `done`, stamp
   `ts = now()`.

### Two correctness properties this buys

- **Concurrent duplicate → no double-fire.** Recording the in-flight entry *at receive*
  (not at completion) means a duplicate arriving mid-execution finds it and coalesces onto
  the same promise. If the entry were only written on completion, a concurrent duplicate
  would start a second `inner.dispatch` and the instruction would fire twice.
- **Lost-reply re-send → exactly-once.** If the socket drops *after* execute but *before*
  the ack lands (`replyOn` already refuses to send on a stale socket), Samantha re-sends
  the same `requestId` after reconnect; the `done` entry replays the original ack without
  re-delivering. The instruction reached the agent once; the ack finally arrives.

### Error results are cached too

A duplicate of a `session-busy` / `unknown-worktree` / `no-live-agent` reject replays the
same error and does **not** re-enter the ActGuard (no re-audit, no re-evaluation). Contract
consequence: **a genuine retry-for-success uses a new `requestId`** — the same `requestId`
within the window is "the same logical request, same answer." After `ttlMs` the entry
expires and that `requestId` is treated as fresh again.

### Bounds & lifetime

- In-memory only. `requestId`s are per-session; nothing should survive an app restart.
- `ttlMs` default ≈ 60s (covers a reconnect cycle plus voice latency). **TTL is the primary
  lifetime, and exactly-once holds for the full TTL window** — see *Eviction never touches a
  live entry* below.
- `max` default ≈ 256 — a memory safety valve, not the dedup horizon. Eviction is
  **TTL-driven**: only expired entries are reclaimed (oldest-expired-first). A still-live
  (within-TTL) entry is **never** evicted to make room.
- **Eviction never touches a live entry → exactly-once is preserved under overflow.** If the
  cache ever reaches `max` with *every* resident entry still live — pathological at single-user
  voice scale (>256 distinct in-flight/recent requestIds inside a 60s window is not physically
  reachable), but defended anyway — a **new** (never-seen) command is refused with a typed
  retryable `internal` result rather than evicting a live entry. Refusing a brand-new command
  cannot double-execute anything; a re-sent frame for an already-processed command always finds
  its live entry and replays. This is the one case the decorator synthesizes a result, and only
  because it means `inner` was never called and nothing executed.
- `now` injected for tests; wall-clock is fine for TTL.
- Relies on `inner` always settling to a `CommandResult` — which the S3 ActGuard already
  guarantees by converting thrown executes to `ok: false`. The decorator stays transparent: it
  never fabricates an agent outcome or a success result (its sole synthesized result is the
  back-pressure refusal above, where nothing ran), and if `inner` ever rejects (a bug), it
  deletes the in-flight entry so the `requestId` stays retryable rather than caching a poisoned
  promise.

### Audit invariant (cross-cutting)

One logical `instruct-session` produces exactly one ActGuard audit start/result pair for every
duplicate frame arriving within the TTL window — replays never re-enter the guard, and because
eviction never removes a live entry, no in-window duplicate can slip past the cache and
re-execute. This is both a property of the design and the assertion the dedup e2e checks.

## 5. Unit: Reconnect backoff + manual reconnect

### The backoff helper

```ts
createReconnectBackoff(opts: {
  baseMs: number; factor: number; capMs: number;
  random?: () => number; // injected for deterministic tests; defaults to Math.random
}): { next(): number; reset(): void; attempt: number }
```

- Curve: `raw = min(capMs, baseMs * factor ** attempt)`, then **equal jitter** —
  `delay = raw / 2 + random() * raw / 2`. Equal jitter keeps a sane floor while still
  decorrelating reconnect storms.
- Defaults ≈ `baseMs: 1000, factor: 2, capMs: 30000` → 1s, 2s, 4s … capped at 30s.
- Retries forever (no max). `random` injected purely for deterministic tests.

### Two loops, two instances

There are two independent reconnect loops today, both using a flat 3s delay: the WS
command channel (`samantha-command-client`) and the HTTP REST link
(`driver.scheduleReconnect → rebuild`). The links can fail independently (WS down while
HTTP up, or vice versa), so each gets its **own** backoff instance. Both `scheduleReconnect`
sites swap the flat delay for `backoff.next()`; on a successful open / register / PATCH the
owning loop calls `backoff.reset()` so the next outage starts from base. The WS loop resets
on socket open; the HTTP loop resets on a successful register / PATCH — never cross-reset.

### Manual reconnect (`driver.reconnectNow()`)

A fast-path that:

1. cancels any pending scheduled-reconnect timers (both loops),
2. `reset()`s both backoff instances,
3. immediately forces a fresh `command-client.open()` + `ensureRegistered()` / `rebuild()`,
4. sets health `connecting`.

`open()` / `ensureRegistered()` are already idempotent, so a manual trigger arriving while
an attempt is in-flight collapses into the running attempt — it resets the backoff and
ensures an attempt is active, and never double-opens. When already connected it is a
guarded no-op (don't churn a healthy link).

### Wiring

- New IPC `plugins.samantha.reconnect` (renderer → main invoke) → `driver.reconnectNow()`;
  preload exposes it on the existing plugins bridge.
- In `PluginsPanelDialog`'s Samantha section, a **"Reconnect now"** button shown when health
  ∈ {`reconnecting`, `samantha-not-running`} (hidden for `connected` / `connecting`). Click
  calls the IPC, disables the button, and shows a "connecting…" affordance while the attempt
  is in-flight.

### Health semantics — timing only, not states

The health states are unchanged. A connection-refused (Samantha process down) →
`samantha-not-running`; a drop on an established link → `reconnecting`; both keep retrying on
the capped curve in the background. The button is the user's escape hatch from a long
backoff wait. The 30s keep-alive PATCH failing during an outage funnels into the same
idempotent `scheduleReconnect` (single pending timer), so there is never an overlapping
reconnect loop.

### In-flight command across a drop

Needs nothing here — it is already covered by the dedup unit (replays / coalesces the
re-sent `requestId`) plus the existing "don't reply on a stale socket" guard in the command
client.

## 6. Test plan

Three layers, all hermetic in ai-14all. The real two-process harness stays deferred.

### Unit (pure units, TDD-first)

- `idempotent-dispatcher.test.ts` — fresh `requestId` calls `inner` once; duplicate replays
  without re-calling `inner`; concurrent duplicate coalesces (inner once, both get the result);
  error result is cached + replayed; entry expires after `ttlMs` (re-executes); an expired entry
  is reclaimed to admit a new command once the cache is full; **exactly-once under overflow** —
  fill the cache to `max` with live entries, then (a) a re-sent live `requestId` still replays
  without re-calling `inner`, and (b) a *new* `requestId` is refused with a retryable `internal`
  result rather than evicting a live entry (no live entry is ever re-executed); inner-rejection
  clears the entry.
- `reconnect-backoff.test.ts` — capped exponential curve (random pinned); jitter within
  `[raw/2, raw]`; `reset()` returns to base; cap respected at high attempt counts.
- `samantha-driver.test.ts` (extend) — `reconnectNow()` cancels pending timers, resets both
  backoffs, triggers an immediate open/rebuild, sets health `connecting`; backoff `reset()`
  on successful connect and `next()` on failure.
- `samantha-command-client.test.ts` (extend) — reconnect timing driven by the backoff
  instance; `reset()` on successful open.

### Integration e2e (extend the mock + `plugins-samantha.test.ts`)

New mock capabilities in `samantha-mock-server.ts`:

- `dropSocket()` — force-close the current WS (simulate a drop).
- `stop()` / `restart(port)` — bring the server down then up on the same port.
- `forgetRegistration()` — PATCH / event return 404 until a fresh `register` arrives.
- `connectionCount` / `waitForConnection(n)` — make a reconnect observable.

The e2e drives the backoff with a tiny test override (base/cap ≈ ms, like today's
`reconnectMs: 50`) so timing is fast and deterministic, with `waitForConnection` polling
instead of fixed sleeps. Scenarios:

- **instruct-session wired path** — exercise frame → idempotent dispatcher → ActGuard →
  router → result end-to-end via `mock.sendCommand`, asserting typed results on the robust
  outcomes: `acting-disabled` (default toggle off), then flip `acting_enabled` on with no
  live agent → `no-live-agent`. The full routing matrix stays in the router/guard unit
  tests; the e2e proves the wiring, not every branch, to stay non-flaky.
- **duplicate-frame replay (the dedup proof)** — with acting on and no live agent: send
  `instruct-session` `requestId` `R` → result `no-live-agent`, and `acting-audit.jsonl` gets
  one result entry; re-send the same `R` → identical result returned, audit still one entry.
  The unchanged audit count is the observable "did not re-execute."
- **socket drop → auto-reconnect** — `dropSocket()`; assert health → `reconnecting`, then a
  new WS connection appears (via `waitForConnection`) and health returns `connected`, with no
  manual action.
- **crash / restart 404 re-register** — `forgetRegistration()`; assert the driver issues a
  fresh `register` (the mock sees it) and the next PATCH succeeds; health recovers.

### GUI (both layers)

- **Component test** — `PluginsPanelDialog`'s Samantha section: render each health state via
  the `onSamanthaHealth` channel; assert the label text; assert "Reconnect now" is hidden for
  `connected` / `connecting` and visible for `reconnecting` / `samantha-not-running`; assert
  click invokes the (mocked) `plugins.samantha.reconnect` IPC; assert the disabled
  "connecting…" state while in-flight.
- **E2e click-through** — `stop()` the mock so health = `samantha-not-running` and the button
  shows; click it; `restart(port)`; assert the manual path fires an immediate reconnect (a new
  connection appears promptly, ahead of the backoff wait) and health → `connected`.

### Coverage map → the four pieces

- **Dedup** — idempotent-dispatcher unit + duplicate-frame e2e.
- **Reconnect** — backoff unit + driver `reconnectNow` unit + drop/auto-reconnect + crash/404
  e2e.
- **Integration tests** — the mock extensions + all e2e scenarios.
- **GUI smoke** — component test + manual-reconnect e2e.

## 7. Error handling & edge cases

### Dedup

- **`requestId` uniqueness is a contract precondition.** Dedup keys on `requestId`; if
  Samantha reuses one for a genuinely different command within the window, the first result is
  wrongly replayed. requestId MUST be unique per logical request (standard idempotency-key
  discipline; the frame already requires it).
- **`inner` rejection** (a bug — the dispatcher/ActGuard are settle-only by the S3 contract):
  the decorator deletes the in-flight entry (keeps the `requestId` retryable) and propagates.
  On an `inner` rejection it never manufactures a result; the "every command settles to a
  `CommandResult`" guarantee lives in the dispatcher/ActGuard, not in the decorator. (The one
  result the decorator *does* synthesize — the pathological full-of-live-entries back-pressure
  refusal in §4 — is a distinct path where `inner` is never called.)
- **`max` eviction preserves exactly-once:** eviction is **TTL-driven** — only expired entries
  are reclaimed, so a still-live entry is never evicted and a re-send within TTL always replays
  (never re-executes / re-delivers). If the cache is ever full of *live* entries (pathological:
  >256 distinct requestIds inside a 60s window, not reachable at single-user scale), a **new**
  command is refused with a retryable `internal` result rather than evicting a live entry —
  back-pressure that cannot double-execute, because nothing ran. The only degradation under
  overflow is a refused *new* command (caller retries), never a double-executed *resend*.
- **Lazy TTL prune** (on dispatch, no timer): stale entries linger during idle but are bounded
  by `max`; memory is trivial. Wall-clock `now()` is fine (a backward clock jump only
  over-extends an entry slightly).

### Reconnect / backoff

- **`reconnectNow()` while an attempt is in-flight:** `open()` / `ensureRegistered()` are
  idempotent, so a concurrent manual trigger collapses into the running attempt — it just
  resets the backoff and ensures an attempt is active; never double-opens.
- **`reconnectNow()` when already connected:** the IPC handler guards and no-ops.
- **Independent resets:** WS backoff resets on socket open; HTTP backoff resets on a successful
  register / PATCH — never cross-reset.
- **Keep-alive vs reconnect:** the 30s keep-alive PATCH failing during an outage funnels into
  the same idempotent `scheduleReconnect` (single pending timer) — no overlapping reconnect
  loops.
- **Flapping server:** `reset()` on each success means a flapping link retries from base —
  intentional (fast recovery when briefly up); fine at single-user scale.
- **Timer hygiene:** `driver.stop()` cancels all pending reconnect timers including the manual
  path; no leaks.
- **Packaged-build `hidden` gate:** the button lives in the Samantha card, which is already
  visibility-gated in packaged builds — no new handling.

### Manual-reconnect IPC / UI

- Rapid double-click → the button disables on click and the IPC is idempotent.
- IPC arriving when the driver isn't started / the plugin is disabled → graceful no-op, never
  crashes main.

### Test harness

- e2e reconnect timing → tiny injected backoff (base/cap ≈ ms) + `waitForConnection` polling,
  no fixed sleeps.
- Mock restart port reuse → prefer `forgetRegistration()` (server stays listening, returns 404)
  for the crash / re-register scenario to avoid port churn; use real `stop()` / `start(port)`
  only for the down → `samantha-not-running` → manual-reconnect scenario, rebinding the same
  port with a short retry to dodge TIME_WAIT.

## 8. Out of scope / deferred

- Real two-process cross-repo harness + the Samantha-side integration counterpart — deferred
  ("2 later").
- The S3-deferred token *wire* (Samantha-side issuance) — still deferred; S4 adds no token
  work.
- Persisting the dedup cache across restarts — unnecessary (per-session `requestId`s).
- User-facing backoff / TTL settings — internal constants only.
- `start-session` / autonomous acting / queueing — still S5+.
- Max-retry / give-up "dead" state — deliberately rejected in favor of retry-forever + the
  manual button.
- `WhisperCommand` routing and terminal-service — untouched (frozen in S3).

## 9. Cross-repo footprint

| Slice | ai-14all | ai-samantha (proprietary) |
| --- | --- | --- |
| S4 | idempotent dispatcher (dedup), reconnect backoff, manual reconnect (`reconnectNow` + IPC + button), mock-server extensions, unit + e2e + GUI tests | none in this slice — real two-process harness and token wire deferred |

The high-level roadmap (§5 build table and §8 cross-repo footprint) originally listed S4 as
touching **both** repos, with an ai-samantha *"integration test counterpart."* This spec
**deliberately amends** that contract: S4's integration tests are hermetic in-repo tests against
the extended mock server (the "1 for now" decision), and the real two-process cross-repo harness
plus the Samantha-side counterpart move to a follow-up slice ("2 later"). The roadmap doc is
updated to match — its S4 rows now read ai-14all-side hardening + hermetic integration tests now,
counterpart deferred — so the two specs no longer disagree.

## References

- `docs/superpowers/specs/2026-06-21-samantha-14all-integration-highlevel-design.md` — roadmap §5/§8, security posture §7
- `docs/superpowers/specs/2026-06-24-samantha-integration-s3-real-act-design.md` — the act path, gates, routing, and audit S4 hardens
- `services/plugins/samantha/samantha-command-dispatcher.ts` — the pure dispatcher the dedup decorator wraps
- `services/plugins/samantha/samantha-command-client.ts` — WS command channel + current flat-delay reconnect
- `services/plugins/samantha/samantha-driver.ts` — HTTP link, `scheduleReconnect`, keep-alive, 404 re-register
- `services/plugins/samantha/act-guard.ts` — the settle-only execute guarantee dedup relies on
- `tests/e2e/plugins-samantha.test.ts`, `tests/e2e/fixtures/samantha-mock-server.ts` — the e2e harness S4 extends
- `src/features/plugins/components/PluginsPanelDialog.tsx` — Samantha health surface gaining the reconnect button
