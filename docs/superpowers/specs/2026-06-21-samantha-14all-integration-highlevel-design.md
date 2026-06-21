# ai-14all ↔ ai-samantha — High-Level Integration Plan

**Date:** 2026-06-21
**Status:** Approved high-level plan. No concrete slice spec or code yet — this
document fixes the integration *shape* so each slice can be spec'd against a
settled architecture.
**Scope:** The whole bi-directional integration, sliced for incremental delivery.
This is a *plan*, not a slice spec; exact schemas and capability lists are
deferred to per-slice specs (see §9).

## Context

`ai-whisper` has been merged into `ai-14all` as an in-process plugin
(`services/plugins/whisper/`). That collapsed the two upstream sources Samantha
was originally going to observe (the desktop session host and the workflow
engine) into a single host: **ai-14all**. So the integration question is now
"how should Samantha and ai-14all talk," singular.

Samantha is the **proprietary** voice-first companion that sits *above* ai-14all
in the supervision hierarchy. This plan is the output of a brainstorm that
settled the integration's architecture and roadmap. Inputs:

- `ai-samantha` repo: `local-docs/ai-samantha/brainstorm/2026-06-21-samantha-14all-integration-handoff.md` (verified contract surface + open questions)
- `ai-samantha` repo: `local-docs/ai-samantha/brainstorm/2026-06-12-ai-14all-first-integration-research.md` (original research)
- `ai-samantha` repo: `local-docs/ai-samantha/knowledge-references/ecosystem-role.md`

## 1. Goal & vision

A **bi-directional** integration: Samantha **observes** ai-14all (rich state
flows out), **speaks** when it matters (her existing speech matrix), and **acts**
on it (commands flow in). The long arc is an autonomy ladder:

```
observe → notify → direct → triage
```

The supervision hierarchy this serves:

```
user
 └─ samantha   — supervisor: watches, reasons, triages, escalates
     └─ ai-14all   — session host: worktrees, shells, attention states
         └─ ai-whisper — workflow engine (now in-process): SDD / ralph loops
             └─ agents   — claude / codex doing the actual work
```

**The plan covers the full ladder. The build slices it** (§4). The first
shippable unit deliberately reaches just far enough to be *dogfoodable* as a
supervising voice companion — observe plus benign action — because status flowing
outward alone cannot prove the companion is useful; you have to be able to ask
her to act.

## 2. Decisions locked

These were settled during the brainstorm and are the load-bearing decisions:

1. **Scope** — the plan is full bi-directional (observe + speak + act, through
   triage); the build is sliced for divide-and-conquer.
2. **One exclusive supervisor** — ai-14all hardcodes exactly one supervisor:
   Samantha. There is **no generic external-supervisor extension point**. This
   exclusivity is intentional: Samantha as the sole supervisor of the whole
   ecosystem is the proprietary product's moat. The contract is therefore
   Samantha-specific; we do not abstract it for hypothetical future supervisors
   (YAGNI).
3. **Samantha is an inverted plugin** — it slots into ai-14all's existing plugin
   registry beside `whisper` and `cortex`, but its data flow is inverted (§3).
4. **Samantha owns the server; ai-14all is the client** — Samantha keeps her
   existing HTTP + WebSocket server on `127.0.0.1:7841`. ai-14all's Samantha
   plugin registers into it. All Samantha-specific wire is isolated behind one
   driver module for isolation and testability.
5. **Rich contract, not lossy summaries** — the observe payload is a structured,
   per-worktree / per-task state document including recent history, not a
   flattened summary string (§4). Rationale: richer data lets Samantha reason
   better and issue better commands later. The rich observe contract is a
   deliberate investment in the act/triage side.
6. **First build unit = S1 + S2** — observe (rich state out) plus benign action
   (read-only commands), shipped together as the minimal dogfoodable duplex loop.

## 3. Architecture — Samantha as ai-14all's one exclusive supervisor plugin

Samantha is a **hardcoded plugin** in ai-14all's registry
(`services/plugins/plugin-registry.ts`), reusing the plugin shell that `whisper`
and `cortex` already use:

- **TOML opt-in** — `~/.ai-14all/config.toml` → `[plugins.samantha] enabled`.
- **Probe** — detect Samantha's server on `:7841`; if absent, stay silent.
- **Plugins-panel presence** — status chip + value pitch, like the other plugins.
- **Graceful absence** — ai-14all works identically when Samantha is off or not
  running. The integration is opt-in; absence is silent.

It is an **inverted plugin** — this is the genuinely new design work, because the
existing plugin archetype models peers that ai-14all *consumes*:

| Plane    | whisper / cortex (existing)     | **samantha** (new)                 |
| -------- | ------------------------------- | ---------------------------------- |
| Data     | ai-14all *reads* peer state     | ai-14all *pushes* its own state out |
| Control  | ai-14all *sends* commands       | ai-14all *receives* commands       |

Samantha reuses the registry, opt-in, probe, and panel scaffolding for free; its
**driver internals are a new shape** — an outbound/supervisor driver rather than
the existing inbound/resource drivers.

**The seam.** All Samantha-specific wire (register / snapshot / event HTTP plus
command WebSocket) lives in one `services/plugins/samantha/` driver module. This
isolates the contract in a single place and lets tests mock Samantha's server.

## 4. The contract (Samantha-specific)

### 4.1 Observe (state out)

Plain HTTP, against Samantha's existing server:

- **Register** — `POST /connectors/register` once on startup, with the Samantha
  plugin's capability list.
- **Snapshot** — `PATCH /connectors/ai-14all/snapshot` on each meaningful state
  change, debounced. **Idempotent full-state**: each PATCH carries the complete
  rich state document, not partial diffs.
- **Events** — `POST /connectors/ai-14all/events` on each accepted transition,
  carrying the mapped signal (§4.3) and a rich `details` payload.

**The rich state document** (snapshot `details`) is the heart of the observe
contract. Sketch — exact fields are deferred to the S1 spec (§9):

```jsonc
{
  "version": 1,
  "app": { "focusedWorktreeId": "...", "mode": "..." },
  "worktrees": [{
    "id": "...", "branch": "feature/auth", "repo": "...", "path": "...",
    "session": {
      "agent": "claude", "attention": "waiting",
      "summary": "3 tests failing in workspace-state.test.ts",
      "task": "wire theme toggle", "nextAction": "answer question",
      "updatedAt": 0
    },
    "reviews": { "pending": 2 },
    "workflow": { "kind": "SDD", "phase": "2/4 implement", "escalation": null },
    "recent": [
      { "at": 0, "from": "active", "to": "waiting", "summary": "...", "source": "mcp" }
    ]
  }]
}
```

- The spoken TTS `summary` is **derived** from this document; the document is the
  substance.
- `status` (`ok | warning | error | unknown`) is **worst-of** across worktrees.
- The `recent[]` ring gives Samantha "what happened," not just current state, so
  she has history even on a fresh or late connect.

### 4.2 Act (commands in)

WebSocket, against the same server path. Samantha's current command frame is
`{type:"command", capabilityId}` with **no arguments, no requestId, no ack**.
The act contract **extends** it:

```jsonc
{ "type": "command", "capabilityId": "...", "args": { }, "requestId": "..." }
```

plus an ack / result convention so the issuer learns whether a command was
delivered and what happened (e.g. a `commandResult` frame or an event echoing
`requestId`). This extension is a **Samantha-side change** and lands when the
command channel first ships (S2).

### 4.3 Signal mapping

Adopt the candidate mapping; refine concrete edge cases (e.g. `stale` / `idle`
internal states) in the S1 spec:

| ai-14all condition                            | Samantha signal     |
| --------------------------------------------- | ------------------- |
| session `waiting` (blocked on user)           | `attentionRequired` |
| session `failed`                              | `error`             |
| session `ready` (task done, review me)        | `taskCompleted`     |
| session `active`                              | `update`            |
| workflow halted / relay chain escalated       | `attentionRequired` |
| infrastructure failure                        | `error`             |
| phase done / round started / paused / resumed | `update`            |

The `attentionRequired` and `error` signals cut through every Samantha mode
including AFK; `update` is a silent UI refresh. This is Samantha's existing,
already-built behavior — the observe slice activates it without Samantha-side
speech changes.

## 5. Build roadmap (divide & conquer)

| Slice | Delivers | Repos touched | Security surface |
| --- | --- | --- | --- |
| **S1 + S2 — first unit (dogfood)** | Inverted Samantha plugin + rich observe, **and** benign act (`focus-worktree`, `session-report`). Proves the full duplex round-trip and the daily companion value. | **ai-14all** (the plugin) + **samantha** (extend command frame; wire LLM tool-calls) | none — loopback only, no agent is touched |
| **S3 — Real act** | `instruct-session` / `start-session`. Workflow-aware routing. **Approval gate + audit log + registration token.** | ai-14all + samantha | real — all guards land here |
| **S4 — Harden** | reconnect, dedup verification, cross-repo integration tests, GUI smoke. | both | low |
| **S5 — Triage** | escalation autonomy envelope (the ultimate rung). **Gated on real S1–S3 usage data** — not designed from speculation. | both | highest |

**Why S1 and S2 ship together.** Observe alone proves Samantha can *see*, but the
supervising-companion value only becomes real once you can also ask her to *act*
("focus the auth session," "check on the agents"). Benign action has zero blast
radius (it touches no agent), so it is safe to bundle into the first dogfood unit
while still exercising the whole command round-trip.

**Cross-repo from day one.** Because S2 is in the first unit, the first milestone
spans both repos: ai-14all builds the inverted plugin, and Samantha gets two
changes — the extended command frame (§4.2) and wiring her LLM so it can invoke
connector capabilities as tool calls (otherwise commands fire only from her
ConnectionsPanel UI, never from voice, which defeats the dogfood). The state of
Samantha's LLM tool-calling is to be verified first.

## 6. Key de-risk: the whisper merge

The original research feared raw PTY injection into a whisper-managed session
corrupting the workflow's own input stream. **The merge mostly solves this by
construction.** Whisper now runs in-process and exposes a sanctioned command
surface, `WhisperCommand` (`shared/contracts/plugins.ts`):
`workflow-pause/resume/cancel`, `collab-tell`, `collab-recover`. So S3's
`instruct-session` routing becomes:

- session **owned by a whisper workflow** → route through `WhisperCommand`
  (`collab-tell`, `workflow resume --message`) — sanctioned and safe.
- **unmanaged shell** → state-aware `sendInput` PTY queue, as the fallback only.

Raw mid-turn TUI injection is no longer the primary path, which removes much of
S3's danger.

## 7. Security posture

- **Loopback-only is acceptable through S1 + S2.** Benign capabilities touch no
  agent; both apps bind `127.0.0.1`.
- **The registration token, approval gate, and audit log are S3 preconditions** —
  the moment a command can actually drive an agent. They are not built earlier
  because nothing before S3 has blast radius.
- Origin-based trust (user-voiced vs Samantha-autonomous) and any
  auto-accept relaxation are S3+ concerns, designed when real directing exists.

## 8. Cross-repo footprint (summary)

| Slice | ai-14all | ai-samantha (proprietary) |
| --- | --- | --- |
| S1 | inverted plugin: register/probe/snapshot/events, rich state document, signal mapping | none (server already accepts register/snapshot/events) |
| S2 | WS command receive + dispatch for benign caps | extend command frame (args/requestId/ack); wire LLM tool-calls |
| S3 | instruct/start-session, workflow-aware routing, approval gate, audit log, token | token issuance; richer command args; result handling |
| S4 | reconnect/dedup/tests | integration test counterpart |
| S5 | escalation context surfacing | autonomy envelope reasoning |

## 9. Deferred to per-slice specs

Not decided here, on purpose — these are slice-spec detail, not plan-level forks:

- Exact rich-state schema fields and versioning rules.
- Exact benign-capability list for S2 (beyond `focus-worktree`, `session-report`).
- Snapshot debounce timing and `recent[]` ring size.
- The precise ack / result frame shape for the act contract.
- Samantha's LLM tool-call wiring (verify what exists before building).
- `stale` / `idle` handling in the signal mapping.

## 10. Open questions carried forward

These remain genuinely open and will be resolved in the slice that needs them:

- **Autonomy envelope contents (S5)** — which escalation responses Samantha may
  take unsupervised. Resolved from real usage data, not speculation.
- **AFK reach** — local TTS does not reach a truly-away user; a remote
  notification channel (e.g. phone push) is parked until after the core ladder is
  proven.
- **`high_level_plan.md` roadmap swap** — the ai-14all roadmap doc still predates
  this direction; update it when this plan is confirmed.

## References

- `services/plugins/plugin-registry.ts`, `services/plugins/plugin-config.ts` — plugin shell precedent
- `services/plugins/whisper/`, `services/plugins/cortex/` — existing (inbound) driver precedents
- `services/mcp/agent-attention-bridge.ts` — single attention pipeline (observe tap point)
- `shared/models/agent-attention.ts` — attention state enum
- `shared/contracts/plugins.ts` — `WhisperCommand` surface (S3 routing)
- `services/terminals/terminal-service.ts` — `sendInput` (unmanaged-shell fallback)
