# Slice 2b.2 — Acting: session-lifecycle capabilities over XBP (design)

- **Date:** 2026-07-02
- **Status:** Ratified — all design decisions are final (the two previously-tentative calls, §Ratified 1 and 2, are settled). Ready for the implementation plan.
- **Owner repos:** ai-xavier (`packages/command-contract` — the vocabulary) + ai-14all (host wiring + executors — the bulk of the work)
- **Predecessor:** Slice 2b.1 (live host edge — the phone pairs with the real ai-14all and reads live `session-report` over a `Peer`)

## Context & goal

Everything shipped so far is read-only *supervision*: the phone pairs with ai-14all over LAN and observes live sessions via the `session-report` capability (`control:read`). This slice adds the first *control* — the phone can **pause, resume, and stop** a running agent session from anywhere on the LAN, through the same sealed+signed+paired XBP channel.

**2b.2 goal (the demoable milestone):** from the paired phone, pause a running managed whisper workflow on ai-14all and watch it halt; resume it and watch it continue; stop it and watch it end — each action envelope-authenticated, permission-gated under a new `control:act`, executed on ai-14all's real authority, and audited.

This is the brief's core-loop pivot from "see what agents are doing" to "act on it," kept deliberately narrow: three naturally-idempotent lifecycle operations, no approval workflow.

## Scope note — descoped from the original 2b.2

The 2b.1 spec anticipated 2b.2 as "approve / pause / stop." Investigation on 2026-07-02 found that **`approve/reject-tool-request` have no host implementation at all** — there is no tool-request/approval concept anywhere in ai-14all, and no `approval-request` event to correlate against. They therefore depend on the approval surface built in **Phase 2c** and are moved there. This slice covers only the three session-lifecycle capabilities, whose underlying authority already exists (see §4).

## Ratified decisions

1. **Second factor: the pairing grant alone — no acting-token on XBP.** *(Settled.)* XBP requests are already sealed + detached-signed by the SAS-paired device and, as of this slice, gated on a `control:act` permission granted at pairing. The samantha acting-token exists because that connector is an *unauthenticated* WebSocket; XBP already authenticates the device cryptographically, so a second shared secret adds plumbing without adding a meaningfully independent factor. The acting-token stays on the samantha channel where it is still needed.
2. **Scope: managed whisper workflows only.** *(Settled.)* `pause/resume/stop` map to the whisper command runner's `workflow-pause` / `workflow-resume` / `workflow-cancel`. Unmanaged PTY sessions have no main-process pause/stop authority (only a renderer-side terminal teardown) and are deferred to a later slice.
3. **Targeting: capabilities take a `worktreeId`.** Matches the existing `session-report` key the phone already holds; the host resolves `worktreeId → the worktree's active managed workflow`. One managed workflow per worktree is assumed; no live managed workflow → a returned `{ ok:false, code:"no-live-agent" }`; ambiguity → a returned `{ ok:false, code:"ambiguous-worktree" }` (fail-closed — never guess a target).
4. **Idempotency: rely on the operations' natural idempotency + XBP anti-replay.** Pause/resume/stop are no-ops when already in the target state, and the protocol's nonce+timestamp guard already rejects replays. The samantha `IdempotentDispatcher` (exactly-once by `requestId`) is therefore **not required** for this slice; lifecycle ops are safe at-least-once.
5. **Acting-enabled gate is shared.** The XBP acting path respects the same global `isActingEnabled` flag the samantha driver uses, so the existing enable/kill control governs both channels uniformly.
6. **One paired phone**, consistent with 2b.1. Per-capability grants are per-device.

## Architecture

### §1 — Contract additions (ai-xavier `packages/command-contract`)

Add a `control:act` permission constant (today permissions are bare inline strings; introduce `CONTROL_ACT = "control:act"` alongside the existing `control:read` usage so it is defined once). Then add three capability descriptors following the `defineCapability` + `controlId(...)` template that `capabilities/session-report.ts` establishes — in a new `capabilities/session-lifecycle.ts`:

```
pauseSessionCapability  = defineCapability({ id: controlId("pause-session"),  args: { worktreeId }, result: LifecycleResult, risk: "low",    permission: CONTROL_ACT })
resumeSessionCapability = defineCapability({ id: controlId("resume-session"), args: { worktreeId }, result: LifecycleResult, risk: "low",    permission: CONTROL_ACT })
stopSessionCapability   = defineCapability({ id: controlId("stop-session"),   args: { worktreeId }, result: LifecycleResult, risk: "medium", permission: CONTROL_ACT })
```

- **Args** (zod): `{ worktreeId: string }`.
- **Result** (zod) `LifecycleResult` — a **discriminated union on `ok`**, so the handler always returns a schema-valid value and never throws for an expected refusal:
  - success: `{ ok: true, worktreeId: string, workflowId: string, state: "paused" | "running" | "stopped", appliedAt: string }`
  - refusal: `{ ok: false, code: "acting-disabled" | "no-live-agent" | "unknown-worktree" | "ambiguous-worktree" | "internal", message?: string }`

  The `code` values reuse the samantha channel's error-code vocabulary (`command-types.ts`) so both channels share one acting-outcome shape (supports the no-drift guarantee). The success payload lets the phone reflect the outcome without a second `session-report` round-trip (a `session-changed` event also fires). Because expected refusals are *returned* (not thrown), the `Peer` records the request as `accepted` and the semantic audit records `start` + `result` (`ok:false` on refusal); only an *unexpected* handler throw becomes a `Peer` `handler-error` protocol rejection — the fail-closed safety net.
- Export the three from `index.ts`; **bump `COMMAND_CONTRACT_VERSION` 1 → 2** (additive, but a new capability set is a wire-contract change).

The contract stays pure vocabulary — no logic, no secrets — exactly as Slice 2a established. Package scopes are unchanged: the vocabulary ships as `@ai-creed/command-contract` (private GitHub Packages registry); the SDK that provides `Peer` stays `@xavier/xbp` (unpublished, carries the protocol identity — the `@ai-creed/xbp` rename remains parked).

### §2 — Permission grant (ai-14all `services/xbp/xbp-peer-session.ts`)

Today `attach(phoneSignPub, phoneBoxPub, grantedPermissions = [sessionReportCapability.permission])` grants only `control:read`. Widen the default (or the per-device grant) to include `control:act`:

```
grantedPermissions = [sessionReportCapability.permission, CONTROL_ACT]
```

`peer.addPeer(...)` already records the granted set, and `Peer.dispatchRequest` already fail-closes on `!sender.permissions.has(cap.permission)` (`peer.ts:312`). Granting `control:act` is the single switch that authorizes the paired device for the lifecycle caps; no per-request token is introduced (decision 1).

### §3 — Host wiring (ai-14all: `xbp-peer-session.ts`, `xbp-host-service.ts`, `electron/main/index.ts`)

Expose the three capabilities on the same `Peer` that already serves `session-report`:

```
peer.expose(pauseSessionCapability,  (args) => acting.pause(args.worktreeId))
peer.expose(resumeSessionCapability, (args) => acting.resume(args.worktreeId))
peer.expose(stopSessionCapability,   (args) => acting.stop(args.worktreeId))
```

`acting` is a small **XBP acting executor** injected into `XbpHostService` (extend its opts, mirroring how `getSessionReport` is already injected and how `createSamanthaDriver` receives `runManagedInstruction` / `isActingEnabled` / `auditAct` in `electron/main/index.ts:393`). It composes existing pieces rather than re-implementing them:

```
createXbpActingExecutor({
  isActingEnabled,                 // shared global gate (decision 5)
  resolveWorkflow,                 // worktreeId → active managed workflow | { ok:false, code } (unknown-worktree / no-live-agent / ambiguous-worktree)
  runWhisperCommand,               // whisperCommandRunner.run(command, cwd)  [shared/contracts/plugins.ts]
  auditAct,                        // ActingAuditLogger.start/result (semantic acting audit)
  now,
})
```

**Guard reuse.** The executor reuses the *structure* of `ActGuard` (acting-enabled gate → prepare/route → execute → start/result audit) but with authentication satisfied upstream by the Peer's permission check, so `ActGuard`'s token gate (Gate 1) is not exercised on this path. Concretely: either invoke `ActGuard` with the token gate pre-satisfied, or factor its enable-gate + audit-wrap into a shared helper both channels call. The implementation plan picks the cleaner refactor; either way the behavior is: on acting disabled, **return** `{ ok:false, code:"acting-disabled" }` (no runner call); otherwise audit `start`, execute, and audit `result` — the executor **catches** any thrown runner failure and maps it to `{ ok:false, code:"internal" }`, so the handler always returns a schema-valid `LifecycleResult` and the `Peer` records `accepted` for every executor-reached request.

### §4 — Executors & underlying authority (ai-14all)

The whisper command runner already models the operations — `WhisperCommandSchema` supports `workflow-pause`, `workflow-resume`, `workflow-cancel` (`shared/contracts/plugins.ts:48-71`), run via `whisperCommandRunner.run(command, cwd)`. The gap is that **only `workflow-resume` has an acting caller today** (via `runManagedInstruction`); `workflow-pause` and `workflow-cancel` have none. This slice adds those callers:

| Capability | Maps to | New work |
|---|---|---|
| `pause-session` | `workflow-pause` | new caller; construct the command, run at the worktree cwd |
| `resume-session` | `workflow-resume` (message `null`) | existing runner path supports a null-message resume, but `runManagedInstruction` currently always supplies a message — add/allow the bare-resume call |
| `stop-session` | `workflow-cancel` | new caller |

`resolveWorkflow(worktreeId)` uses the same whisper-state source the samantha driver and the session-report provider already consume (`getWhisperStates`) to find the worktree's live managed workflow and its cwd. Worktree not found → `{ ok:false, code:"unknown-worktree" }`; found but no live managed workflow → `{ ok:false, code:"no-live-agent" }`; more than one candidate → `{ ok:false, code:"ambiguous-worktree" }`. These are **returned**, not thrown — so the request is `accepted` at the protocol layer and the refusal is captured in the semantic `result`.

### §5 — Auth & audit model

- **Authn/authz:** envelope signature (paired device) + `control:act` grant. No token (decision 1).
- **Layered audit — each layer records what it can see; they are not both expected on every path:**
  - *Protocol audit (`XbpAuditSink`)* — `Peer.dispatchRequest` appends exactly one entry (accepted or rejected) for **every** request that reaches dispatch, automatically (`peer.ts:325,385`); no new code. This is the **only** audit that fires for **pre-executor protocol rejections**: missing `control:act`, unknown capability, schema-invalid args, and tamper/forge/replay frames are rejected inside the SDK/`Peer` *before* the executor runs, so no semantic entry exists for them (and none is expected).
  - *Semantic acting audit (`ActingAuditLogger`)* — fires **only for requests that pass the permission gate and reach the executor**. The executor **always returns a schema-valid `LifecycleResult`** (success or a `{ ok:false, code }` refusal — it catches expected failures rather than throwing), so every executor-reached request produces a semantic `start` + `result` pair and is recorded by the `Peer` as `accepted`. Success and executor-level refusals (`acting-disabled`, `no-live-agent`, `unknown-worktree`, `ambiguous-worktree`, `internal`) therefore appear in **both** logs (protocol `accepted` + semantic `start`/`result`), the same append-only acting history as samantha-channel actions (who/what/when/outcome). The only handler path that yields a protocol `rejected` is an *unexpected* throw the executor did not catch → `Peer` `handler-error` (the fail-closed safety net, not an expected outcome).
- **Contract, stated precisely (this is what the tests assert):** every request that reaches dispatch has exactly one protocol-audit entry; every request that reaches the executor is `accepted` at the protocol layer (because the handler returns a schema-valid union rather than throwing for refusals) and additionally has semantic `start`/`result` entries; a pre-dispatch protocol rejection has a protocol-audit entry and **no** semantic entry, by design.

### §6 — Error handling (fail-closed everywhere)

| Failure | Defined behavior |
|---|---|
| Device lacks `control:act` | `Peer` rejects with `permission-denied` **before** the handler; **protocol audit only** ("rejected"); executor not reached, no semantic entry. No execution. |
| Acting globally disabled (`isActingEnabled` false) | Executor **returns** `{ ok:false, code:"acting-disabled" }`; no runner call; protocol `accepted`, **semantic** `start`/`result` record the refusal. |
| Worktree not found | Executor returns `{ ok:false, code:"unknown-worktree" }`; protocol `accepted`, semantic records the refusal. |
| Worktree found but no live managed workflow | Executor returns `{ ok:false, code:"no-live-agent" }`; protocol `accepted`, semantic records the refusal. |
| Ambiguous worktree → workflow | Executor returns `{ ok:false, code:"ambiguous-worktree" }`; never guesses a target; protocol `accepted`, semantic records the refusal. |
| Runner command fails / throws | Executor **catches** it and returns `{ ok:false, code:"internal" }`; never crashes the service; protocol `accepted`, semantic `result` records `ok:false`. |
| Unexpected handler throw (bug) | `Peer` converts it to a `handler-error` protocol **rejection** (fail-closed safety net); protocol `rejected`. |
| Tampered / forged / replayed frame | SDK `openAndVerify` + replay guard drop it → **protocol audit only** ("rejected"); no semantic entry (unchanged from 2b.1). |
| Bridge toggled off (kill switch) | Peer/transport stop; in-flight dropped. Host-side authority kill (unchanged from 2b.1). |

### §7 — Testing & conformance

- **Conformance (regression):** the 2b.1 host conformance suite must still pass unchanged. Adding capabilities and a grant must not regress pairing / dispatch / anti-replay / audit / kill-switch behavior.
- **Contract unit (ai-xavier):** the three descriptors parse valid args, reject invalid args, carry `control:act` and the right risk; `COMMAND_CONTRACT_VERSION` bumped; barrel exports present.
- **Executor unit (ai-14all):** `resolveWorkflow` returns the workflow or a `{ ok:false, code }` refusal (`unknown-worktree` / `no-live-agent` / `ambiguous-worktree`); acting-disabled returns `{ ok:false, code:"acting-disabled" }` before any runner call; each capability constructs the correct whisper command; a thrown runner is **caught** and returned as `{ ok:false, code:"internal" }` with a semantic `ok:false` `result`. Every executor-reached path returns a schema-valid `LifecycleResult` and yields both a protocol `accepted` entry and semantic `start`/`result` entries (the handler never throws for an expected refusal).
- **Integration (in-memory transport):** pair → grant `control:act` → `call(pause-session)` pauses (runner invoked with `workflow-pause`), returns a schema-valid `{ ok:true, state:"paused", … }` `LifecycleResult`, emits `session-changed`; resume and stop likewise; a **returned refusal** — pausing a worktree with no live managed workflow returns a schema-valid `{ ok:false, code:"no-live-agent" }` with protocol `accepted` + semantic entries and no `session-changed`; **negatives** — a device granted only `control:read` is rejected `permission-denied` with a protocol-audit entry and **no** semantic entry (executor not reached); a replayed acting frame is rejected with a protocol-audit entry and no semantic entry.
- **No-drift:** an acting action taken over XBP produces the same acting-audit shape as the samantha channel (one canonical log).
- **Audit layering (the §5 contract, tested directly):** a `permission-denied` / forged / replayed request produces exactly one `XbpAuditSink` entry and **zero** `ActingAuditLogger` entries; an executor-reached request (success or an executor-level refusal such as `acting-disabled` / `no-live-agent` / ambiguity) produces one `XbpAuditSink` entry **and** semantic `start`/`result` entries.
- **Manual acceptance:** a real phone pauses / resumes / stops a live managed workflow on the real ai-14all over LAN; Observe reflects each transition.

## Acceptance criteria

1. `@ai-creed/command-contract` defines `pause/resume/stop-session` under `control:act`, with a `control:act` constant and a bumped `COMMAND_CONTRACT_VERSION`.
2. The XBP peer session grants the paired device `control:act` and exposes the three capabilities on the same `Peer` as `session-report`.
3. From a paired phone, `pause-session` halts a running managed whisper workflow; `resume-session` continues it; `stop-session` ends it — each executed on ai-14all's real authority via the whisper command runner.
4. Each **successful** action returns a schema-valid `{ ok:true, … }` `LifecycleResult` and triggers a `session-changed` event; the phone's Observe reflects the new state. An expected refusal returns a schema-valid `{ ok:false, code }` result and fires no event.
5. Auditing follows the layered contract in §5: every dispatched request yields exactly one protocol-audit entry (`XbpAuditSink`); every request that reaches the executor additionally yields semantic acting-audit entries (`ActingAuditLogger` `start`/`result`, including executor-level refusals); pre-dispatch protocol rejections (missing `control:act`, tamper/forge/replay) yield a protocol-audit entry and no semantic entry.
6. All fail-closed behaviors in §6 hold; a `control:read`-only device cannot act.
7. The 2b.1 conformance suite still passes (no regression).

## Out of scope / known limitations (this slice)

- **`approve/reject-tool-request` and the approval surface** — Phase 2c (they have no host implementation yet; see scope note).
- **Unmanaged PTY sessions** — no main-process pause/stop authority; deferred (decision 2).
- **Kill switch as a first-class phone view** and **audit-log read capability** — Phase 2d.
- **Push wake / from-anywhere reach** — Phase 1b / 0b.2 / Phase 5; LAN only here.
- **Exactly-once acting semantics** — not needed for idempotent lifecycle ops (decision 4); revisit if/when non-idempotent capabilities are added.
- **Multiple paired devices + per-device capability tiers** — deferred.

## Prerequisites

- Slice 2b.1 landed (live host edge on ai-14all `dev-integration`) — done.
- The `control:act` grant is added at the pairing step; existing paired devices from before this slice would need re-grant/re-pair to gain acting (acceptable for the single-device assumption; note for the plan).
