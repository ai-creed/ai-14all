# Session Attention V2 Design

**Date:** 2026-04-30
**Status:** Approved for planning

## Purpose

Improve cross-workspace supervision by making the sidebar answer:

> Which Codex or Claude session needs me now, and why?

The app already supports multiple repo workspaces, worktree sessions, terminal-backed agent processes, review comments, and local MCP tools. The current attention model (`ProcessAttentionState = idle | activity | actionRequired`, derived in `src/features/terminals/logic/process-attention.ts`) is terminal-output based and does not reliably distinguish:

- an agent waiting for approval or a response,
- an agent that completed work and is ready for review,
- an agent that is quiet but healthy,
- an agent that is quiet because it is interrupted or stuck.

This design adds an agent-scoped attention layer on top of the existing `ProcessAttentionState`, while preserving the product shape: one focused worktree session in the main surface, with cross-workspace awareness in the sidebar.

## Goals

- Surface Codex/Claude sessions that need user attention across workspaces.
- Distinguish explicit `waiting`, `failed`, `ready`, `stale`, `active`, `idle` states for agent processes.
- Prefer explicit agent self-reporting through MCP when available.
- Keep terminal-output inference as a fallback.
- Treat `STALE_THRESHOLD_MS` (default 120000) of silence from a running Codex/Claude process as a soft `stale` signal, derived at read time rather than written through the reducer.
- Keep the UI in the existing session sidebar, not a new dashboard.
- Clear attention only when the user actually opens the relevant worktree session and views the relevant process.
- Preserve the existing `ProcessAttentionState` field for non-agent processes; do not regress today's `actionRequired` behavior.

## Non-Goals

- No vendor API integration.
- No push-direction agent control.
- No global multi-workspace dashboard or task feed. This follows the session-first boundary in `docs/shared/architecture_decisions.md` AD-007.
- No support for every CLI agent in the first version (Codex and Claude only).
- No attempt to prove task completion from Git state alone.
- No replacement for terminal interaction as the primary agent surface.
- No NL parsing of agent-supplied prose to infer state — agents must declare state via the enum.
- No persistence of agent attention reasons across app restarts in v1.

## Product Model

Only likely agent processes participate in the v1 agent attention model.

### Agent Process Detection

A process is agent-scoped when either:

- the parsed argv head of its `command` (after shell quoting) matches a known agent command, or
- `command === null` and the normalized process label exactly identifies a known agent command.

Known agent commands:

- `codex`
- `claude`
- `claude-code`

Optional path prefix and version suffix are allowed (`/usr/local/bin/claude`, `claude-1.2.3`). The matcher must:

- ignore arguments after the head (so `claude --print` matches but `echo claude` does not),
- reject substring matches inside other tokens (`codex-stub`, `claude-fake` do not match unless explicitly listed),
- accept `npx codex` and `npx claude` by recognizing `npx` and inspecting the next token.
- for `command === null`, accept only exact normalized labels such as `codex`, `claude`, or `claude-code`; do not infer from labels like `shell 1`, `working on codex`, or `start claude`.

Detection is implemented in `src/features/terminals/logic/agent-attention.ts` and unit tested with positive and negative cases (see Testing).

Other terminal processes still use the existing `ProcessAttentionState` lifecycle and activity signals via `deriveAttentionState`, but they do not receive `waiting`, `ready`, or `stale` agent heuristics. This prevents dev servers, test watchers, and ordinary shells from becoming noisy after two quiet minutes.

## Attention States

Each worktree session can expose one derived agent attention state. Process-level terminal and lifecycle signals feed that state; MCP self-reports attach directly to the worktree session because the tool can reliably resolve `worktreePath` to `worktreeId` but cannot always identify the exact terminal process.

States, ranked from strongest to weakest:

1. `waiting` — needs user approval, permission, or an answer.
2. `failed` — process errored, exited nonzero, or output indicates failure.
3. `ready` — agent reports or implies work is done and ready for review.
4. `stale` — running agent process has been quiet for at least `STALE_THRESHOLD_MS`.
5. `active` — recent output without a stronger signal.
6. `idle` — no current attention reason.

The sidebar shows the strongest reason for each worktree session. Per-process rows may still show compact process-level reason text when the signal came from terminal output or process lifecycle.

### Relationship To Existing `ProcessAttentionState`

The legacy field stays on `ProcessSession` for non-agent processes. For agent processes, the renderer maps the new `AgentAttentionState` back into the legacy field so the existing sidebar selector keeps working without a migration:

| `AgentAttentionState`     | legacy `ProcessAttentionState` |
| ------------------------- | ------------------------------ |
| `waiting`, `failed`       | `actionRequired`               |
| `ready`, `active`         | `activity`                     |
| `idle`                    | `idle`                         |

`stale` is derived at read time and is not written into the legacy field. `recalculateWorktreeAttention` continues to operate on stored legacy fields for existing behavior, while the sidebar display selector overlays derived `stale` when it builds the final displayed state. New reason text comes from `agentAttentionReasons` (see Data Model).

## Signal Sources

### 1. MCP Self-Report

Add a local MCP tool that lets agents explicitly report session status:

`report_session_status`

Input (Zod):

- `worktreePath: string` (min 1)
- `state: "active" | "waiting" | "ready" | "failed"` — public vocabulary is a subset of `AgentAttentionState`. `blocked` and `working` are intentionally not accepted; agents pick `waiting` or `failed` directly.
- `summary: string` (min 1, max 200)
- `nextAction: string | null` (max 200)

Behavior:

- Resolve `worktreePath` to `worktreeId` using `resolveWithRefresh(this.resolver, worktreePath)` (same helper used by `read_session_note` / `append_session_note`) so freshly created worktrees resolve on first report.
- Stamp `reportedAt = Date.now()` on the server side; do not trust client timestamps.
- Forward the report to the renderer through a typed MCP-to-renderer bridge that mirrors `services/mcp/session-note-bridge.ts` (see Architecture).
- On success return `jsonOk({ worktreeId, state, reportedAt })`.
- On failure return `jsonError(code, message)` with `code` from the existing `mapBridgeErrorCode` plus `no_worktree` and `invalid_input`.

MCP self-report is the highest-quality signal, but it is not the only signal. Agents can forget to call the tool, fail before reporting, or be interrupted. Agents are expected to re-report on every significant state change, not once per session.

### 2. Terminal Output Inference

For Codex/Claude processes, classify terminal output as a fallback inside `agent-attention.ts`. The classifier returns `AgentAttentionState | null` (null = no signal in this chunk).

Waiting examples:

- `y/n`
- `yes/no`
- `Continue?`
- permission or approval prompts
- direct questions from the agent

Ready examples:

- `done`
- `completed`
- `implementation complete`
- `ready for review`
- `tests pass`
- `all checks passed`

Failed examples:

- `failed`
- `error`
- `exception`

The classifier is conservative. Explicit waiting and failure are stronger signals than aggressive ready detection. Output that matches no rule yields `active` if the chunk is non-empty, otherwise no change.

Terminal output must not downgrade a stronger uncleared terminal reason. If the terminal source currently holds `waiting`, `failed`, or `ready`, later neutral output classified as `active` updates activity metadata but does not overwrite that stronger terminal reason. The stronger terminal reason clears only through the clearing rules below, or by a stronger/equal terminal signal replacing it.

### 3. Quiet Fallback (derived, not stored)

For a running Codex/Claude process, `stale` is computed at read time, not written through the reducer:

```ts
function deriveStale(
  now: number,
  lastActivityAt: number | null,
  agentAttentionClearedAt: number | null,
): boolean {
  return (
    lastActivityAt !== null &&
    now - lastActivityAt >= STALE_THRESHOLD_MS &&
    (agentAttentionClearedAt === null || lastActivityAt > agentAttentionClearedAt)
  );
}
```

A renderer-level selector folds `deriveStale` together with `agentAttentionReasons`, `lastActivityAt`, and `agentAttentionClearedAt` to produce the displayed state. The selector is invoked by a 30s `setInterval` tick that triggers a re-render but does not mutate state. Tests inject `now` and assert the selector output. This avoids reducer bookkeeping and timer drift.

`stale` must be dismissible. Add `agentAttentionClearedAt: number | null` to `ProcessSession`. `deriveStale` returns true only when:

- the process is running,
- `lastActivityAt !== null`,
- `now - lastActivityAt >= STALE_THRESHOLD_MS`,
- and `agentAttentionClearedAt === null || lastActivityAt > agentAttentionClearedAt`.

Viewing a stale process sets `agentAttentionClearedAt = Date.now()`. Later terminal output updates `lastActivityAt`, making the process eligible to become stale again after another quiet period.

`stale` ranks below `waiting`, `failed`, and `ready`. It means "possibly waiting or interrupted," not "definitely broken."

### 4. Process Lifecycle

Lifecycle still matters and writes a `lifecycle`-sourced `AgentAttentionReason` on the process:

| condition                              | `AgentAttentionReason.state` |
| -------------------------------------- | ---------------------------- |
| process error / nonzero exit           | `failed`                     |
| clean exit, last classifier was `ready`| `ready`                      |
| clean exit, no `ready` evidence        | reason cleared (process row falls back to non-attention "exited" UI) |

After exit, the process row is no longer eligible for `stale` (the selector skips non-running processes). Existing `ProcessStatus` (`running | exited | error | restarting`) drives that gate.

### Recovery / State Transitions

Reasons are stored as a small map keyed by source, not a single slot:

```ts
type AgentAttentionReasonsBySource = Partial<Record<AgentAttentionSource, AgentAttentionReason>>;
```

The displayed state is the strongest across `mcp`, `terminal`, and `lifecycle`, plus the derived `stale` if applicable. Each source writes only its own slot, and writes use rank-aware replacement so weaker signals do not downgrade stronger uncleared signals from the same source. Concretely:

- terminal output classified `ready` after lifecycle wrote `failed` ⇒ both reasons coexist; ranker still picks `failed` (correct: a failed run is more important than later "ready" text).
- terminal output classified `active` after terminal wrote `waiting` ⇒ terminal `waiting` remains latched until view/clear.
- MCP `active` arriving after lifecycle `failed` ⇒ ranker still picks `failed` until the user clears it.
- MCP `ready` after terminal `failed` ⇒ ranker picks `failed` (explicit failure dominates explicit ready). Agents that recover from a failure should report `waiting`/`active` and let the user clear before reporting `ready`.

This rule is enforced by the ranker, not by overwrite logic.

## Sidebar Behavior

The existing session sidebar remains the surface for cross-workspace awareness.

For each worktree row, show:

- selected state,
- branch / session title,
- stored `WorktreeSession.attentionState` plus selector-derived `stale` overlay,
- compact reason text from the strongest `agentAttentionReason` across the session and its processes (selector-derived).

Example reason labels:

- `waiting: approve command`
- `waiting: answer y/n prompt`
- `ready: implementation complete`
- `stale: quiet for 2m`
- `failed: tests failed`

The UI stays compact. Goal: make the next session that needs attention obvious, not show a task feed.

## Clearing Rules

Both session-level and process-level reasons clear on the same trigger: **the user views the relevant process**. This removes the asymmetry in v1.

- Selecting/viewing the active process for a worktree clears `waiting`, `ready`, and `stale` reasons across all sources for that process and the session-level MCP reason.
- `failed` reasons are sticky and do not auto-clear on view; the user must explicitly dismiss via a sidebar action (`Clear failed` on the row). Rationale: failed runs are the easiest to re-bury under new output and the easiest to forget.
- New MCP reports or terminal output can raise attention again afterward.
- Selecting a worktree without opening any process does not clear attention. The sidebar should not clear attention just because a workspace group is visible.
- Viewing a process updates `agentAttentionClearedAt` so selector-derived `stale` does not immediately reappear without new output.

## Data Model

Add shared types in `shared/models/agent-attention.ts`:

```ts
export type AgentAttentionState =
  | "waiting"
  | "failed"
  | "ready"
  | "stale"
  | "active"
  | "idle";

export type AgentAttentionSource = "mcp" | "terminal" | "lifecycle";

export type AgentAttentionReason = {
  state: AgentAttentionState;
  source: AgentAttentionSource;
  summary: string;
  nextAction: string | null;
  reportedAt: number;
};

export type AgentAttentionReasonsBySource = Partial<
  Record<AgentAttentionSource, AgentAttentionReason>
>;

export const STALE_THRESHOLD_MS = 120_000;
```

Add `agentAttentionReasons: AgentAttentionReasonsBySource` to `WorktreeSession` (only `mcp` ever populated at the session level).

Add `agentAttentionReasons: AgentAttentionReasonsBySource` to `ProcessSession` (`terminal` and `lifecycle` populated; `mcp` not used at the process level).

Add `agentAttentionClearedAt: number | null` to `ProcessSession` for dismissing selector-derived stale without mutating `lastActivityAt`.

The renderer derives:

- per-process display state = `rank(...reasons) || deriveStale(now, lastActivityAt, agentAttentionClearedAt) || "idle"`,
- per-worktree display state = max-rank across the session-level `mcp` reason and all owned process display states,
- legacy `ProcessSession.attentionState` and `WorktreeSession.attentionState` are written through the reducer for stored non-stale reasons using the mapping table in §"Relationship To Existing `ProcessAttentionState`." Selector-derived `stale` is overlaid for display only.

Reasons are not persisted in v1. Both `workspace/restoreSnapshot` and `session/restoreSnapshot` reset `agentAttentionReasons = {}` and `agentAttentionClearedAt = null` on every restored process and worktree session. Add a reducer test for this.

## Architecture

### Pure classifier module

`src/features/terminals/logic/agent-attention.ts`:

- `isAgentProcess(label, command): boolean` — argv-head matcher described above.
- `classifyOutput(chunk: string): AgentAttentionState | null` — terminal output classifier.
- `deriveStale(now, lastActivityAt, agentAttentionClearedAt): boolean`.
- `rankAgentAttention(reasons: AgentAttentionReasonsBySource, derivedStale: boolean): AgentAttentionState`.
- `shouldReplaceAgentAttentionReason(current, next): boolean` — rank-aware same-source replacement; weaker signals do not downgrade stronger uncleared reasons.
- `mapToProcessAttentionState(state: AgentAttentionState): ProcessAttentionState` — for the legacy field.
- Exports `STALE_THRESHOLD_MS`.

### Reducer actions

Add to `WorkspaceAction` in `src/features/workspace/logic/workspace-state.ts`:

- `session/reportAgentAttention` — `{ worktreeId; reason: AgentAttentionReason }` — writes to `WorktreeSession.agentAttentionReasons[reason.source]`.
- `session/reportProcessAgentAttention` — `{ worktreeId; processId; reason }` — writes to `ProcessSession.agentAttentionReasons[reason.source]` and recomputes the legacy `attentionState` via the mapping.
- `session/clearProcessAgentAttention` — `{ worktreeId; processId; sticky?: boolean; clearedAt: number }` — clears non-`failed` reasons by default and sets `agentAttentionClearedAt = clearedAt`; `sticky: true` also clears `failed`.
- `session/clearSessionAgentAttention` — `{ worktreeId }` — clears the session-level MCP reason.

`session/recordProcessOutput` is extended to accept an optional `agentReason: AgentAttentionReason | null` from the runtime hook so terminal classification flows through one action instead of two.

`workspace/restoreSnapshot` and `session/restoreSnapshot` reset `agentAttentionReasons` to `{}` on every touched process and session, and reset process `agentAttentionClearedAt` to `null`.

### MCP-to-renderer bridge

Add `services/mcp/agent-attention-bridge.ts` mirroring `session-note-bridge.ts`:

- IPC channels (defined in `shared/contracts/agent-attention-bridge.ts`):
  `AGENT_ATTENTION_BRIDGE_READY`, `AGENT_ATTENTION_BRIDGE_GOODBYE`, `AGENT_ATTENTION_BRIDGE_REQUEST`, `AGENT_ATTENTION_BRIDGE_REPLY`.
- Same 5s default `timeoutMs`.
- Same error class set re-exported: `RendererNotReadyError`, `RendererGoneError`, `BridgeTimeoutError`, `BridgeDisposedError`.
- The MCP tool reuses `mapBridgeErrorCode` to keep error codes consistent with note tools.

### MCP tool

Add `report_session_status` in `services/mcp/ai14all-mcp-server.ts`:

- Validates input with Zod (state enum is `active | waiting | ready | failed`; `summary` required; `nextAction` nullable).
- Resolves worktree via `resolveWithRefresh`.
- Stamps `reportedAt = Date.now()` server-side.
- Forwards to the renderer through the new bridge.
- Returns `jsonOk({ worktreeId, state, reportedAt })` on success.
- Returns `jsonError(code, message)` on failure where `code ∈ { no_worktree, invalid_input, renderer_not_ready, renderer_gone, bridge_timeout, bridge_disposed, internal_error }`.

If the renderer is unavailable, the tool returns a clear bridge error rather than silently dropping the report.

## Testing

### Unit

- `isAgentProcess`:
  - positive command cases: `codex`, `claude`, `claude-code`, `/usr/local/bin/claude`, `claude-1.2.3`, `claude --print`, `npx codex`, `npx claude`.
  - positive ad-hoc label cases with `command === null`: `codex`, `claude`, `claude-code`.
  - negative: `echo claude`, `npm run codex-test`, `claude-stub`, `claude-fake`, empty string, `shell 1`, `working on codex`, `start claude` when `command === null`.
- `classifyOutput`: y/n prompts, permission prompts, direct questions, completion phrases, failures, neutral output, empty chunks. Includes mixed-signal chunks (asserts conservative pick).
- `deriveStale`: just-under, exactly-at, just-over `STALE_THRESHOLD_MS`; null `lastActivityAt`.
- `rankAgentAttention`: every pair across `{mcp, terminal, lifecycle}`, plus interaction with `derivedStale=true`.
- `shouldReplaceAgentAttentionReason`: terminal `active` does not replace terminal `waiting`/`ready`/`failed`; equal or stronger terminal signals replace.
- `mapToProcessAttentionState`: full-table coverage.
- Reducer:
  - session-level MCP report applied and read back.
  - process-level terminal report applied and read back; legacy `attentionState` recomputed.
  - `clearProcessAgentAttention` default keeps `failed`, clears non-failed reasons, and sets `agentAttentionClearedAt`; with `sticky: true` clears `failed`.
  - `clearSessionAgentAttention` clears MCP only.
  - `workspace/restoreSnapshot` and `session/restoreSnapshot` reset `agentAttentionReasons` to `{}` and `agentAttentionClearedAt` to `null`.
  - recovery: lifecycle `failed` then terminal `ready` ⇒ ranker still returns `failed`.
  - recovery: MCP `active` after lifecycle `failed` ⇒ ranker still returns `failed`.
  - staleness recovery: viewing stale sets `agentAttentionClearedAt` and selector drops `stale`; output after that makes the process eligible to become stale again.
- MCP tool:
  - input validation (missing fields, oversize summary, invalid state value, `blocked`/`working` rejected).
  - `worktreePath` not registered ⇒ `no_worktree`.
  - `resolveWithRefresh` recovers a freshly added worktree on first report.
  - bridge timeout ⇒ `bridge_timeout`.
  - renderer not ready ⇒ `renderer_not_ready`.
  - renderer gone mid-call ⇒ `renderer_gone`.
  - bridge disposed ⇒ `bridge_disposed`.
  - success returns `{ ok: true, worktreeId, state, reportedAt }`.

### Component

- Sidebar shows `waiting`, `ready`, `stale`, and `failed` reason text using fixtures with mixed reasons across sources.
- Lower-priority reasons do not hide higher-priority reasons.
- View-process clears `waiting`, `ready`, `stale` but not `failed`; explicit `Clear failed` action clears `failed`.
- Selecting a worktree without opening a process does not clear attention.

### E2E

- Start a Codex/Claude-like terminal process and emit a y/n prompt; sidebar shows `waiting`.
- Emit completion output; sidebar shows `ready`.
- Keep a running Codex/Claude-like process quiet past `STALE_THRESHOLD_MS` using test-controlled time injection in the renderer selector; sidebar shows `stale`.
- Call `report_session_status` for a worktree (every state value); sidebar reflects the reported status and summary.
- Restart the app mid-session; restored worktree session shows no agent reasons (`agentAttentionReasons === {}`) and restored processes have `agentAttentionClearedAt === null`.
- Failed run, then user clicks `Clear failed`; sidebar drops the failed reason and any subsequent `ready` from new output is shown.

## Open Follow-Up

After v1, consider whether Git dirty state and open review comments should contribute to session attention. They are useful, but they should be added only after the agent waiting/ready/stale model is trustworthy. Persisting `agentAttentionReasons` across restarts is also deferred until usage shows it is worth the migration cost.
