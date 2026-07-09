# Arc B — Host Slice (watcher + sender) Design

**Date:** 2026-07-08
**Status:** Child spec of the Arc B umbrella (`2026-07-08-arc-b-push-wake-design.md`). Built by its own ai-whisper SDD workflow in an ai-14all worktree (one workflow per repo). **Consumes the ai-xavier phone slice's shipped contract** (`@ai-creed/command-contract` v3) — do not start host implementation until that version is published/vendored.
**Repo:** ai-14all (worktree; the main tree is app-controlled — never edit tracked files directly).

---

## Goal

Deliver the ai-14all half of push-wake: the `register`/`deregister-push-token` capability handlers + a one-slot token store, the workflow-lifecycle watcher, the content-free Expo push sender, and the per-decision audit. On a qualifying whisper transition, the host sends a content-free wake to the paired phone.

## Codebase recon at SDD start (do first, in the worktree)

This spec fixes WHAT and the interfaces; the following are pinned against the live ai-14all codebase + whisper DB at the start of the host SDD (not visible from ai-xavier):

- **Exact whisper status strings** — pinned at design review against the live DB and codebase: raw `workflows.status` values are `running | paused | halted | done | canceled` (`shared/models/ecosystem-plugin.ts:75`; live `~/.ai-whisper/state.db` shows exactly `running`, `halted`, `done`, `canceled`). There is no raw `completed`, `failed`, or `escalated` status — `done` is the terminal success status (the UI lens renders it as "completed", `src/features/workflows/logic/workflow-lens.ts:38-40`), failures surface as `halted` with a `halt_reason`, and escalation is a separate relay-chain signal (see Deliverable 3). Re-confirm against the live DB at implementation start; the `state.db` read path already exists in `services/plugins/whisper/whisper-store-reader.ts` (`readActiveWorkflow`, `readEscalatedChain`) — reuse it.
- **Detection point:** raw `state.db` read vs. ai-14all's existing session/attention model (it computes `SamanthaSessionTransition` with `from`/`to` attention). Either is acceptable; the source of truth is the whisper workflow lifecycle.
- **Module layout:** where the capability registry/executor lives (the acting path is `xbp-acting-executor.ts`; audit is `services/diagnostics/acting-audit-logger.ts`), and where to start/stop the watcher in the host lifecycle.
- **Store location:** the XBP store dir is `<userData>/ai-14all/xbp/` (holds `identity.enc`, `paired-device.enc`, `audit.jsonl`); the push token store slots in there.
- **Poll interval** (start ~2–5s) and the **audit record shape**.

## Global Constraints (inherited from the umbrella; every task honors these)

- **Content-free payload.** The Expo push carries no session id, no category, no content — a test asserts it. Expo/APNs see only a ping at time T.
- **Token at rest via safeStorage, fail-closed.** Never plaintext, never logged. One slot (one device).
- **Handlers return a value, never throw for an expected refusal** (`mem-…-546dda` pt 1): the handler always returns a schema-valid `RegisterPushTokenResult`/`DeregisterPushTokenResult`; only an unexpected throw becomes a protocol rejection (the fail-closed net).
- **Second factor = pairing grant alone.** No extra token; `control:notify` gates these capabilities.
- **Capability-only.** No new authority beyond storing "where to ping."
- **Push is best-effort; pull is authoritative.** Any failure degrades to "phone sees it on next open."

## Deliverables

### 1. Capability handlers (`register`/`deregister-push-token`)
Register handler validates the token and stores it, returns `{ ok:true, registeredAt }` or a structured refusal (`push-disabled` when the host feature is off, `invalid-token`, `internal`). Deregister clears the slot, returns `{ ok:true, deregisteredAt }` or refusal. Both follow the executor's return-a-value/never-throw pattern (`xbp-acting-executor.ts` is the reference).

### 2. Token store (one slot)
Persist exactly one Expo push token at rest via safeStorage in `<userData>/ai-14all/xbp/` (e.g. `push-token.enc`), mirroring the identity/paired-device store. Register overwrites; deregister clears. **Clear the token whenever the paired device is forgotten/replaced** (`mem-…-a525fc`: today that is the manual `paired-device.enc` removal path; wire token-clear to the same device-forget point so a re-paired/reset phone never inherits a stale registration). Also cleared on dead-token cleanup (below).

### 3. Workflow-lifecycle watcher
Poll the whisper workflow lifecycle on the recon'd interval; a **pure transition-detection module** takes the previous snapshot + current rows and returns qualifying events. Two qualifying signals, both raw `state.db` reads (the watcher operates on raw values — display labels such as "completed" belong to the UI lens, `workflow-lens.ts`, and must not appear in the trigger set):

- **Status transitions** INTO the raw terminal/attention set `{done, halted}` (whisper's `workflows.status`; known raw values are `running | paused | halted | done | canceled`). `done` is the terminal success status (rendered as "completed" in the UI); there is no raw `failed` status — failures arrive as `halted` with a `halt_reason`. `canceled`/`cancelled` excluded, unknown/ambiguous status ignored.
- **Escalation events** — escalation is NOT a `workflows.status` value; it is a relay-chain signal the host already reads via `readEscalatedChain` (`whisper-store-reader.ts`), identified by `chainId`. A newly escalated chain (unseen `chainId`) is a qualifying event.

Coalesced (one workflow-end = one event; one escalated chain = one event). Requirements: persist **last-seen + last-pinged** (statuses and escalation `chainId`s) so a host restart neither re-pings settled workflows nor misses a transition; only emit while a token is registered. The polling loop is a thin I/O shell around the pure module.

### 4. Content-free Expo push sender
On a qualifying event, POST to the Expo Push API targeting the stored token with a content-free payload (fixed body constant). Response handling: `DeviceNotRegistered` → clear the token + audit (stop pinging a gone device); other transient errors → bounded retry then give up (pull-on-open covers the miss); no token stored → no send.

### 5. Audit
- **Register/deregister** are dispatched XBP requests → the **protocol layer** (`XbpAuditSink` in `Peer.dispatchRequest`) already writes one entry each. No extra semantic entry required for these (`mem-…-546dda` pt 2).
- **Each push send** is host-initiated (not a dispatched request) → write an explicit **semantic** append-only audit entry (trigger type, timestamp, outcome: sent / dead-token-cleared / retry-exhausted), following the `ActingAuditLogger` pattern. Audit stays local — never in the push.

## Interfaces consumed (from the phone slice)

- `@ai-creed/command-contract` v3: `registerPushTokenCapability` / `deregisterPushTokenCapability`, `RegisterPushTokenArgs` `{ expoPushToken, platform }`, the result unions, `PushTokenErrorCode`, `CONTROL_NOTIFY = "control:notify"`, `COMMAND_CONTRACT_VERSION === 3`. The host registers these capabilities in its registry and grants `control:notify` at pairing — concretely: add `CONTROL_NOTIFY` to `NEW_PAIRING_GRANTS` in `services/xbp/xbp-grants.ts`, and the stored-device replay path (`grantsForStoredDevice`) must carry it across restarts; a pre-v3 device record without the grant loads fail-closed (denied until re-paired), matching the existing `control:act` pattern.

## Testing

- **Transition-detection (the heart):** table-driven — previous snapshot + current rows → qualifying events; INTO raw `{done, halted}` only (raw status strings, never display labels — a `completed` or `failed` row must be treated as unknown and ignored); new escalated `chainId` qualifies, already-seen `chainId` does not; canceled/cancelled excluded; unknown ignored; coalescing; nothing emitted with no token registered. Restart persistence covers **both halves**: (a) no re-ping — a workflow already in last-pinged does not emit again after restart; (b) no missed transition — persisted last-seen has the workflow `running` before shutdown, first post-restart snapshot has it `done` (or a new escalated `chainId` that appeared while the host was down) → must emit. The detector diffs against the *persisted* last-seen; a test must reject an implementation that baselines the first post-restart snapshot.
- **Token store:** persist / overwrite / clear; one slot; at-rest bytes are ciphertext — the stored file never contains the raw token string (no-plaintext assertion); safeStorage unavailable → write fails closed (nothing persisted, register surfaces a structured refusal, token never logged); cleared on device-forget AND on device replacement — a re-paired/reset phone must not inherit the previous registration.
- **Handlers:** valid token → `{ok:true}`; feature off → `push-disabled`; bad token → `invalid-token`; never throws for expected refusals.
- **Authorization (`control:notify`):** protocol-level, not just handler-level — both capabilities are exposed under `control:notify` and nothing else; a peer without the grant gets a protocol denial and the handler is never invoked; pairing mints `control:notify` (`NEW_PAIRING_GRANTS`); the grant persists and replays for a stored device across host restart (`grantsForStoredDevice`); a pre-v3 stored device record without the grant is denied fail-closed until re-paired.
- **Sender:** content-free payload assertion (no session id/category/content); `DeviceNotRegistered` → token cleared; transient error → bounded retry then give up.
- **Audit:** a send writes exactly one semantic entry with the right outcome; register/deregister rely on the protocol-layer entry (no double-audit).

## Verification (slice-local)

ai-14all's test + typecheck + lint suite green in the worktree; the new watcher/token-store/handler/authorization/sender/audit tests pass; no regression in the existing acting/session-report suites.

## Sequencing

1. **Blocked on the phone slice's contract** — `@ai-creed/command-contract` v3 published/vendored first (operator-gated `write:packages`, `mem-…-e8fed5`).
2. **End-to-end acceptance** (real whisper transition → real ping → real phone wake over Tailscale) needs the Arc A merge on `master` + a live TestFlight build. Build + unit-green here without them; the manual pass waits.

## Non-goals / deferred

- No phone code (phone slice). No contract changes (owned by ai-xavier — the phone slice ships v3). No in-app host unpair UI (Arc C fixes the unpair gap `mem-…-a525fc`). No NSE, no category in payload. No idle/stuck trigger.
