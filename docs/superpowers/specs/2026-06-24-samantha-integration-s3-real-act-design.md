# ai-14all ↔ ai-samantha — S3 "Real Act" Design (instruct-session)

**Date:** 2026-06-24
**Status:** Approved design. No code yet — this spec fixes the slice's shape so the
implementation plan can be written against a settled architecture.
**Slice:** S3 of the bi-directional integration roadmap (see the high-level plan,
`docs/superpowers/specs/2026-06-21-samantha-14all-integration-highlevel-design.md`, §5).
**Repo home:** ai-14all (this slice is ai-14all-heavy; see §12).

---

## 1. Context

The autonomy ladder is `observe → notify → direct → triage`. S1 delivered the rich
observe payload; S2a delivered the extended command wire; S2b wired Samantha's voice
LLM so a spoken request invokes a connector capability as a tool call. Those slices
shipped **benign** capabilities only — `focus-worktree` and `session-report` — which
touch no agent and were deliberately shipped **ungated** (zero blast radius, loopback
only).

**S3 is the first slice with real blast radius.** It adds one capability,
`instruct-session`, which delivers an instruction to the agent running in a worktree's
session. The moment a command can actually drive an agent, the three security
preconditions the high-level plan deferred to S3 (§7 of the high-level plan) become
mandatory: a **registration token**, an **approval gate**, and an **audit log**.

This slice sits on the same axis as every prior slice: ai-14all hardcodes exactly one
supervisor, Samantha, and trusts her as the single exclusive supervisor (the product
moat). S3 does not widen that trust model — it applies it. ai-14all trusting a
token-authenticated Samantha to issue an already-confirmed instruction is the existing
architecture, not a new one.

## 2. Goal

Let a **user-voiced** request ("tell the auth session to add tests") reach the agent in
the target worktree, safely:

- **One capability:** `instruct-session`. `start-session` is explicitly deferred (§15).
- **User-voiced only.** Autonomous acting is S5 (triage). S3 builds the guard machinery
  but never invokes a command Samantha originated on her own.
- **Smallest real-blast-radius command,** so the slice proves the guard machinery rather
  than a large new surface.

## 3. Capability contract

`instruct-session` is advertised through Samantha's existing self-describing capability
contract (the `{ id, title, description, inputSchema }` shape S2b established). The new
entry in `CAPABILITIES` (`services/plugins/samantha/samantha-driver.ts`):

```jsonc
{
  "id": "instruct-session",
  "title": "Instruct a session",
  "description": "Deliver an instruction to the agent in a worktree's session.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "worktree": { "type": "string", "description": "\"<repo>/<branch>\" key from the observe snapshot" },
      "instruction": { "type": "string", "description": "What to tell the agent" }
    },
    "required": ["worktree", "instruction"]
  },
  "requiresConfirmation": true,
  "risk": "drives-agent"
}
```

`requiresConfirmation` / `risk` is the **forward hook flagged in S2b**: ai-14all
*declares* that the capability needs confirmation; Samantha *enforces* it in voice (§4).
The policy of which capabilities are gated stays ai-14all-owned (the moat keeps
dictating); the enforcement lives in the modality the user is already in.

`worktree` reuses the `"<repo>/<branch>"` observe key and the existing
`resolveWorktreeKey` resolver (`services/plugins/samantha/samantha-command-capabilities.ts`),
so the LLM targets a session using keys already present in the observe snapshot, and
ambiguous keys remain a first-class refusal.

## 4. The gate — two layers

The approval gate splits across the trust boundary. This corrects the high-level plan's
§8, which placed "approval gate" wholly on the ai-14all side: the **human** gate lives
in voice (Samantha); ai-14all owns only **non-interactive authorization**.

### 4.1 Layer 1 — human confirmation, Samantha-side (voice)

The user voices the command. Samantha, seeing `requiresConfirmation: true`, **reads the
resolved instruction back** ("I'll tell the *auth* session: *add tests* — confirm?") and
waits for an **approval verb** before forwarding the command frame. The read-back is the
misrecognition catch: a wrong target or a mangled instruction surfaces *before* anything
reaches an agent. An approval verb ("confirm", "do it") is short and acoustically
distinct, so it is hard to mishear.

ai-14all never re-asks intent in its own UI — bouncing the user to a desktop confirm for
something they just said out loud breaks the voice loop for no gain. This layer is a
Samantha-side responsibility; ai-14all depends on it via the declared flag but cannot and
does not verify it fired.

### 4.2 Layer 2 — authorization at ai-14all (non-interactive)

The command arrives over loopback already confirmed. ai-14all's guards are
non-interactive and pass through a single chokepoint (the `ActGuard`, §5):

1. **Registration token** — provenance. Only the legitimate token holder (Samantha) may
   issue acting commands. Default-deny: an acting command without a valid token is
   refused (`unauthorized`). See §8.
2. **Master acting-enabled toggle** — ai-14all's own independent brake, **default off**.
   This is the one safety that does not depend on Samantha's read-back firing correctly.
   See §11.
3. **Audit log** — every acting command and its outcome is recorded for after-the-fact
   review. See §9.

## 5. Architecture — module decomposition

S3 adds two focused modules behind the existing dispatcher injection seam, keeping the
command dispatcher pure (the pattern S2a/S2b established with `DispatcherCallbacks`).

### 5.1 `SessionInstructionRouter`

Pure decision function — no whisper or PTY dependencies, fully unit-testable against fake
state:

```
route(input: {
  worktreeId: string
  instruction: string
  state: TargetSessionState   // assembled from the whisper snapshot + attention slice
}): RouteDecision
```

`RouteDecision` is one of:

- `{ kind: "collab-tell", target, instruction }` — managed session at a safe input point.
- `{ kind: "workflow-resume", workflowId, message }` — paused workflow.
- `{ kind: "send-input", sessionId, data }` — unmanaged shell at a safe input point.
- `{ kind: "reject", code, reason }` — not at a safe input point, or no live agent.

All safe-input-point logic lives here (§6). Because it is a pure truth table over
`TargetSessionState`, every routing and rejection path is testable in isolation with zero
side effects.

### 5.2 `ActGuard`

The single chokepoint every acting command crosses, so the security trilogy lives in one
auditable place rather than scattered across the wiring:

```
tokenValid? → actingEnabled? → audit(start) → execute(routeDecision) → audit(result)
```

`execute` dispatches the `RouteDecision`: a `collab-tell` / `workflow-resume` becomes a
`WhisperCommand` run through the existing `whisper-command-runner.ts`; a `send-input`
calls `terminal-service.sendInput`. A `reject` short-circuits before execution and is
still audited.

### 5.3 Dispatcher + driver wiring

- `createSamanthaCommandDispatcher` (`samantha-command-dispatcher.ts`) gains an
  `instruct-session` branch and a new `instructSession` entry in `DispatcherCallbacks`.
- `createSamanthaDriver` (`samantha-driver.ts`) wires that callback to
  `ActGuard.run(router.route(...))`, supplying the effects (whisper runner, terminal
  service, token source, config toggle, audit logger).

The dispatcher stays pure; the router stays pure; the guard owns the effects. No change
to `terminal-service.ts` (it has no managed-session awareness and stays agnostic).

## 6. Routing & safe-input semantics

The whole slice exists to avoid one hazard: raw input injected into a whisper-managed
session corrupts that workflow's own input stream. So an instruction lands **only when
the target is at a safe input point**; otherwise it is **rejected** (never queued — a
deferred instruction firing minutes later onto a changed context is exactly the surprise
a voice loop must avoid, and we never interrupt a healthy running workflow).

**State source of truth.** The whisper driver snapshot — `WhisperWorktreeState`
(`shared/models/ecosystem-plugin.ts`, produced by `whisper-collab-watcher.ts`) — carries
`daemonAlive`, `workflow` (a `WhisperWorkflowSnapshot` with `status`, `phaseName`,
`haltReason`, or `null`), and `escalation`. The agent-attention state
(`shared/models/agent-attention.ts`: `waiting | failed | ready | stale | active | idle`)
supplies the unmanaged-shell input-readiness signal.

| Target | Safe-input condition | Route | Reject when |
| --- | --- | --- | --- |
| **Managed** (`workflow !== null`) | escalated, paused, or otherwise awaiting input | `collab-tell` (or `workflow-resume --message` when paused) via the existing `WhisperCommand` runner | running and not escalated → reject (`session-busy`): don't interrupt a healthy run |
| **Unmanaged shell** (live agent, no workflow) | attention ∈ {`idle`, `waiting`, `ready`} | state-aware `terminal-service.sendInput` | attention ∈ {`active`, `stale`, `failed`} → reject (`session-busy`) |
| **No live session** | — | — | reject (`no-live-agent`); `start-session` is deferred, so we never auto-spawn |

**Reuse of the sanctioned surface.** Managed routing maps onto the *existing*
`WhisperCommand` variants — `collab-tell { target, instruction }` and
`workflow-resume { workflowId, message }` (`shared/contracts/plugins.ts`), executed by
`whisper-command-runner.ts` (which already records to a `PluginCommandLogger`). S3 does
**not** add a new whisper CLI subcommand; it selects an existing, already-validated one.

**Read-only store boundary.** Delivering an instruction to a managed session is done
*only* through whisper's sanctioned command surface (the `WhisperCommand` runner) and the
unmanaged-shell `sendInput` PTY path. ai-14all reads `WhisperWorktreeState` to make the
routing decision but **never writes to, deletes from, or otherwise mutates whisper's
`state.db`** to deliver an instruction. Whisper's store is a read-only contract; the only
way S3 affects a managed workflow is by invoking whisper's own command CLI, which lets
whisper mutate its own state on its own terms.

## 7. Result semantics

`instruct-session` returns a result on the existing S2a `commandResult` wire (requestId
correlation, `okResult` / `errorResult` in `command-types.ts`). The result is a
**delivery acknowledgement, not an agent outcome** — ai-14all cannot synchronously know
what the agent does with the instruction.

- Success → `ok` with `{ routed: "collab-tell" | "workflow-resume" | "send-input" }`.
- Refusal → a typed `error` (§10) that Samantha speaks back ("the auth session is busy").

## 8. Registration token

**Threat model (blessed scope).** Because ai-14all is the *client* connecting out to
Samantha's `:7841` server, and acting commands flow server→client, the adversary is an
**impostor server** squatting `:7841` (Samantha not yet up, a stale instance, a port
collision) that ai-14all would otherwise connect to and execute commands from. The token
lets ai-14all verify the server is genuinely Samantha before honoring an acting command.

On a single-user loopback box the token defends against **accidents and other local
apps** and raises the bar. It is **explicitly not** a defense against same-user malware —
a process running as the user can already read Samantha's secrets and drive the machine
directly, so impersonating her buys it nothing. That adversary is out of scope by
construction (loopback + single-user is the security model from S1 onward).

**Frozen here / deferred to plan.** This spec freezes the **contract and posture**: a
shared secret, presented on the acting channel, with **default-deny** for any acting
command lacking a valid token. The **exact issuance and wire mechanism** (handshake vs.
per-frame, how Samantha issues/stores the secret) is Samantha-side (§12) and cannot be
grounded from this repo; it is settled in the implementation plan against Samantha's real
server — the same cross-repo discipline S2a/S2b used for wire details.

## 9. Audit log

A dedicated **`acting-audit.jsonl`**, following the established diagnostics pattern
(`appendFileSync` + size rollover, as in `services/diagnostics/plugin-command-logger.ts`),
written beside the existing low-level logs in the app logs directory. Each acting command
records a semantic entry:

```jsonc
{
  "ts": 0,
  "worktreeId": "...",
  "provider": "claude",
  "instruction": "add tests",
  "route": "collab-tell",          // or workflow-resume | send-input | reject
  "guard": { "tokenValid": true, "actingEnabled": true },
  "decision": { "safeInputPoint": true, "rejectCode": null },
  "result": { "ok": true }
}
```

This is the semantic acting trail. The lower-level `whisper-command-runner` audit
(`PluginCommandLogger`) still captures the managed-route argv/exit independently.

## 10. Error taxonomy

Extend the S2a `COMMAND_ERROR_CODES` enum (`command-types.ts`) with the acting codes:

| Code | Meaning |
| --- | --- |
| `no-live-agent` | target worktree has no running agent/session to instruct |
| `session-busy` | target is not at a safe input point (running workflow / active shell) |
| `acting-disabled` | the master acting-enabled toggle is off |
| `unauthorized` | acting command lacked a valid registration token |

Existing codes (`unknown-capability`, `unknown-worktree`, `ambiguous-worktree`,
`invalid-args`, `internal`) carry over unchanged.

## 11. Config — master toggle

Extend the samantha plugin's behavior config (`services/plugins/plugin-config.ts`,
`PluginConfigEntry.behavior`) with `acting_enabled`, **default false**:

```toml
[plugins.samantha.behavior]
focus_raises_window = true
acting_enabled = false   # S3: real-act master brake, default off
```

`plugin-config.ts` already watches the file and live-reloads, so toggling
`acting_enabled` takes effect on the next dispatch with no app restart. The `ActGuard`
reads it on every acting command.

## 12. Cross-repo split

| Side | Work |
| --- | --- |
| **ai-14all** (this slice's bulk) | `SessionInstructionRouter`, `ActGuard`, dispatcher `instruct-session` branch + callback, capability descriptor, `acting-audit.jsonl`, `acting_enabled` toggle, new error codes |
| **ai-samantha** | honor `requiresConfirmation` (the voice read-back + approval-verb gate), token issuance, send the instruction args, speak the typed result/refusals |

This inverts S2b's split (which was ~85% Samantha). S3 is ai-14all-heavy, which is why it
is brainstormed and spec'd in this repo.

## 13. End-to-end flow

1. User voices "tell the auth session to add tests."
2. Samantha's LLM selects `conn__ai-14all__instruct-session` with
   `{ worktree: "myrepo/feature/auth", instruction: "add tests" }`.
3. Samantha sees `requiresConfirmation`, reads it back, waits for the approval verb.
4. On confirm, Samantha forwards the command frame (with the registration token).
5. ai-14all's dispatcher routes to `instructSession`; `ActGuard` checks token →
   acting-enabled → audits start.
6. `SessionInstructionRouter` resolves the worktree, reads its managed/attention state,
   and returns a `RouteDecision`.
7. `ActGuard.execute` runs the decision (a `WhisperCommand` via the runner, or
   `sendInput`), or short-circuits on `reject`; audits the result.
8. A `commandResult` (delivery ack or typed error) returns over the wire; Samantha speaks
   the outcome.

## 14. Testing (TDD)

- **`SessionInstructionRouter` truth table** — every `TargetSessionState` permutation
  (managed running / paused / escalated / halted; unmanaged idle / waiting / ready /
  active / stale / failed; no live session) maps to the expected route or rejection.
  Pure, no mocks beyond the state fixture.
- **`ActGuard` chokepoint** — token invalid → `unauthorized`; toggle off →
  `acting-disabled`; happy path audits start and result; a `reject` is still audited.
- **Dispatcher branch** — `instruct-session` frame dispatches through the callback and
  returns the correlated `commandResult`.
- **Capability descriptor** — `instruct-session` advertised with `requiresConfirmation` /
  `risk` and the worktree/instruction `inputSchema`.

## 15. Out of scope

- `start-session` (spinning up a new session — its repo/branch/agent/task selection is a
  separate surface).
- Autonomous acting (Samantha-originated commands) — S5 triage.
- Instruction queueing / deferred delivery — rejected by design (§6).
- Any relaxation of the user-voiced-only constraint.

## 16. Open questions deferred to the plan

- **Exact managed safe-state predicate.** `workflow-pause` is a CLI command, not a
  persisted column on `WhisperWorktreeState`, so "paused" is not directly observable. The
  plan pins the precise predicate (which combination of `workflow.status`, `escalation`,
  `haltReason`, and bindings constitutes a safe input point) against the whisper store
  reader's real fields.
- **Target-agent derivation.** `collab-tell` needs a `target` (`claude | codex | ezio`);
  derive it from the worktree's active binding/provider (`SamanthaWorktreeSlice.provider`
  or `WhisperWorktreeState.bindings`).
- **workspaceId resolution.** `WhisperCommand` needs `{ workspaceId, worktreeId }`, but
  the observe key resolves only to a `worktreeId`; the plan adds workspaceId resolution.
- **Token issuance/wire mechanism** (§8) — settled against Samantha's real server.

## 17. References

- `docs/superpowers/specs/2026-06-21-samantha-14all-integration-highlevel-design.md` — roadmap (§5), security posture (§7), cross-repo footprint (§8)
- `docs/superpowers/specs/2026-06-22-samantha-integration-s2a-command-channel-design.md` — the command wire S3 reuses
- ai-samantha `docs/superpowers/specs/2026-06-23-samantha-integration-s2b-voice-tool-bridge-design.md` — self-describing capability contract + the `requiresConfirmation`/`risk` forward hook
- `shared/contracts/plugins.ts` — `WhisperCommand` surface; `SamanthaWorktreeSlice`
- `services/plugins/whisper/whisper-command-runner.ts` — `commandToArgv`, `createWhisperCommandRunner`
- `services/plugins/whisper/whisper-collab-watcher.ts`, `shared/models/ecosystem-plugin.ts` — `WhisperWorktreeState`
- `services/terminals/terminal-service.ts` — `sendInput` (unmanaged fallback)
- `shared/models/agent-attention.ts`, `services/mcp/agent-attention-bridge.ts` — attention state
- `services/plugins/samantha/samantha-command-dispatcher.ts`, `samantha-driver.ts`, `samantha-command-capabilities.ts`, `command-types.ts` — the samantha plugin seam
- `services/plugins/plugin-config.ts` — per-plugin config + behavior toggles
- `services/diagnostics/plugin-command-logger.ts` — audit-log pattern
</content>
</invoke>
