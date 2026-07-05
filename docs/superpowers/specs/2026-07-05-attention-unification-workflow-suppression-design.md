# Attention Unification + Workflow Suppression Design

**Date:** 2026-07-05
**Status:** Approved (brainstormed with Vu; all decisions locked)

## 1. Overview and Motivation

Three related problems in the sidebar attention pipeline:

1. **Two agent-detection systems drifted apart.** `KNOWN_AGENTS` in
   `src/features/terminals/logic/agent-attention.ts` (`codex`, `claude`,
   `claude-code`) drives `agentDetected`, which gates the output classifier and
   lifecycle attention reasons. `detectAgentProvider` in
   `src/features/workspace/logic/agent-provider-detection.ts` drives the
   provider badge and knows all five providers (`claude`, `codex`, `ezio`,
   `cursor`/`agent`, `antigravity`/`agy`), the `ai-ezio` alias, and
   whisper-mount command forms. Consequence: ezio shells and whisper-mounted
   sessions never set `agentDetected`, so they silently lose the smart
   classifier and lifecycle failed/ready reasons.
2. **Autonomous whisper workflows generate useless NEEDS YOU noise.** While a
   workflow runs, agent MCP `waiting`/`failed` reports and terminal-heuristic
   matches raise `actionRequired`, but there is nothing for the user to act on
   unless the workflow itself escalates, halts, or completes. Those three
   verdicts already arrive through the workflow lens (`workflow` source).
3. **`report_session_status` consumes ~7% of weekly token usage.** Most of the
   volume comes from workflow turns, where every handoff triggers task-start /
   ready pushes from both mounted agents — all redundant with the workflow
   lens. Separately, the terminal-heuristic classifier keeps firing (and
   re-raising attention) even when an agent is actively self-reporting over
   MCP, making the heuristics noise rather than a fallback.

## 2. Decisions

- **D1 — Suppress all non-workflow attention during a run.** While a whisper
  workflow is active on a worktree, the `mcp` source is ignored entirely (all
  states) and terminal/legacy heuristics may not produce `actionRequired`;
  process rows still show `active`/`idle` so the run is visibly working. The
  `workflow` source is the sole verdict authority: escalation or `halted` →
  NEEDS YOU; `done` → ready.
- **D2 — The "do not push status during workflow turns" rule lives in both
  repos.** ai-14all's session-status skill gains a workflow exception, and
  ai-whisper's workflow handoff/resume templates gain the matching explicit
  instruction. Belt and braces; either alone covers a stale copy of the other.
- **D3 — One detection mechanism: `detectAgentProvider`.**
  `agentDetected := detectAgentProvider(command, label, null) !== null`. The
  `KNOWN_AGENTS` list and its token-matching machinery are deleted.
- **D4 — Heuristics are a true fallback, sticky per agent generation.** The
  first accepted MCP report flips the worktree into self-reporting mode;
  terminal + legacy heuristics stop contributing (and stop running) for agent
  processes in that worktree until every detected agent process has exited.
- **D5 — Display-layer implementation.** Suppression (D1) is evaluated in the
  pure derivation functions at render time. State keeps recording every
  reason; nothing is dropped at the reducer or main-process layer. (Chosen
  over reducer-layer dropping — which destroys information — and a
  main-process gate — wrong layer, no whisper state there.)

## 3. Unified Detection (D3)

`agent-attention.ts` deletes `KNOWN_AGENTS`, `tokenize`, `basenameLast`,
`matchesKnownAgent`, and `commandMatches`. `isAgentProcess` keeps its
signature and delegates:

```ts
export function isAgentProcess(label: string, command: string | null): boolean {
	return detectAgentProvider(command, label, null) !== null;
}
```

All four `agentDetected` assignment sites are unchanged
(`use-process-actions.ts:115,228`, `workspace-state.ts:829,900`); sticky
semantics are preserved by the existing `||` at the label-change site.

**Parity fix folded in:** the old list matched the binary name `claude-code`;
`CLAUDE_COMMAND` does not. Widen it to:

```ts
const CLAUDE_COMMAND = /(?:^|[\s/\\])claude(?:-code)?(?=\s|$)/i;
```

**Parity deliberately dropped:** version-suffixed binaries
(`claude-1.2.3`-style, matched by the old suffix rule) are no longer detected.
The real CLI binary is `claude`; YAGNI.

**Behavioral consequences (all intended):**

- ezio shells (both `ezio` and `ai-ezio`) become detected agents: classifier
  fallback, lifecycle failed/ready reasons on exit, provider badge — all
  consistent.
- Whisper-mounted forms (`whisper collab mount <agent>`) are detected via the
  existing trailing-token regexes.
- cursor (`agent`) and antigravity (`agy`) gain classifier fallback and
  lifecycle reasons. Correct: they have no MCP skill, so heuristics are
  exactly their coverage.
- adHoc shells with only an OSC title keep working via `matchLabel`. Note this
  deliberately **widens** label matching vs the old strict first-token rule
  (e.g. title "Claude Code" now detects; previously case-sensitive first-token
  only) — it matches what the provider badge already did, and label promotion
  still applies only while provider is null, sticky thereafter.

## 4. Workflow Suppression, Display Layer (D1 + D5)

**Flag derivation (App.tsx, where whisper lens state already lives):**

```
suppressed(worktreeId) :=
  lens.daemonAlive === true
  && lens.workflow !== null
  && lens.workflow.status ∈ {"running", "paused"}
```

The flag flows into both pure functions in `sidebar-shell-summary.ts`:

- `buildWorktreeProcessSummary(processes, now, maxRows, { suppressActionRequired })`
  — `deriveState` skips its `actionRequired` branch when suppressed; the row
  falls through to `active`/`idle` by recency. No process row of that worktree
  can show the red state while a workflow runs.
- `buildWorktreeAttentionDisplay({ ..., suppressNonWorkflow })` — when
  suppressed, `mcp`-source candidates are ignored entirely (`waiting`,
  `failed`, and `ready`; during a run the `workflow` source owns all
  verdicts). The `workflow` source passes through untouched: escalation or
  `halted` → `waiting` (NEEDS YOU), `done` → `ready`.

Suppression is evaluated at render; when the workflow ends (`done`,
`canceled`, snapshot vanished, or daemon dead) the flag drops and normal
derivation resumes. Reasons still fresh (<`STALE_THRESHOLD_MS` = 120 s)
resurface on their own; older ones have already aged out.

The workspace rollup dot (`rollupWorkspaceAttention`) needs no change — it
consumes the already-suppressed tiers.

## 5. Self-Reporting Mode (D4)

New runtime-only field `WorktreeSession.mcpReportingActive: boolean`
(default `false`; **not persisted** — it resets naturally on app restart
because the processes it describes are dead).

- **Set `true`:** in reducer case `session/reportAgentAttention` when the
  reason's source is `mcp` and the push is accepted (`replaced === true`).
  The existing one-shot `clearStaleTerminalReasonsForSessionProcesses` sweep
  at that moment stays — it clears residue; the new flag prevents
  re-accumulation.
- **Reset `false`:** in reducer case `session/updateProcessStatus`, when a
  process transitions out of `running` and no other running `agentDetected`
  process remains in that worktree.
- **Gate:** in `use-terminal-runtime.onOutput`, for processes where
  `process.agentDetected && session.mcpReportingActive`:
  - skip `classifyOutput` entirely — no terminal-source reason, no classifier
    telemetry emit, no hot-path regex work;
  - pass legacy `attentionState` as `"activity"` instead of calling
    `deriveAttentionState`.

**Scope refinement (deliberate):** the mute applies only to **agent**
processes. A plain shell in the same worktree (builds, tests) keeps its
`error:`/`failed` legacy patterns — the reporting agent vouches for itself,
not for neighboring shells. Accepted side effect: in a duo worktree, once
either mounted agent MCP-reports, the other agent's heuristics mute too
(worktree-level flag); both duo agents are reporters by contract, so nothing
is lost.

## 6. Usage Lever (D2)

**ai-14all deliverable:** `assets/agent-skills/ai-14all-session-status/SKILL.md`
(and the installed copy under `~/.claude/skills/`) gains a
"Workflow exception" section:

> If the message you are acting on is an ai-whisper workflow handoff (or a
> workflow resume notice), do not call `report_session_status` at all during
> that turn — the app's workflow lens already tracks the run. Resume normal
> lifecycle pushes on ordinary interactive turns.

§6 (resume registration) is untouched: it fires once per session, not per
turn, and is not a cadence problem.

**ai-whisper deliverable (separate repo, separate commit):** the workflow
handoff and resume-notice templates gain the matching line ("Do not push
ai-14all session status during workflow turns."). Template covers agents with
stale skill copies; skill covers templates that predate the change.

Normal interactive sessions keep the full five-moment push contract, so the
sidebar task line continues to work outside workflows.

## 7. Edge Cases

- `paused` → suppressed (the operator paused it and knows).
- `canceled` / `done` / workflow snapshot vanished → suppression lifts; the
  lens diff already clears the workflow reason.
- `daemonAlive === false` → **not** suppressed: agents are effectively
  unmanaged, normal attention applies.
- Stale lens row (transient read failure retains the prior snapshot with
  `stale: true`) → prior suppression state holds; self-corrects on the next
  poll.
- Lens warm-up: on app/repo load the whisper driver needs its first snapshot
  (poll/event/worktree-change triggered) before a running workflow is visible,
  so suppression can read `false` for a few seconds. Acceptable: D2 means
  agents aren't pushing during workflow turns anyway, and the window closes on
  the first snapshot.
- MCP report races the last agent process exit → flag set, then the next
  status transition resets it; harmless.
- App restart → `mcpReportingActive` resets with the runtime state; restored
  placeholder processes re-detect on spawn.

## 8. Testing (unit-level)

- **Detection matrix:** all five providers × bare command / absolute path /
  whisper-mount form / `npx` form / adHoc title-only, plus parity pins for
  `claude-code` and `ai-ezio`, and negative cases (`claudette`,
  `claude-helper`, `npm run agent`).
- **Suppression:** `deriveState` and `buildWorktreeAttentionDisplay` with the
  flag on/off per source; regression pin that a workflow escalation still
  yields NEEDS YOU while suppressed; pin that `done` yields ready.
- **Flag lifecycle:** set on accepted `mcp` push; unaffected by rejected
  (stale) pushes and by `workflow`-source reports; resets when the last
  running agent process exits; survives unrelated actions.
- **Runtime gating:** classifier not invoked and legacy patterns bypassed for
  agent processes while the flag is set; non-agent shells unaffected (existing
  hook test harness covers the seam).

## 9. Out of Scope

- Whisper-mounted session **resume** (registered resume command cannot
  restore the mount) — separate follow-up already recorded in the ledger.
- tmux-backed terminal persistence — deferred
  (`mem-2026-07-05-deferred-tmux-backed-terminal-43d134`).
- Deleting the `agentDetected` boolean in favor of deriving from `provider`
  — candidate future simplification; not worth the persisted-model churn now.
