# Push-Wake v2 — ai-14all child: visible banner + agent-attention triggers

**Date:** 2026-07-28 · **Status:** approved design, pre-implementation · **Runs as:** SDD in ai-14all (**dev-integration worktree** — `mem-2026-07-09`)
**Parent umbrella:** `2026-07-28-push-wake-v2-agent-attention-design.md` (authoritative for decisions & rationale; synced alongside this file)
**Sibling:** none — ai-xavier has no production code this round. The umbrella owns the phone/NSE verification mandate and the ops-gate runbook; every code deliverable lands here.

This child scopes the ai-14all host work: change the push payload from silent to a **visible, still content-free banner** (which activates the phone's dormant NSE), add an **agent-attention detector** so terminal-session dogfood finally fires pushes, and wire both detectors through the watcher with the three anti-noise rules. File paths below were verified against the **dev-integration worktree** — not master — on 2026-07-28.

---

## 1. Sender payload (`services/xbp/push-wake-sender.ts`)

The wire body becomes exactly:

```json
{ "to": "<expoPushToken>", "title": "Xavier — something needs you", "mutableContent": true, "sound": "default" }
```

- `_contentAvailable` is **dropped**. The visible-alert + `mutable-content` pair is what invokes the phone's NSE; background wake is not needed and mixing alert with content-available muddies APNs delivery semantics.
- The title is a **module constant**, exported for tests. It MUST mirror `GENERIC_BANNER` in ai-xavier `apps/phone/src/push/push-banner.ts` and `BannerPolicy.generic` in `apps/phone/native/nse/BannerPolicy.swift` **string-for-string** — same rule as the phrase table. Value: `Xavier — something needs you` (em dash U+2014).
- Everything else is unchanged: `send()` still takes no arguments (content-freedom by construction — event data *cannot* reach the payload), no-token short-circuit, bounded retry (3 × 1s), `DeviceNotRegistered` → `clearToken()` + `dead-token-cleared`, 10s fetch timeout, token never logged, never throws.
- **Endpoint seam (for §6's E2E task):** the sender gains an optional `endpoint` dep, defaulting to `EXPO_PUSH_ENDPOINT`. The `index.ts` wiring passes `process.env.AI14ALL_PUSH_WAKE_ENDPOINT` when set (test-only override). The seam must live in the main-process wiring because the sender's fetch runs in the main process — Playwright `page.route` cannot intercept it (`mem-2026-05-20`).
- **New invariant to test:** the posted body has exactly the four keys above; `title` is the constant; no value derives from event data.

## 2. Agent-attention detector (new: `services/xbp/push-wake-attention-detector.ts`)

A pure detector, sibling to `push-wake-detector.ts` (whisper), watching per-session attention.

**Source of truth:** the same provider the XBP `session-report` capability serves the phone from — `createSessionReportProvider(...)` (`services/plugins/samantha/session-report-provider.ts`, wired at `electron/main/index.ts:496` as `xbpSessionReport`, consumed by `xbp-peer-session.ts` `getSessionReport`). The detector polls that provider's `SessionReportResult.sessions[]` and reads each entry's `attention` string. Using the identical source guarantees the detector, the phone's Hub queue, and the NSE banner can never disagree about a session's state.

**Trigger set:** `{ "waiting", "failed" }` — the top two of `AGENT_ATTENTION_RANK` (`shared/models/agent-attention.ts`). `ready` is **excluded** by operator decision (finished-task pings declined as noise); `stale`/`active`/`idle` are calm.

**Transition rules** (per session, keyed by `worktreeId`):

| Previous → current | Fires? | Why |
| --- | --- | --- |
| non-member (or first sight) → `waiting` or `failed` | ✅ | Entering the trigger set |
| `waiting` → `failed`, `failed` → `waiting` | ✅ | Changed value inside the set = materially new information |
| `waiting` → `waiting`, `failed` → `failed` | ❌ | Unchanged; never re-fires |
| member → non-member | ❌ (re-arms) | Leaving the set re-arms the session |
| session absent from a **resolved** report — including a validly empty `sessions: []` | ❌ (prune seen-state; re-arms) | A resolved report is authoritative: `buildSessionReport` legitimately returns zero sessions when no identities remain (`samantha-command-capabilities.ts:65-74`) |
| provider poll **rejects** | ❌ (skip the attention pass) | Unavailability surfaces as a rejected promise, never a blank result (`session-report-provider.ts:17` propagates source failures); no advance, no prune, no fire |

**Empty vs unavailable.** The whisper source's blank-read ambiguity (`mem-2026-07-03`: blank ≠ vanished) does **not** transfer to this source, because the provider contract separates the two cases by construction: failure → rejection (skip the pass, state untouched); success → a schema-validated report whose `sessions: []` is a true statement that no sessions remain (prune everything; every session re-arms). Required regression — **last session disappears/reappears**: a session seen at `waiting` → a resolved empty report prunes it → it reappears at `waiting` → fires again as first sight. Counterpart: `waiting` → rejected poll → `waiting` again = no prune, no fire.

**Seen-state:** persisted by `PushWakeStateStore` (`services/xbp/push-wake-state-store.ts`) in **one composite document** — §3's one-save-per-tick invariant needs a single atomically written file, so the "separate file" option is withdrawn. The exact v2 schema, owned by Task 2:

```ts
export type PushWakeWatcherStateV2 = {
	version: 2;
	whisper: PushWakeSeenState;   // existing shape, untouched: workflows, pingedWorkflows, pingedChains
	attention: {                   // this detector's namespace — the two detectors never share fields
		sessions: Record<string, "waiting" | "failed">; // worktreeId → last seen trigger-set member
	};
	lastPingAt: number | null;     // §3 gate 3's coalesce timestamp
};
```

`load()` migrates: a legacy v1 file (today's bare `PushWakeSeenState`) becomes `{ version: 2, whisper: <legacy>, attention: { sessions: {} }, lastPingAt: null }`; an unreadable/invalid file stays `null` (fresh baseline — never re-pings, today's fail direction, and a lost `lastPingAt` merely permits one earlier ping). Arc B's ordering rule is inherited verbatim: **persist before send** — a crash between the two loses a ping (the phone's pull covers it); the reverse order could re-ping a settled session, which is forbidden.

**Persistence must be observable.** `PushWakeStateStore.save()` today swallows write failures (`push-wake-state-store.ts:41`), so call ordering alone cannot prove the invariant — a send after a failed save is exactly the forbidden re-ping setup. The store's contract changes: `save()` returns `boolean` — `true` only after a successful durable write, `false` (plus the existing warn log) on failure. **Fail-quiet rule:** when the pre-send `save()` returns `false`, the watcher must not call the sender and must not advance its in-memory seen-state; the next tick re-detects the same transitions and retries the save (self-healing). The skip is audited as `persist-failed` (§4). Direction check: refusing to send on failed persist can only lose a ping (the pull covers it), never duplicate one.

**Expected overlap:** a whisper workflow halt can both fire the whisper detector (`workflow-halted`) and flip the session's attention to `failed` (firing this detector). That double-fire is by design and harmless — the global coalesce (§3) collapses it to one ping.

## 3. Watcher wiring (`services/xbp/push-wake-watcher.ts` + `electron/main/index.ts:660`)

One watcher, same 3s tick (`PUSH_WAKE_POLL_INTERVAL_MS`), runs **both** detectors per tick and applies gates in order:

1. **Enabled** — `(xbpService?.getStatus().enabled ?? false) && isPushWakeOn()`. Unchanged.
2. **Suppress-while-connected** — if the host holds a live, authenticated phone connection, skip the send and audit `suppressed-connected`. **No existing signal expresses this** — it must be built:
   - `pairingHost.activePeer()` is **not** the signal. It reports the pairing ceremony's confirmed keys (SDK `host.ts`), and `confirmPairing` calls `resetPairingHost()` immediately after confirmation (`xbp-host-service.ts:313`), so it reads `null` for the entire life of a working pairing. It is a key-exchange artifact, not liveness.
   - Actual socket state is closure-private in `createAttachableTransport()` (`attachable-transport.ts:22-24`), and the SDK `Peer` is connectionless — it authenticates individual frames, with no session/connection concept.
   - **The signal, `XbpHostService.hasLivePhoneConnection()`, binds authenticated recency to the socket that carried it.** (A global AND of "any socket open" and "any recent authed call" is unsound: after the phone disconnects, an unrelated unauthenticated socket opened inside the recency window would satisfy both halves.)
     a. **Socket generations** — `createAttachableTransport()` assigns each attached socket a monotonically increasing generation id and exposes `currentInboundGeneration(): number | null` (the generation of the socket that delivered the frame being dispatched — the transport's `active` socket) and `isSocketLive(generation: number): boolean` (that specific socket is still open). Surfaced through `createLanWebSocketHost()`'s return; covers LAN accepts and relay accept-dials alike, since both attach to the same transport.
     b. **Bound authenticated stamp** — `XbpPeerSession` takes the two accessors as a new optional dep and, inside its capability choke point (the `killGuard` wrapper, stamped *before* the kill-switch check — kill switch halts capability execution, never connectivity), records `lastAuthedConnection = { generation: currentInboundGeneration(), at: now() }`; cleared in `detach()`; exposed as a getter.
   - `hasLivePhoneConnection()` ⇔ `lastAuthedConnection !== null && isSocketLive(lastAuthedConnection.generation) && now − lastAuthedConnection.at ≤ PUSH_WAKE_CONNECTED_WINDOW_MS (= 45_000)`. A scanner's socket carries a different generation than the stamp, so it can never sustain suppression no matter when it connects; the phone's own socket closing releases suppression immediately regardless of what other sockets exist.
   - **Accepted race (bounded):** the generation is read at handler dispatch, a microtask after frame arrival, so a frame from another socket interleaved in that gap could mis-bind one stamp. The consequence is either an early release (a ping goes through — the safe direction) or suppression tied to a socket that must still be open and expires within one 45s window; both bounded, neither the forbidden direction.
   - The window stays fresh by causality: an attention change emits `session-changed`, a connected phone re-pulls `session-report`, and that authenticated request refreshes the stamp — so the phone is suppressed exactly while it demonstrably hears about changes. The iOS ~30s socket-linger edge shrinks: a backgrounded phone stops calling, so suppression lapses within the window even while the socket lingers; a ping lost to that residue is recovered by the pull on next open.
3. **Global coalesce** — if any ping attempt (either detector) occurred within the last **60s**, skip and audit `coalesced`. Exact semantics of the timestamp (the `lastPingAt` field of the composite state, §2):
   - It records the last **attempt**, not the last success: it advances for every tick that passes gates 1–3 and reaches the sender, **regardless of outcome** (`sent`, `retry-exhausted`, `dead-token-cleared`, raced `no-token`). Duplicate pings are the forbidden direction; a ping suppressed after a failed attempt is recovered by the pull. (The umbrella's §5 wording is aligned to these attempt-reservation semantics.)
   - It advances **only** on ticks that actually reach gate 5 — suppressed and coalesced ticks must not touch it, or a flapping session could extend the coalesce window indefinitely without a single ping going out.
   - It advances **before** the send, written in the same pre-send `save()` that persists the seen-state advance — so a crash or restart mid-send cannot double-ping (the timestamp is already durable). A failed pre-send `save()` means no send at all (§2 fail-quiet rule), so the timestamp never lies about an attempt that was refused.
4. **Persist** — every eventful tick, whatever the decided outcome, writes **one** `save()` of the composite state (§2) carrying both detectors' advanced seen-state — plus `lastPingAt := now()` when, and only when, the tick is proceeding to gate 5. On `false`: no send, no in-memory advance, audit `persist-failed` (once per failure streak — below).
5. **Send** — at most **one** content-free ping per tick regardless of how many events both detectors produced (the current per-event send loop at `push-wake-watcher.ts:46-51` does not survive).

**Skip paths consume transitions.** The umbrella's once-per-transition decision holds *through* skips, not just sends: on a `suppressed-connected`, `coalesced`, or `no-token` tick the advanced seen-state is still persisted (gate 4 runs for every eventful tick), so the same unchanged attention or workflow state can never produce a second event, a second audit entry, or a late send on any later tick — the transition is spent, and the phone's pull is what shows the state it described. `persist-failed` is the single **non-consuming** skip: nothing advanced, the next tick re-detects and retries (§2 self-heal). Its audit entry is emitted once per failure **streak** — the first failing tick audits, consecutive failing ticks stay silent, and a successful save re-arms the streak — so a broken state dir cannot flood the audit log at 3s cadence.

**Per-detector blank scoping:** the current whole-tick early return on an empty whisper read (`push-wake-watcher.ts:40`) must become whisper-scoped, or attention detection would be blocked whenever whisper has no states — the common dogfood case this feature exists for. Each source keeps its own blank discipline: whisper `getStates().length === 0` → skip the whisper pass only (`mem-2026-07-03` unchanged for that source); attention provider rejection → skip the attention pass only (§2). Either detector proceeds alone.

The whisper detector, its `QUALIFYING = {done, halted}` set, and `escalated` handling are untouched.

## 4. Audit (`services/diagnostics/push-wake-audit-logger.ts`)

Correction to the v1 claim: today's `PushWakeAuditEntry.outcome` union is `sent | dead-token-cleared | retry-exhausted` (`push-wake-audit-logger.ts:7`) — `no-token` is a `PushSendOutcome` that is never audited, and the watcher's `hasToken()` skip is silent (`push-wake-watcher.ts:45`). This child widens the entry to make every *eventful* decision auditable:

```ts
export type PushWakeAuditEntry = {
	ts: number;
	// Primary trigger for the tick: first whisper event if any, else first attention event.
	trigger:
		| "workflow-done" | "workflow-halted" | "escalated"        // existing (whisper)
		| "attention-waiting" | "attention-failed";                 // new (attention)
	outcome:
		| "sent" | "dead-token-cleared" | "retry-exhausted"        // existing
		| "no-token"                                                // newly audited: events existed but no device is registered (pre-check or raced deregister)
		| "suppressed-connected"                                    // gate 2 skipped the send
		| "coalesced"                                               // gate 3 skipped the send
		| "persist-failed";                                         // pre-send save() returned false (§2)
	detectors: Array<"whisper" | "attention">;                    // nonempty: which detector(s) produced events that tick
};
```

**Exactly which paths audit** — one entry per tick that produced ≥ 1 detector event, whose `outcome` names what happened to it; zero entries otherwise:

| Path | Audited? |
| --- | --- |
| Gate 1 (disabled) — feature off or XBP down | ❌ silent by design: steady state at 3s cadence would flood the log |
| Tick with zero detector events | ❌ nothing to explain |
| Events, but suppressed / coalesced / no token | ✅ `suppressed-connected` / `coalesced` / `no-token` — exactly once per transition batch: these skips consume the transitions (§3), so an unchanged next tick has zero events and emits nothing |
| Events, but the composite save failed | ✅ `persist-failed` — once per failure **streak** (§3), not per tick; the transitions are *not* consumed and retry next tick |
| Events, send attempted | ✅ the sender outcome, including raced `no-token` |

The `detectors` array is what lets the trail answer "why did/didn't my phone buzz at time T" without guessing; the expected whisper+attention double-fire (§2) shows up as one entry with both detectors listed.

## 5. Out of scope (this child)

- Contract changes — none; `register-push-token` / `deregister-push-token` and the token store (`xbp-push-token-store.ts`, `xbp-push-token-handlers.ts`) ship already and are untouched.
- Phone / NSE code — owned by the umbrella's §7 verification mandate; any bug it surfaces is new work scoped there.
- Repeat-reminder escalation, per-trigger settings UI — the single `isPushWakeOn` toggle remains the only control.
- The ops gate (EAS APNs credentials, entitlement, pairing grant, end-to-end device buzz) — umbrella §9; operator work, recorded in ai-xavier's runbook.

## 6. Testing

- **Sender:** payload invariant (exact four keys, constant title, nothing event-derived); endpoint-seam override; existing retry / dead-token / no-token cases updated to the new body.
- **State store:** the composite `PushWakeWatcherStateV2` round-trips; a legacy v1 file migrates to `{ version: 2, whisper: <legacy>, attention: { sessions: {} }, lastPingAt: null }`; an unreadable/invalid file loads as `null`; `save()` returns `true` on a durable write and `false` on a write failure (injected fs error), with the warn log intact.
- **Attention detector (pure):** the full transition table above, including first-sight, unknown attention values (ignored), the **last-session-disappears/reappears** regression (valid empty report prunes; reappearance fires as first sight), and rejection-in-between (no prune, no fire).
- **Watcher (integration):** gate order (enabled → suppressed-connected → coalesced → persist → send); **two-tick assertions for every consuming skip path** — for each of `suppressed-connected`, `coalesced`, and `no-token`: tick 1 with a fresh transition emits exactly one audit entry and persists the advanced seen-state, and tick 2 with unchanged inputs emits zero events, zero audit entries, and no send (once-per-transition proven through the skip, not just the send path); **persist-failed fail-quiet** — when the composite `save()` returns `false` the sender is *not called* (spy assertion, not call-order alone) and in-memory seen-state does not advance, so the next tick retries; a continuing failure streak emits no second `persist-failed` entry, and a recovered save lets the same transition proceed to its real outcome; coalesce timestamp advances pre-send and outcome-independently, does **not** advance on suppressed or coalesced ticks, and survives a simulated restart without double-pinging; per-detector blank scoping (whisper empty read doesn't block the attention pass and vice versa); one-ping-per-tick with both detectors firing; the audit table in §4 — every ✅ row produces its exact entry, every ❌ row produces none.
- **Live-connection signal (unit):** generation binding — an authenticated call stamps the delivering socket's generation; suppression releases the moment that socket closes even while other sockets remain open; an unauthenticated socket opened after the phone disconnects (inside the 45s window) does **not** suppress; recency lapse releases suppression while the phone socket stays open; `detach()` clears the stamp.
- **E2E (Playwright suite, `tests/e2e/`)** — required by `AGENTS.md:159-160`: new user-visible behavior is not done without cumulative e2e coverage; the manual device gate (umbrella §9) does not substitute. New `tests/e2e/push-wake-attention.test.ts` on the `phone-bridge.test.ts` harness (fake-phone helper process speaking XBP, env seams, `createTestRepo`):
  1. Launch with `phoneBridge: { enabled: true, pushWakeEnabled: true }` and `AI14ALL_PUSH_WAKE_ENDPOINT` pointed at a local HTTP stub that records POST bodies (§1 seam).
  2. Fake phone pairs and registers a push token, then disconnects (so gate 2 cannot suppress).
  3. Drive a session's attention to `waiting` via the `report_session_status` MCP seam (`tests/e2e/session-attention.spec.ts` pattern).
  4. Assert exactly one POST whose body is exactly the four content-free keys with the constant title — payload and attention trigger proven end-to-end.
  5. Reconnect the fake phone (its authenticated call refreshes the recency stamp), drive a second transition (`waiting → failed`), and assert no new POST **and** an audit entry with `outcome: "suppressed-connected"` (the audit file distinguishes suppression from coalesce, since gate 2 precedes gate 3).
  Extends the suite; replaces nothing (cumulative rule).
- **Whisper suites stay green unchanged** — they are the regression guard that this child didn't disturb Arc B behavior.

## 7. Task decomposition

1. **Sender payload** — new wire body + constant export + endpoint seam + invariant tests (`push-wake-sender.ts` + its test).
2. **Agent-attention detector + watcher-state schema** — new pure module + transition-table tests; `PushWakeStateStore` owns the full §2 contract: the composite `PushWakeWatcherStateV2` shape including `lastPingAt`, the v1 migration, and `save(): boolean` (`push-wake-attention-detector.ts` + test, `push-wake-state-store.ts` + test).
3. **Live-connection signal** — socket generations (`currentInboundGeneration()` / `isSocketLive()`) on the attachable transport, surfaced through `createLanWebSocketHost()`; the generation-bound `lastAuthedConnection` stamp in `XbpPeerSession`; `hasLivePhoneConnection()` on `XbpHostService` + the §6 signal unit tests (`attachable-transport.ts`, `lan-websocket-transport.ts`, `xbp-peer-session.ts`, `xbp-host-service.ts`).
4. **Watcher wiring + audit** — both detectors, per-detector blank scoping, coalesce semantics, skip-path transition consumption with the §6 two-tick tests, persist-failed fail-quiet + streak audit, widened audit entry, `index.ts` wiring + integration tests (`push-wake-watcher.ts`, `push-wake-audit-logger.ts`, `electron/main/index.ts`) — consuming the Task 2 state schema unchanged, which is why `push-wake-state-store.ts` is absent here.
5. **E2E** — `tests/e2e/push-wake-attention.test.ts` per §6, plus the `AI14ALL_PUSH_WAKE_ENDPOINT` wiring if not landed with Task 1.

Tasks 3 and 4 each stay within the three-to-four-file envelope precisely because the signal (Task 3) is split from its consumer (Task 4); Task 4 depends on Tasks 1–3, Task 5 on all of them.
