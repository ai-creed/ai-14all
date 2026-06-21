# Samantha Integration — S1 (Rich Observe) Design

**Date:** 2026-06-22
**Status:** Approved design, ready for implementation planning.
**Scope:** S1 only — ai-14all pushes rich session/workflow state *out* to Samantha
(observe + speak). The command/act half (S2) is a separate spec; nothing here
delivers commands, a WebSocket, an approval gate, or auth.

## Context

This is the first slice of the ai-14all ↔ ai-samantha integration. The settled
shape lives in the high-level plan: `docs/superpowers/specs/2026-06-21-samantha-14all-integration-highlevel-design.md`.
Samantha is the proprietary voice supervisor; she runs an HTTP+WebSocket server
on `127.0.0.1:7841`. ai-14all integrates as a **single, exclusive, inverted
supervisor plugin** that pushes its own state out to her.

This design was grounded by reading the actual code in both repos (2026-06-22).
Key verified facts that shaped it:

- **ai-14all's main process is stateless about sessions.** `AgentAttentionBridge.report()`
  (`services/mcp/agent-attention-bridge.ts:84`) holds no state, is a pure
  forwarder, and carries only the `mcp` attention source (1 of 4). The resolved
  per-session attention state, agent provider, task, summary, and nextAction are
  computed in the renderer reducer and are not persisted or exposed to main.
- The main process **can** read worktree identity, review counts, and the whole
  whisper workflow/collab state directly.
- Samantha's snapshot `details` is `Record<string, string>` (`src/core/assistant.ts:3-11`),
  shallow-merged (`connector-registry.ts:68`), and her prompt formatter renders
  each `details` entry as a `  key: value` line into the LLM context
  (`assistant-service.ts:234-238`, `:258-268`). So rich per-worktree text reaches
  her reasoning with **no Samantha-side change**.
- Samantha's events ride plain HTTP; the WebSocket is only for command delivery.
  So S1 needs **no WebSocket and no `ws` dependency**.

## Decisions locked (during brainstorm)

1. **Scope = S1 rich observe only.** S2 (benign act) is a separate, later spec.
   The user dogfoods once both ship; we build them sequentially.
2. **Assembly happens in the main process (hybrid).** The main-side Samantha
   driver assembles the rich document from the three sections it owns
   (identity, reviews, workflow/collab) plus a minimal renderer→main push of the
   one section only the renderer owns (resolved session state). Rationale: moves
   the minimum necessary data across the IPC boundary, keeps the integration's
   wire shape out of the React layer (renderer stays ignorant of Samantha), and
   makes assemble→upload one isolated, testable main-process unit.
3. **Carriage = rich readable per-worktree lines in the existing `Record<string,string>`.**
   One `details` key per worktree; value is a dense human-readable line. This
   keeps S1 fully 14all-only. Machine-structured fields are deferred to S2, where
   command targeting actually needs them.
4. **Inverted driver fits the existing `EcosystemPlugin` interface via the
   whisper "own-channel" precedent** — a lenient probe, a fast-returning
   `start()`, and connection health pushed on the driver's own IPC channel rather
   than through registry status. No framework surgery.

## Architecture — components & boundaries

New main-process units under `services/plugins/samantha/`, mirroring the
whisper/cortex driver layout:

| Unit | Responsibility | Depends on | Tested by |
|---|---|---|---|
| `observe-assembler.ts` | **Pure core.** Given identity map + review counts + whisper snapshot + renderer session slice, produce the rich document (`summary`, `status`, per-worktree `details` lines) and the per-worktree event signal. No I/O. | nothing | fixture inputs → assert output |
| `samantha-connector-client.ts` | **The seam / all I/O.** HTTP client for `:7841`: `register()`, `patchSnapshot()`, `postEvent()`, `unregister()`. The only module that knows Samantha's wire. | `node:http` (or `fetch`) | mock server / stub |
| `samantha-probe.ts` | Lenient probe (see Lifecycle). | plugin config | unit |
| `samantha-driver.ts` | **Orchestrator** implementing `EcosystemPlugin`. Owns lifecycle, subscribes to taps, debounces, runs assembler → client, owns reconnect + health. | the three above + taps | integration |

**Taps the driver subscribes to (all main-process, verified available):**

- **renderer→main session-slice push** (new IPC, see below) — the only data main
  cannot get itself.
- `ReviewCommentService.onChange` (`services/review/review-comment-service.ts:172-177`)
  — review counts + a change trigger; counts via `listOpenByWorktree(id).length` (`:39`).
- whisper workflow/collab — `WhisperStoreReader` reads `~/.ai-whisper/state.db`
  directly (`services/plugins/whisper/whisper-store-reader.ts`), or subscribe to
  `WhisperCollabWatcher.snapshot()` (`whisper-collab-watcher.ts:24-50`).
- worktree identity — `WorktreePathResolver` (`services/review/worktree-path-resolver.ts`),
  `WorktreeService.listWorktrees` (`services/worktrees/worktree-service.ts:129`),
  `WorkspaceRegistryService`.
- (optional secondary) terminal `onExit`/`onError` (`services/terminals/terminal-service.ts`).

**The one new renderer surface — a session-slice publisher.** On each meaningful
reducer change, the renderer sends, per worktree,
`{ provider, attention, summary, task, nextAction, updatedAt }` plus app-level
`{ focusedWorktreeId, mode }` to main over a new `samantha:sessionState` IPC
channel. The renderer does not know Samantha exists; it publishes its resolved
session state and the driver consumes it. Source fields:
`provider` from `agent-provider-detection.ts:46`; resolved `attention` from
`rankAgentAttention` (`workspace-state.ts:1090-1147`); `task` from
`worktree-session.ts:51`; attention enum `shared/models/agent-attention.ts:1-7`.

**Wiring touch-points (from grounding):**

- `shared/models/ecosystem-plugin.ts:1-3` — add `"samantha"` to `ECOSYSTEM_PLUGIN_IDS`
  (closed union; required first or nothing typechecks).
- `electron/main/index.ts` (~`:252-266`) — construct `createSamanthaDriver(...)`,
  inject its `pushHealth`/`getWebContents` callbacks (whisper precedent at
  `:211-212`), add it to the registry drivers array.
- `src/features/plugins/components/PluginsPanelDialog.tsx:83-98` — add a
  `DESCRIPTORS.samantha` entry (exhaustive record; won't compile without it).
- `shared/contracts/plugins.ts` + `electron/preload/index.ts` + `src/lib/desktop-client.ts`
  — add the two new channels: `samantha:sessionState` (renderer→main) and the
  health push (main→renderer), mirroring the whisper `whisperStateChanged` bridge.
- `EcosystemPlugin` interface unchanged (`plugin-registry.ts:20-26`); S1 needs no
  new `PluginCapability` (the samantha driver registers `capabilities: []`).

## Lifecycle & resilience

The existing driver model assumes a local peer that gets probed for install and
read from. The Samantha driver inverts that; it fits without framework changes:

- **Probe is lenient (installed-when-enabled).** Samantha is a desktop app with no
  CLI/version to check, so the probe returns `{kind:"installed", protocolVersion:""}`
  whenever the plugin is enabled (the cortex no-op probe shape, `cortex-probe.ts:55`).
  We deliberately do **not** gate `start()` on live reachability — Samantha may
  boot after 14all, and we want the driver running and retrying so it connects the
  moment she appears.
- **`start()` returns immediately** and kicks off register+connect in the
  background. It must never block the serialized reconcile chain
  (`plugin-registry.ts:203-206`). No WebSocket in S1.
- **Connection health rides the driver's own pushState channel**, not registry
  status — exactly the two-layer model whisper already uses (registry chip +
  workflow lens):
  - registry chip = enable/install health (`installed-off` / `on-healthy`).
  - Samantha's own affordance = live link state:
    `connecting | connected | reconnecting | samantha-not-running`.
  - No new `PluginRuntimeStatus` value is required.
- **The client owns liveness** (Samantha has no heartbeat). A failed `PATCH`/`POST`
  with `ECONNREFUSED` means she is down → `reconnecting`: periodic re-register with
  backoff; on success, re-`PATCH` a fresh full snapshot. A `404` on PATCH/POST
  means she restarted and dropped the registration → re-register. A keep-alive
  `PATCH` (~30s) doubles as freshness for her stale-row affordance.
- **`reportDegraded` is not used for transient disconnects** (it is terminal until
  the next reprobe, `plugin-registry.ts:198`). Reconnects are handled internally;
  `reportDegraded` is reserved for genuine misconfiguration.
- **`stop()`** issues `DELETE /connectors/ai-14all` (clean unregister) and tears
  down all timers.
- **Graceful absence** holds throughout: Samantha off or down → driver sits in
  `reconnecting`/`samantha-not-running` and 14all is completely unaffected.

## Data flow & contract

**Flow (all in the main-side driver):**

1. A tap fires → driver updates its in-memory latest inputs (session-slice map,
   review counts, whisper snapshot, identity).
2. Schedule a debounced rebuild (~1s) to absorb bursts.
3. On fire: `observe-assembler` merges latest inputs **by `worktreeId`** into the
   rich document.
4. `PATCH /connectors/ai-14all/snapshot` with the **full-state** document (skip if
   byte-identical to the last upload).
5. For each worktree whose mapped signal **changed to a speech-worthy value**,
   `POST /connectors/ai-14all/events`. The snapshot `PATCH` always precedes the
   event `POST` (her proactive path refreshes the snapshot before speaking).
6. Keep-alive `PATCH` ~30s for freshness.

**Event policy (traffic-lean).** Only `attentionRequired | error | taskCompleted`
get a `POST /events`. `update`-class transitions ride the next snapshot `PATCH`
(an `update` event never speaks, and the PATCH already refreshes her UI/context).
Per-worktree last-signal tracking prevents event spam (active→active emits
nothing; active→waiting emits one event).

**Contract (S1, all HTTP against `127.0.0.1:7841`):**

- **register** (on connect): `POST /connectors/register`
  `{ id: "ai-14all", label: "ai-14all", description, capabilities: [] }`. No
  capabilities in S1. `409` (duplicate) → treat as already-registered and proceed.
- **snapshot**: `PATCH /connectors/ai-14all/snapshot`
  `{ summary, status, details, updatedAt }`
  - `summary` (derived TTS headline): e.g.
    `"3 sessions — feature/auth blocked (needs review), bugfix/tts working, main idle"`.
  - `status` worst-of: any `failed` → `error`; else any `waiting`/`ready` →
    `warning`; else `ok`; none → `unknown`.
  - `details`: one key per worktree (branch name), value = dense line:
    `"<provider> · <attention> · <summary> · task: <task> · next: <next> · <N> reviews · <workflow phase/escalation>"`,
    omitting empty fields. Full-state every PATCH (her shallow-merge replaces
    `details` wholesale, so closed worktrees drop cleanly).
  - `updatedAt`: epoch ms.
- **event**: `POST /connectors/ai-14all/events` `{ signal, summary, details? }`,
  with `summary` like
  `"feature/auth: waiting — 3 tests failing in workspace-state.test.ts. Next: answer question."`.

**Signal mapping (full attention enum):**

| ai-14all condition | Samantha signal | Emits event? |
|---|---|---|
| session `waiting` | `attentionRequired` | yes (speaks all modes incl. AFK) |
| session `failed` | `error` | yes (speaks all modes) |
| session `ready` | `taskCompleted` | yes (speaks conversational/watching) |
| session `active` | `update` | no — snapshot only |
| session `stale` (120s quiet) | `update` | no — `stale` ≠ blocked; avoid false alarms |
| session `idle` (no agent) | `update` | no — snapshot only |
| workflow halted / relay escalated | `attentionRequired` | yes |
| phase done / round started / paused / resumed | `update` | no |

## Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | Samantha down at 14all start | register `ECONNREFUSED` → `reconnecting`, backoff; 14all unaffected; connects when she appears |
| 2 | Samantha restarts mid-session | PATCH/POST → `404`/refused → re-register + re-PATCH fresh full snapshot |
| 3 | Duplicate register (`409`) | treat as already-registered, proceed to PATCH |
| 4 | Worktree closed | full-state `details` omits its key → shallow-merge replaces wholesale → key drops; summary/status recomputed |
| 5 | No worktrees / all idle | summary "no active sessions", status `ok`/`unknown`; still register + keep-alive |
| 6 | Renderer slice not arrived yet | assemble from main-only data (identity + reviews + workflow); session fields fill on the first slice push — never block on the renderer |
| 7 | Burst of transitions | ~1s debounce coalesces into one PATCH; events still emitted per distinct speech-worthy transition |
| 8 | Plugin toggled off at runtime | `stop()` → `DELETE` unregister + teardown; she sees a silent disconnect |
| 9 | Samantha absent / plugin disabled | no-op, silent (graceful absence) |

## Testing strategy

- **Unit — the payoff.** `observe-assembler` is pure: feed fixture inputs
  (worktrees, review counts, whisper snapshot, session slice) and assert the exact
  `{ summary, status, details, signal }`. Covers signal mapping, worst-of status,
  detail-line format, and the per-worktree dedup logic. No mocks, no network.
- **Client unit.** Mock HTTP server (or stub) → assert register/patch/event
  payloads and re-register behavior on `404`/`ECONNREFUSED`.
- **Driver integration (main).** Fake taps + mock client → assert debounce
  coalescing, PATCH-before-POST ordering, transition→event emission, and keep-alive.
- **e2e (Playwright).** Enable the samantha plugin via isolated userData plus a
  **mock Samantha connector server**; drive an agent to `waiting`; assert the mock
  received register + snapshot + an `attentionRequired` event. Mirror
  `tests/e2e/plugins-whisper.test.ts` / `plugins-cortex.test.ts`. Note the known
  gotcha: e2e must enable the plugin via config/isolated userData or the plugin
  stays gated. The real Samantha↔14all integration test is deferred to M4.

## Out of scope (deferred to S2 or later)

- Any command delivery, the WebSocket, the `ws` dependency.
- Extending Samantha's command frame (`args`/`requestId`/`ack`).
- Wiring Samantha's assistant LLM to invoke connector capabilities as tool calls
  (verified missing; a substantial Samantha-side build).
- Approval gate, audit log, registration token (S3 — only "act" needs them).
- Machine-structured / nested `details` schema (add in S2 when command targeting
  needs queryable fields).

## Files to add / touch

**Add (`services/plugins/samantha/`):** `samantha-driver.ts`, `samantha-connector-client.ts`,
`observe-assembler.ts`, `samantha-probe.ts`, plus tests.

**Touch:** `shared/models/ecosystem-plugin.ts` (id union), `electron/main/index.ts`
(construct + register driver), `src/features/plugins/components/PluginsPanelDialog.tsx`
(`DESCRIPTORS`), `shared/contracts/plugins.ts` + `electron/preload/index.ts` +
`src/lib/desktop-client.ts` (two new IPC channels), and the renderer
session-slice publisher (in the workspace feature where reducer changes are
observed).

## References (verified 2026-06-22)

- `services/plugins/plugin-registry.ts:20-26` — `EcosystemPlugin` interface; `:13-18` `PluginContext`; `:52-82` `statusOf`.
- `shared/models/ecosystem-plugin.ts:1-3` ids, `:5-18` `ProbeResult`, `:21-30` `PluginRuntimeStatus`.
- `services/plugins/plugin-config.ts:21` `DEFAULT_ENTRY`; TOML at `userData/config.toml`.
- `services/plugins/cortex/cortex-probe.ts:55` — no-op probe shape.
- `services/plugins/whisper/whisper-driver.ts` + `electron/main/index.ts:211-212` — own pushState channel precedent.
- `services/mcp/agent-attention-bridge.ts:84` — single-source, stateless forwarder.
- `services/review/review-comment-service.ts:39,172-177` — counts + onChange.
- `services/plugins/whisper/whisper-store-reader.ts`, `whisper-collab-watcher.ts:24-50` — main-readable workflow/collab.
- `src/features/workspace/logic/workspace-state.ts:1090-1147` — `rankAgentAttention`; `shared/models/agent-attention.ts:1-7` enum.
- ai-samantha: `electron/main/connector-server.ts` (register `:101`, snapshot `:127`, events `:144`, WS `:282`), `connector-registry.ts:68` (shallow merge), `src/core/assistant.ts:3-11` (`SourceSnapshot`), `src/core/connectors.ts:8-12` (signals), `electron/main/assistant-service.ts:234-238,258-268` (details → prompt).
