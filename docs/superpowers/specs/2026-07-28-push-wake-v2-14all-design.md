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
| session disappears from the report | ❌ (prune seen-state) | Mirror the whisper detector's prune discipline; a blank/empty read never advances or prunes (`mem-2026-07-03`: blank ≠ vanished) |

**Seen-state:** persisted via the `PushWakeStateStore` pattern (`services/xbp/push-wake-state-store.ts`) — a second namespaced key or file in the same `xbpDir`, implementer's choice; do not commingle with the whisper detector's state. Arc B's ordering rule is inherited verbatim: **persist before send** — a crash between the two loses a ping (the phone's pull covers it); the reverse order could re-ping a settled session, which is forbidden.

**Expected overlap:** a whisper workflow halt can both fire the whisper detector (`workflow-halted`) and flip the session's attention to `failed` (firing this detector). That double-fire is by design and harmless — the global coalesce (§3) collapses it to one ping.

## 3. Watcher wiring (`services/xbp/push-wake-watcher.ts` + `electron/main/index.ts:660`)

One watcher, same 3s tick (`PUSH_WAKE_POLL_INTERVAL_MS`), runs **both** detectors per tick and applies gates in order:

1. **Enabled** — `(xbpService?.getStatus().enabled ?? false) && isPushWakeOn()`. Unchanged.
2. **Suppress-while-connected** — if the host holds a live phone peer session, skip the send and audit `suppressed-connected`. The existing signal is `pairingHost.activePeer()` (`services/xbp/xbp-host-service.ts:293`); expose it through the host service (e.g. a `hasActivePeer()` on `XbpHostService` or a field on `getStatus()`) rather than reaching into `pairingHost` from `index.ts`. Known accepted edge: iOS can keep the socket alive ~30s after backgrounding; a ping suppressed in that window is recovered by the pull on next open.
3. **Global coalesce** — if any ping (either detector) was sent within the last **60s**, skip and audit `coalesced`. The coalesce timestamp persists with the seen-state so a restart cannot double-ping.
4. **Send** — at most **one** content-free ping per tick regardless of how many events both detectors produced.

The whisper detector, its `QUALIFYING = {done, halted}` set, and `escalated` handling are untouched.

## 4. Audit (`services/diagnostics/push-wake-audit-logger.ts`)

Two new outcomes alongside `sent` / `dead-token-cleared` / `retry-exhausted` / `no-token`:

- `suppressed-connected` — gate 2 skipped the send.
- `coalesced` — gate 3 skipped the send.

Entries carry which detector(s) produced events that tick (`whisper` / `attention` / both) so the audit trail can answer "why did/didn't my phone buzz at time T" without guessing.

## 5. Out of scope (this child)

- Contract changes — none; `register-push-token` / `deregister-push-token` and the token store (`xbp-push-token-store.ts`, `xbp-push-token-handlers.ts`) ship already and are untouched.
- Phone / NSE code — owned by the umbrella's §7 verification mandate; any bug it surfaces is new work scoped there.
- Repeat-reminder escalation, per-trigger settings UI — the single `isPushWakeOn` toggle remains the only control.
- The ops gate (EAS APNs credentials, entitlement, pairing grant, end-to-end device buzz) — umbrella §9; operator work, recorded in ai-xavier's runbook.

## 6. Testing

- **Sender:** payload invariant (exact four keys, constant title, nothing event-derived); existing retry / dead-token / no-token cases updated to the new body.
- **Attention detector (pure):** the full transition table above, including first-sight, unknown attention values (ignored), empty-read no-advance/no-prune, and disappear-prune.
- **Watcher (integration):** gate order (enabled → suppressed-connected → coalesced → send); persist-before-send observable ordering; one-ping-per-tick with both detectors firing; coalesce persistence across a simulated restart; audit outcomes for every skip path.
- **Whisper suites stay green unchanged** — they are the regression guard that this child didn't disturb Arc B behavior.

## 7. Task decomposition

1. **Sender payload** — new wire body + constant export + invariant tests (`push-wake-sender.ts` + its test).
2. **Agent-attention detector** — new pure module + transition-table tests (`push-wake-attention-detector.ts` + test; touches `push-wake-state-store.ts` only if the namespacing needs it).
3. **Watcher wiring** — both detectors, suppression (host-service exposure), coalesce, audit outcomes, `index.ts` wiring + integration tests (`push-wake-watcher.ts`, `xbp-host-service.ts`, `electron/main/index.ts`, `push-wake-audit-logger.ts`).

Task 3 exceeds three files by one; if the reviewer balks, split the host-service `hasActivePeer()` exposure into its own micro-task ahead of it.
