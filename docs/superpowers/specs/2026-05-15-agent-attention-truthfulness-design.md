# Agent Attention Truthfulness — Phase 1 Spec

**Date:** 2026-05-15
**Status:** Approved

## Problem

The sidebar's per-session attention card is unreliable. In real-world usage the card frequently shows `failed` when the agent has actually completed its task successfully and is reporting findings. The user has to click into the terminal, read the latest agent output, and mentally recall what task they originally gave the agent to make sense of the indicator. The signal-to-noise problem is bad enough that the card adds confusion instead of removing it.

Two distinct failures contribute:

1. **Stuck classifier verdicts.** The passive terminal-output classifier matches loose keywords (`error | failed | exception`) and stores `failed` reasons that stick until explicit dismissal. Later success doesn't clear them. In the user's codex example, the agent ended a successful spec review with "no remaining blockers / issue is fixed", but the card still said `failed` because an earlier match (likely from the `▶▶bypass` Claude Code permission marker or similar transient output) was stuck.

2. **Missing task context.** Even when the card's state is correct, "waiting: needs decision on Y" without "Task: review spec X" forces the user to recall what each agent was working on. In the fan-out workflow (give agent A a task, switch to B, switch to C, come back), the user has lost task context by the time they return.

## Decision

Phase 1 fixes both failures with the minimum scope that demonstrably works:

- **MCP push becomes authoritative.** When an agent pushes any non-`failed` state via `report_session_status`, the reducer clears stuck terminal-classifier `failed` reasons for that session's processes. Lifecycle-source `failed` (real nonzero process exit) is preserved.
- **Add a `task` field to the MCP contract** so agents can declare what mission they were given. Surfaced in the sidebar card as a single muted line above the per-process state rows.
- **Ship a bundled `ai-14all-session-status` skill** that teaches Claude and codex when and how to push. Installs alongside the existing review skill via the same installer.
- **Fix agent-provider identification and surface it** as a small color-tinted badge in the card (Claude = orange, codex = blue), so the user can instantly see which agent is in which row.
- **Add diagnostic telemetry** that logs every classifier verdict, MCP push, lifecycle event, and resolution to a daily JSONL file. Lets the user analyze a week of real usage to drive Phase 2's classifier improvements with data, not vibes.

Phase 1 does **not** modify the classifier's pattern set — that's Phase 2, deferred and separately specced.

## Approach: Phased ship

Two slices land independently.

**Phase 1 (this spec, ~3-4 days):** all of the above. Targets the user-visible pain seen in the screenshot, with telemetry to inform Phase 2.

**Phase 2 (deferred, ~1 week, separately specced):** classifier pattern narrowing (`panic:`, `Traceback`, line-anchored compiler errors), ANSI stripping before classification, negation / word-boundary handling, possibly replacing the keyword zoo with a smaller high-confidence set informed by Phase 1's telemetry data.

---

## Architecture Changes

### Added

| File | Purpose |
|------|---------|
| `assets/agent-skills/ai-14all-session-status/SKILL.md` | New always-active skill teaching agents to push status |
| `services/diagnostics/agent-attention-logger.ts` | Main-process JSONL writer for attention events |
| `scripts/dump-attention-log.mjs` | CLI to read / filter the diagnostic log (`pnpm diag:attention`) |
| `tests/unit/diagnostics/agent-attention-logger.test.ts` | Logger unit coverage |
| `tests/unit/workspace/mcp-clears-stale-failed.test.ts` | Reducer unit coverage for the new MCP-priority rule |

### Modified

| File | Change |
|------|--------|
| `shared/contracts/agent-attention-bridge.ts` | Add `task: z.string().min(1).max(200).nullable().optional()` to `report_session_status` schema |
| `shared/models/agent-attention.ts` | Add `AgentProvider = "claude" \| "codex" \| "other"` type |
| `shared/models/worktree-session.ts` | Add `task: string \| null` field |
| `shared/models/process-session.ts` | Add or normalize `provider: AgentProvider \| null` field |
| `services/mcp/ai14all-mcp-server.ts` | Forward `task` through to the bridge; update tool description |
| `services/mcp/agent-attention-bridge.ts` | Carry `task` through the IPC payload |
| `src/features/terminals/logic/agent-attention-renderer-bridge.ts` | Include `task` in the dispatched action |
| `src/features/workspace/logic/workspace-state.ts` | Reducer: handle `task` in MCP action; clear stale terminal `failed` rule |
| `src/features/workspace/logic/sidebar-shell-summary.ts` | Surface `task` + `provider` in worktree summary + `SidebarShellRow` |
| The sidebar card component (locate via `grep` for `SidebarShellRow` consumers under `src/app/components/`) | Render task line + provider badge |
| `src/app/shell.css` | Provider tokens (light + dark), `.shell-sidebar__card-task`, `.shell-sidebar__provider-badge` |
| `services/review/agent-skill-installer/claude-provider.ts` | Install both skills |
| `services/review/agent-skill-installer/codex-provider.ts` | Install both skills |
| The process-spawn / CLI-title-observed handlers (existing v2 logic that sets `agentDetected`; locate via `grep` for `agentDetected`) | Refined provider detection: command line is primary signal (sticky), CLI title secondary |

### Not modified in Phase 1

- Terminal-output classifier patterns (`agent-attention.ts:54-67`) — Phase 2.
- Lifecycle event source (process exit nonzero → failed) — already correct.
- 120s `STALE_THRESHOLD_MS` and derivation — already correct.
- Clearing-on-view behavior (`agentAttentionClearedAt`) — already correct.

---

## MCP Contract Change

Add `task` to `report_session_status`:

```ts
// shared/contracts/agent-attention-bridge.ts (additions)
task: z.string().min(1).max(200).nullable().optional(),
```

**Semantics:**

- `task` is the high-level mission the agent is currently working on, e.g. `"Review spec docs/superpowers/specs/2026-05-15-agent-status.md"`.
- `null` means "no active task" (agent is idle / between missions).
- `undefined` means "agent didn't push a value this time — keep whatever was previously set".
- Lifetime: persists in renderer state for the session until either (a) the next MCP push includes a non-`undefined` `task` value (replacing it), or (b) the worktree is removed.
- Length cap matches `summary` and `nextAction`.

**Storage:**

- Session-level field on `WorktreeSession`: `task: string | null`.
- Reset to `null` on app restart / session restore (consistent with the v2 non-persistence rule for attention reasons).

**Tool description update:**

Adds a paragraph telling agents to set `task` once at task-start, leave it in subsequent pushes for the same mission, update it only on pivot, and `null` only when idle.

**Backward compatibility:**

Old clients (existing Claude / codex installs without the new skill) don't send `task`. Field stays `null`. Card omits the task line. No regression.

---

## MCP Priority & Stale Clearing

The reducer rule that fixes the "stuck `failed`" symptom.

When `session/reportAgentAttention` arrives with `source: "mcp"` and `state ∈ {"active", "waiting", "ready"}` (i.e. **any state except `failed`**):

1. Standard reason-update proceeds (store the MCP reason on the session, source-keyed).
2. **Iterate all process entries on the same session.** For each process, if its `agentAttentionReasons.terminal?.state === "failed"`, remove that `terminal` entry.
3. **Recompute each affected process's `attentionState`** from its remaining `agentAttentionReasons` (the existing derivation in `workspace-state.ts:868` that runs when reasons change). After deletion, a process whose only `failed` evidence was the deleted terminal reason will drop from `actionRequired` back to a non-attention state.
4. **Recompute the worktree-level attention state** (the rollup that drives the sidebar card's overall attention indicator) once all affected processes have been recomputed.

Lifecycle-source `failed` (real nonzero process exit) is **not** removed — that's truthful evidence of a crash, not a heuristic false positive.

The displayed-state ranking (`AGENT_ATTENTION_RANK`) is **not** modified for cross-source comparison. Clearing the bad classification is sufficient; once it's gone, the natural ranking picks the right thing.

**Same-source MCP push semantics — overwrite, don't rank-gate:**

The existing `shouldReplaceAgentAttentionReason` guard (`src/features/terminals/logic/agent-attention.ts:94`) prevents weaker signals from overwriting stronger ones based on `AGENT_ATTENTION_RANK`. This is correct for **cross-source** noise (e.g. terminal classifier should not downgrade an MCP-pushed `waiting`), but **incorrect for same-source MCP pushes**: if the agent pushes `waiting` and later pushes `active` (i.e. resumed work), the lower-rank `active` would currently be blocked, leaving the card stuck on `waiting`.

Updated rule: **same-source MCP-source pushes always overwrite the previous same-source MCP entry, regardless of rank.** Use `reportedAt` to break ties if events arrive out of order (newer `reportedAt` wins; older silently dropped). Cross-source replacement keeps the existing rank-based guard.

This change is scoped to `source: "mcp"`. Terminal-source and lifecycle-source replacement semantics are unchanged.

**Edges:**

- *Lifecycle `failed` + MCP `ready`*: lifecycle stays, card shows `failed`. Correct — agent claimed success but process actually died.
- *Out-of-order MCP pushes*: newer `reportedAt` wins; older ignored.

---

## Skill: `ai-14all-session-status`

A new always-active bundled skill teaching agents to push status at lifecycle transitions.

**Push triggers** (5 lifecycle moments):

1. **Task start** — user gives a new high-level mission:
   ```js
   report_session_status({
     state: "active",
     task: "<≤200 chars summary of mission>",
     summary: "Starting <task>",
     nextAction: null,
   })
   ```

2. **Waiting on user input** — agent has to stop and ask:
   ```js
   report_session_status({
     state: "waiting",
     task: "<unchanged from start>",
     summary: "<what specifically is blocking>",
     nextAction: "answer the question above",
   })
   ```

3. **Task complete** — agent finished the mission, deliverable in buffer:
   ```js
   report_session_status({
     state: "ready",
     task: "<unchanged>",
     summary: "<what was produced; ≤200 chars>",
     nextAction: "<e.g. 'review findings'>",
   })
   ```

4. **Task failed / aborted** — agent could not complete, won't retry without input:
   ```js
   report_session_status({
     state: "failed",
     task: "<unchanged>",
     summary: "<what blocked completion>",
     nextAction: "<recovery action>",
   })
   ```

5. **Task pivot** — user explicitly redirects mid-stream:
   - Same shape as #1, with the new `task` value (overwrites earlier).

**Not push triggers:** routine tool calls, per-turn progress, self-talk / planning steps.

**Installation:**

The existing skill installer (`services/review/agent-skill-installer/`) is refactored from a single-skill installer to a multi-skill installer iterating a list. Both `ai-14all-fix-review` and `ai-14all-session-status` install together when the user runs the existing "Install agent skill" action. Claude provider installs to `~/.claude/skills/`, codex provider installs to `~/.codex/skills/`.

**Agent coverage:**

- Claude with the skill: full coverage.
- Codex with the skill: full coverage.
- Anything else: degraded to classifier + lifecycle only. Diagnostic log will surface how often this matters.

---

## Sidebar Card UI

Add a single `Task:` line per worktree card when the session has a non-null `task`. Sits between the worktree title row and the per-process state rows. Each process row gains a small provider-color-tinted badge.

**Layout:**

Before (today):
```
AI-CORTEX                 ✕
ai-cortex   master
  • ai-cort…  waiting: waiti…
  • * Pull latest c…  active…
```

After:
```
AI-CORTEX                 ✕
ai-cortex   master
↪ Review spec docs/superpowers/specs/2026-05-15-agent-status…
  • [claude]  waiting: needs decision on telemetry path
  • [codex]   active
```

**Task line visual treatment:**

- Single `↪` glyph prefix.
- `color: var(--text-muted)`, smaller font than process rows, single-line ellipsis truncation.
- Full task string in a native `title=` attribute → mouse hover shows it.
- When `task` is `null` / `undefined`: line not rendered; card collapses to today's shape.

**Provider badges:**

- Small inline-flex badges `[claude]` / `[codex]` / `[other]` next to each process row.
- Background tinted with the provider color at ~14% opacity; text in the provider color.
- Color tokens added to `:root` and the light-theme override:
  ```css
  :root {
    --provider-claude: #d97706;
    --provider-codex:  #2563eb;
  }
  [data-theme="light"] {
    --provider-claude: #b45309;
    --provider-codex:  #1d4ed8;
  }
  ```
- `other` falls back to muted-text styling.

**Provider detection:**

Refine the existing detection (the v2 design's `agentDetected` sticky-flag logic) so:
- The launched command name is the **primary, sticky** signal (`claude` / `codex` binaries detected once and never downgraded by subsequent CLI title changes).
- CLI title strings are a **secondary** hint, only promoting a previously-undetected process. Never *changes* a confirmed provider.
- Result stored as `provider: AgentProvider | null` on the process session, alongside the existing `agentDetected: boolean` (which we keep for backward compatibility with consumers that don't need the specific provider).

**MCP event `provider` derivation:**

MCP pushes are session-level, but the telemetry events still carry a `provider` field for analysis. The session's dominant provider is computed as: most-recently-active agent process's provider, or `null` when no agent process has been detected for this session.

**Sidebar collapsed state:**

When the sidebar is collapsed (icon-only mode), the task line is not rendered (card body already hidden). No special handling.

---

## Diagnostics Telemetry

A write-only JSONL log capturing every meaningful attention-state event, so the user can analyze a week of real usage and drive Phase 2's classifier work with evidence.

**Storage:**

- Path: `app.getPath("logs")`:
  - macOS: `~/Library/Logs/ai-14all/`
  - Linux: `~/.config/ai-14all/logs/`
  - Windows: `%LOCALAPPDATA%/ai-14all/logs/`
- Format: JSONL, one event per line.
- Filename: `agent-attention-YYYY-MM-DD.jsonl` (daily rotation by local date).
- Retention: keep last 7 daily files; older files pruned on app startup.
- Size cap: 10 MB per file. Mid-day overflow rolls to `agent-attention-YYYY-MM-DD.N.jsonl` with incrementing `N`. Hard cap on disk usage ≈ 70 MB worst case.
- Failure mode: write failure → `console.warn`, never blocks attention state updates.

**Event types:**

```ts
// Classifier verdict (only when classifier returns waiting/ready/failed/stale — not for neutral active)
{
  ts: number;
  type: "classifier";
  worktreeId: string;
  processId: string;
  provider: AgentProvider | null;
  state: "waiting" | "ready" | "failed" | "stale";
  matchedPattern: string;
  inputSample: string;      // up to 500 chars of the chunk that matched
  inputPrev: string;        // up to 200 chars of preceding output
}

// MCP push
{
  ts: number;
  type: "mcp";
  worktreeId: string;
  provider: AgentProvider | null;
  state: "active" | "waiting" | "ready" | "failed";
  summary: string;
  task: string | null | undefined;
  nextAction: string | null;
}

// Lifecycle event (process spawn or exit)
{
  ts: number;
  type: "lifecycle";
  worktreeId: string;
  processId: string;
  provider: AgentProvider | null;
  state: "active" | "failed";
  exitCode: number | null;
}

// Resolution event (sidebar displayed state actually changed)
{
  ts: number;
  type: "resolution";
  worktreeId: string;
  processId: string | null;     // null = session-level
  provider: AgentProvider | null;
  before: { state, source, summary? } | null;
  after: { state, source, summary? } | null;
}
```

**Architecture:**

- New module: `services/diagnostics/agent-attention-logger.ts` (main process). Exposes `appendEvent(event)`.
- Renderer dispatches an IPC notification on every attention-related state change. Channel: `DIAGNOSTICS_ATTENTION_EVENT`, one-way (no reply).
- Writes are append-only, line-buffered.
- Logger initializes on app start: creates the logs directory if missing, prunes files older than 7 days.

**Event sources:**

- **Classifier verdict** — emitted from `classifyOutput()` callsite, only when returned state is not `"active"`.
- **MCP push** — emitted from the `report_session_status` IPC handler before forwarding to the reducer.
- **Lifecycle** — emitted from process spawn / exit handlers in the terminal session manager.
- **Resolution** — emitted from a renderer-side selector watching `attentionContextByWorktreeId` for displayed-state changes.

**Reading the data:**

- New script: `scripts/dump-attention-log.mjs`. Runs as `pnpm diag:attention`. Filters: `--type=classifier`, `--state=failed`, `--worktree=<id>`, `--provider=claude`, `--days=N`. Output pretty-printed to stdout, also pipeable to `jq` / `grep`.
- No UI surface in Phase 1.

**On/off switch — opt-in:**

Logger is **off by default**. Raw terminal output may contain secrets (API keys pasted into prompts, credentials in env-var echoes, private repo paths, etc.) — capturing it unprompted is a privacy hazard even on a local-only log. Users opt in for the evaluation period via a Settings toggle or environment variable.

- New setting: `diagnostics.agentAttentionLog` with values `off | sampled | full`:
  - `off` (default): no events written; logger is a no-op.
  - `sampled`: classifier/MCP/lifecycle/resolution metadata written, but `inputSample` and `inputPrev` are replaced with `<redacted, length=N>` markers. Captures *what* happened without leaking *content*. Useful for spot-checking volume / patterns without exposing terminal data.
  - `full`: full event payloads including `inputSample` and `inputPrev`. The mode used for the week-long evaluation.

When `full` is enabled, on app start the logger writes a one-line warning to the JSONL header and emits an in-app banner reminding the user that raw terminal output is being captured to disk and where the file lives. Banner is dismissible but reappears on each cold start while in `full` mode.

This matches the existing diagnostics off/sampled/full model in the project. Defaults are safe; the user explicitly chooses the level of capture they want.

---

## Testing

**Unit:**

- Reducer: `mcp-push-clears-stale-terminal-failed` rule covers the main fix.
- Reducer: `task` field persistence, overwrite-on-push, leave-on-undefined semantics.
- Logger: event shape, daily rotation by date, retention prune (>7 days), size-cap rollover (>10 MB).
- Provider detection: command-line primary signal sticky, CLI-title secondary doesn't downgrade.
- Sidebar summary: surfaces `task` and `provider`; omits task when null.

**Integration:**

- End-to-end MCP push → reducer → sidebar → diagnostic log entry path. One test exercising the full pipeline.

**E2E (Playwright):**

Per project rules (`AGENTS.md:127`), new user-visible behavior gets E2E coverage. Extend the existing session-attention E2E suite (`tests/e2e/cumulative-flow.phase-*` or the dedicated attention test if one exists — locate via `grep`) with assertions for:

1. **Task line rendering.** After an MCP push with `task: "..."`, the sidebar card for that worktree displays the task text (matching the prefix `↪`). When the push omits `task`, the line is absent.
2. **Provider badge.** Spawn a terminal whose command identifies the agent (e.g. `claude` or `codex`), confirm the per-process row renders the corresponding `[claude]` / `[codex]` badge with the right tinted class.
3. **Stale-failed clearing.** Seed a terminal-source `failed` reason via the existing test harness, then dispatch an MCP `ready` push, then assert the worktree card no longer shows `failed` and the process row's `attentionState` is no longer `actionRequired`.

These extend the existing attention E2E rather than creating a new file, keeping the suite shape stable.

---

## Success Criteria

- Codex / Claude sessions completing tasks no longer show stale `failed` cards.
- Sidebar card shows current task summary for sessions with cooperative agents.
- Per-process rows show provider badges; provider detection correct for Claude vs codex (verified by manual smoke across both).
- One week of diagnostic JSONL captures enough data to answer:
  - How many `failed` classifier verdicts fired, broken down by `matchedPattern`?
  - For each `failed` verdict, was there an MCP push within ±60s that contradicted it?
  - Which `displayed=true` resolutions had `source: "terminal"` and `state: "failed"` followed by an MCP `ready` shortly after? (These are the cases where the card lied.)

---

## Out of Scope

- Persisting reasons / task across app restarts.
- A dedicated "what is each agent doing right now" panel beyond the sidebar.
- LLM-based output classification.
- Agent attention for non-Claude / non-codex agents beyond the lifecycle-only fallback.
- Per-provider color/icon styling beyond the small badge.
- Detection of other agent providers (deferred until there's a real need).
- Phase 2: classifier pattern narrowing, ANSI stripping, negation handling. Separately specced after Phase 1 telemetry is in hand.
