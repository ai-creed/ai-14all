# Push-Wake v2 — Agent-Attention Triggers + Visible Banner (2026-07-28)

**Status:** ratified (design approved by operator 2026-07-28)
**Supersedes in part:** `2026-07-08-arc-b-push-wake-design.md` (payload shape §"Notification richness"; trigger domain). Arc B's cardinal rule is unchanged: push is a best-effort, content-free wake hint; the phone pulling over sealed XBP is authoritative.
**Runs in parallel with:** relay production deployment (`2026-07-23-relay-production-deployment-design.md`, ratified 2026-07-28) — no shared code, separate repos.
**Child spec:** `2026-07-28-push-wake-v2-14all-design.md` — the ai-14all host work, synced into the ai-14all **dev-integration** worktree (`docs/superpowers/specs/`) alongside a copy of this umbrella, per the arc's umbrella/child pattern. This umbrella is authoritative for decisions and rationale; the child is authoritative for host file paths and task decomposition. No ai-xavier child exists — this repo has no production code this round.

## 1. Context — why the operator has never received a push

Arc B (2026-07-08) shipped most of the push chain, but the two ends do not meet:

1. **The host sends a silent ping.** `push-wake-sender.ts` (ai-14all) posts `{ to, _contentAvailable: true }` — no title, no body. iOS renders nothing for a silent push and throttles background delivery aggressively. Even a perfect trigger produces no visible notification.
2. **The phone's NSE never runs.** The Notification Service Extension (`apps/phone/native/nse/`, built and shipping in every TestFlight build since the `with-nse` plugin landed) rewrites banners by pulling the sealed session report over XBP and applying `BannerPolicy`. But iOS invokes an NSE only for a **visible** push carrying `mutable-content: 1` — which the sender never sends. The NSE is dormant.
3. **The trigger domain is whisper-workflows only.** `push-wake-detector.ts` fires on workflow transitions into `{done, halted}` plus `escalated`. The operator's daily dogfood is agent terminal sessions (claude/codex PTYs); an agent asking a question fires no event.

Additionally, the one-time ops prerequisites (APNs credentials on the EAS project, host toggle, `control:notify` grant + token registration) have never been verified end to end.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Payload shape | Visible push: constant title `"Xavier — something needs you"` + `mutableContent: true` + `sound: "default"`. No body, no data. | Activates the already-built NSE; sidesteps iOS silent-push throttling. Still strictly content-free — the title is a compile-time constant; Expo/APNs learn only "a ping happened at time T". |
| Banner content | NSE pulls the sealed report over XBP and rewrites the banner (`BannerPolicy` phrases). On pull failure the generic title stands. | On-device decryption preserves E2E; graceful degradation never drops a notification. |
| Trigger set (new) | Agent-session transitions **into** `{waiting, failed}` (`AgentAttentionState`). | "Agent needs you" is the daily-driver buzz. `ready` (task finished awaiting review) is **excluded** — the operator declined finished-task pings as noise. |
| Trigger set (kept) | Whisper-workflow `done`/`halted`/`escalated`, unchanged. | Already built; zero cost to keep. (Workflow-done stays — the operator kept whisper events wholesale.) |
| Anti-noise | Once-per-transition; 60s global coalesce; suppress while phone connected. See §5. | Bounded interruptions; the pull shows the aggregate anyway. |
| Contract | No change. | `register-push-token` / `deregister-push-token` ship already; the wire payload carries no new fields. |
| Phone / NSE code | No change expected; **verify, don't assume** (§7). | The NSE was built for exactly this payload shape. |

**B1 invariant narrowed:** Arc B stated the "Needs you" queue membership (`{waiting, failed, ready}`) equals the push triage set. With `ready` excluded from triggers, the invariant becomes *push triggers ⊂ queue membership*. The queue still shows `ready` sessions; the phone just doesn't buzz for them. `attention-queue.ts`'s comment should be updated when next touched.

## 3. Scope

**In scope (ai-14all):** sender payload change; a second, agent-attention detector; watcher wiring for both detectors with the anti-noise rules; audit outcomes; unit tests; the ops-gate runbook.

**In scope (ai-xavier):** this spec; the device-verification runbook results doc. No production code change expected.

**Out of scope:** contract changes; Android verification (no Android artifact exists yet — the payload is platform-neutral, so nothing forecloses it); repeat-reminder escalation for long-ignored sessions; per-trigger user settings (the single `isPushWakeOn` toggle remains the only control).

## 4. Component — sender payload (ai-14all `services/xbp/push-wake-sender.ts`)

The wire payload becomes:

```json
{ "to": "<expoPushToken>", "title": "Xavier — something needs you", "mutableContent": true, "sound": "default" }
```

- `_contentAvailable` is dropped — the NSE path does not need background wake, and mixing alert + content-available muddies delivery semantics.
- The title is a module constant and MUST mirror `GENERIC_BANNER` in `apps/phone/src/push/push-banner.ts` and `BannerPolicy.generic` in `NotificationService.swift`'s policy — string-for-string, same rule as the phrase table.
- Everything else in the sender is unchanged: no-token short-circuit, bounded retry, `DeviceNotRegistered` → clear token, token never logged, never throws.
- The content-free property is now an invariant to test: the payload object contains exactly the four keys above, and no value derives from event data.

## 5. Component — agent-attention detector + watcher wiring (ai-14all)

A second pure detector, sibling to `push-wake-detector.ts`, watches per-session `AgentAttentionState` (the same authoritative source the XBP session-report reads — `shared/models/agent-attention`) and emits an event when a session transitions into the trigger set `{waiting, failed}`:

- **Entering the set** from any non-member state (`active`, `idle`, `ready`, unknown, or first sight) → event.
- **Escalation within the set** — `waiting → failed` → event (failure is materially new information). The reverse (`failed → waiting`) also fires: it means a new question after a failure. Practically: any *changed* value inside the set fires; an unchanged value never re-fires.
- **Leaving the set** re-arms the session; no event.

Seen-state persists via the existing `PushWakeStateStore` pattern (a second keyed store or a namespaced extension — implementer's choice), with Arc B's ordering rule intact: **persist before send**. A crash between the two loses a ping (the pull covers it); the reverse order could re-ping a settled session, which is forbidden.

The watcher (existing `push-wake-watcher.ts` cadence, 3s tick) runs both detectors and applies, in order:

1. **Enabled gate** — `xbpService.getStatus().enabled && isPushWakeOn()` (unchanged).
2. **Suppress-while-connected** — if the host currently holds a live, authenticated phone connection, skip the send and audit `suppressed-connected`. No existing signal expresses this (the SDK peer is connectionless and pairing-ceremony state is reset after confirmation); the child spec §3 defines it as socket-liveness AND recent authenticated capability request (45s window). Known edge: iOS may keep the socket up ~30s after backgrounding; the recency half bounds that window, and a ping lost to the residue is recovered by the pull on next open. Accepted.
3. **Global coalesce** — if any ping (either detector) was sent within the last 60s, skip and audit `coalesced`. Pings are content-free, so one ping already summons the user to the aggregate state.
4. **Send** — one content-free ping regardless of how many events the tick produced.

Audit log gains `suppressed-connected`, `coalesced`, and `persist-failed` alongside the existing `sent` / `dead-token-cleared` / `retry-exhausted`, and starts auditing the previously-silent `no-token` skip; entries carry detector attribution. The exact entry type, the persist-failed fail-quiet rule, and the audited-vs-silent path table are the child spec's §2–§4.

## 6. Data flow

```
agent session → attention state change (waiting/failed)
  host detector (3s poll) ──persist seen-state──► sender
      │ suppressed if phone connected / coalesced <60s
      ▼
  Expo push API ──► APNs ──► iOS displays visible push (mutable-content)
                                   │
                                   ▼
                            XavierNSE wakes (~30s budget)
                              ├─ dials host over sealed XBP (ReportClient)
                              ├─ pulls session report, decrypts on-device
                              └─ rewrites banner: "Waiting on your answer" / "Failed" …
                                   │ (pull fails → generic title stands)
                                   ▼
                            user taps → app opens → wake-intent: refresh + Hub
                            (authoritative state ALWAYS from the pull, never the push)
```

## 7. Verification of the dormant pieces (assumed-working, must be proven)

The NSE and phone registration path have never run against a real visible push. The implementation must verify, in order:

1. **Payload → NSE handshake:** a TestFlight build receives the new payload and `NotificationService.swift` executes (observable via the rewritten banner or the generic-title fallback).
2. **NSE report pull:** with the host reachable (LAN or Tailscale), the banner shows a real phrase; with the host unreachable, the generic title stands within the NSE time budget.
3. **Phrase sync:** `BannerPolicy.phrases` still mirrors `status-vocabulary.ts` string-for-string (both files changed since the NSE landed — diff them).
4. **Registration chain:** current pairing carries `control:notify`; the phone's token is registered and loadable by the sender (re-pair if the grant predates the capability).

Any failure here is a bug to fix inside this workstream, not a deferral.

## 8. Failure modes

| Failure | Behaviour | Recovery |
| --- | --- | --- |
| Push delivery fails / throttled | No banner | Arc B rule: pull on next open shows the state. Bounded retry already in sender. |
| NSE pull fails (host unreachable, timeout) | Generic banner "Xavier — something needs you" | User opens app → pull. Degradation, not loss. |
| Token dead (`DeviceNotRegistered`) | Token cleared, audited | Phone re-registers on next connect (existing state-action). |
| Crash between persist and send | Ping lost | Pull covers it; never re-pings a settled session. |
| Phone backgrounded but socket lingers | Ping suppressed as "connected" until the 45s authenticated-recency window lapses | Pull on next open. Accepted edge (§5.2); bounded by the recency half of the signal. |
| Attention flaps (waiting↔active rapidly) | At most one ping per 60s globally | Coalesce + once-per-transition bound the noise. |

## 9. Ops gate (runbook, one-time)

1. **EAS push credentials:** `eas credentials -p ios` — confirm an APNs key is configured for `com.xavier.phone`; create one if absent.
2. **Entitlement:** confirm `aps-environment` is present in the shipping build (prebuild output / build log).
3. **Host toggle:** push-wake enabled in ai-14all settings (`isPushWakeOn`).
4. **Pairing grant:** `control:notify` granted; token registered (visible in host audit / token store). Re-pair if needed.
5. **End-to-end buzz:** with the app closed and phone locked, drive an agent session into `waiting` → a banner arrives and shows the rewritten phrase. Record PASS/FAIL in the runbook results doc (ai-xavier `docs/superpowers/runbooks/`).

## 10. Testing strategy

- **Unit (ai-14all):** detector transition table (enter/escalate/re-arm/first-sight/unknown states); payload content-free invariant (exact four keys, constant title, nothing event-derived); watcher ordering (persist-before-send, fail-quiet on persist failure), suppression, and coalesce; audit outcomes.
- **E2E (ai-14all, Playwright):** cumulative-suite coverage of the new user-visible behavior (attention transition → recorded content-free POST; suppression while the fake phone is connected) — child spec §6; required by ai-14all's AGENTS.md, and not substituted by the manual device gate (§9.5).
- **Existing suites stay green:** whisper detector tests unchanged; sender tests updated for the new payload.
- **Conformance:** the NSE's XCTest conformance suite (`XavierNSETests`) already covers envelope/crypto; not re-run unless NSE code changes.
- **Device (manual, gated):** §9.5 — the only check code cannot prove.

## 11. Repos and sequencing

- **ai-14all** owns all production code changes. Per the multi-repo rule, its work runs as its own workflow/plan in that repo (dev-integration worktree), with the **child spec** `2026-07-28-push-wake-v2-14all-design.md` as its input — not this umbrella.
- **ai-xavier** owns this spec + the results runbook. If `attention-queue.ts`'s B1 comment is updated, that is a one-line docs-comment change riding along with unrelated phone work — not a task here.
- **Relay deployment proceeds in parallel** (separate spec, ratified same day). Push does not depend on the relay: the ping path is host → Expo → APNs (outbound), and the NSE/pull path reaches the host over LAN/Tailscale today, gaining the relay URL automatically once deployed (it is just another entry in `connect.urls`).

## 12. Task decomposition

Host-side task detail (file paths, transition table, gate order) lives in the child spec's §7 — three tasks: sender payload, agent-attention detector, watcher wiring. The remaining unit is cross-repo operator work:

- **Ops gate + device verification** — umbrella §9 executed against a TestFlight build; results recorded in an ai-xavier runbook (`docs/superpowers/runbooks/`).
