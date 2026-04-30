# Session Attention V2 Design

**Date:** 2026-04-30
**Status:** Approved for planning

## Purpose

Improve cross-workspace supervision by making the sidebar answer:

> Which Codex or Claude session needs me now, and why?

The app already supports multiple repo workspaces, worktree sessions, terminal-backed agent processes, review comments, and local MCP tools. The current attention model is mostly terminal-output based and does not reliably distinguish:

- an agent waiting for approval or a response,
- an agent that completed work and is ready for review,
- an agent that is quiet but healthy,
- an agent that is quiet because it is interrupted or stuck.

This design adds an agent-scoped attention layer while preserving the product shape: one focused worktree session in the main surface, with cross-workspace awareness in the sidebar.

## Goals

- Surface Codex/Claude sessions that need user attention across workspaces.
- Distinguish explicit waiting, failed, ready, stale, active, and idle states.
- Prefer explicit agent self-reporting through MCP when available.
- Keep terminal-output inference as a fallback.
- Treat two minutes of silence from a running Codex/Claude process as a soft stale signal.
- Keep the UI in the existing session sidebar, not a new dashboard.
- Clear attention only when the user actually opens the relevant worktree session and views the relevant process.

## Non-Goals

- No vendor API integration.
- No push-direction agent control.
- No global multi-workspace dashboard.
- No support for every CLI agent in the first version.
- No attempt to prove task completion from Git state alone.
- No replacement for terminal interaction as the primary agent surface.

## Product Model

Only likely agent processes participate in the v1 agent attention model.

For v1, a process is agent-scoped when its label or command indicates:

- `codex`
- `claude`

Other terminal processes still use existing lifecycle and activity signals, but they do not receive `waiting`, `ready`, or `stale` agent heuristics. This prevents dev servers, test watchers, and ordinary shells from becoming noisy after two quiet minutes.

## Attention States

Each worktree session can expose one derived agent attention state. Process-level terminal and lifecycle signals feed that state, and MCP self-reports attach directly to the worktree session because the tool can reliably resolve `worktreePath` to `worktreeId` but cannot always identify the exact terminal process.

- `waiting`: needs user approval, permission, or an answer.
- `failed`: process errored, exited nonzero, or output indicates failure.
- `ready`: agent reports or implies work is done and ready for review.
- `stale`: running agent process has been quiet for at least two minutes.
- `active`: recent output without a stronger signal.
- `idle`: no current attention reason.

Ranking from strongest to weakest:

1. `waiting`
2. `failed`
3. `ready`
4. `stale`
5. `active`
6. `idle`

The sidebar should show the strongest reason for each worktree session. Per-process rows may still show compact process-level reason text when the signal came from terminal output or process lifecycle.

## Signal Sources

### 1. MCP Self-Report

Add a local MCP tool that lets agents explicitly report session status:

`report_session_status`

Input:

- `worktreePath: string`
- `status: "working" | "waiting" | "ready" | "blocked" | "failed"`
- `summary: string`
- `nextAction?: string`

Behavior:

- Resolve `worktreePath` to `worktreeId` using the existing worktree path resolver.
- Convert the status into the worktree-session attention model.
- Store a compact human-readable reason on the worktree session.
- Emit an update to the renderer through a dedicated typed MCP-to-renderer bridge.

Status mapping:

- `waiting` -> `waiting`
- `blocked` -> `waiting` when `nextAction` asks the user to do something, otherwise `failed`
- `failed` -> `failed`
- `ready` -> `ready`
- `working` -> `active`

MCP self-report is the highest-quality signal, but it is not the only signal. Agents can forget to call the tool, fail before reporting, or be interrupted.

### 2. Terminal Output Inference

For Codex/Claude processes, classify terminal output as a fallback.

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
- nonzero process exit

The classifier should be conservative. Explicit waiting and failure are more important than aggressive ready detection.

### 3. Quiet Fallback

For a running Codex/Claude process:

- if there has been no output for two minutes,
- and no stronger state is active,
- derive `stale`.

`stale` is a soft state, below `waiting`, `failed`, and `ready`. It means "possibly waiting or interrupted," not "definitely broken."

### 4. Process Lifecycle

Lifecycle still matters:

- process error or nonzero exit -> `failed`
- clean exit after ready/completion output -> `ready`
- clean exit without ready evidence -> lower-priority exited context, not an urgent agent signal

## Sidebar Behavior

The existing session sidebar remains the surface for cross-workspace awareness.

For each worktree row, show:

- selected state,
- branch/session title,
- strongest attention state,
- compact reason text from the strongest session or process signal.

Example reason labels:

- `waiting: approve command`
- `waiting: answer y/n prompt`
- `ready: implementation complete`
- `stale: quiet for 2m`
- `failed: tests failed`

The UI should stay compact. The goal is not to show a task feed, but to make the next session that needs attention obvious.

## Clearing Rules

Attention clears when the user intentionally views the relevant session or process:

- a session-level MCP report clears when the user selects the owning worktree session,
- a process-level terminal/lifecycle reason clears when the user selects/views the relevant process,
- selecting/viewing the relevant process clears `waiting`, `ready`, and `stale`,
- new MCP reports or terminal output can raise attention again afterward.

The sidebar should not clear attention just because a workspace group is visible.

## Data Model

Add shared types for the agent attention layer.

Types:

```ts
export type AgentAttentionState =
  | "waiting"
  | "failed"
  | "ready"
  | "stale"
  | "active"
  | "idle";

export type AgentAttentionSource = "mcp" | "terminal" | "lifecycle" | "timer";

export type AgentAttentionReason = {
  state: AgentAttentionState;
  source: AgentAttentionSource;
  summary: string;
  nextAction: string | null;
  reportedAt: number;
};
```

Add `agentAttentionReason: AgentAttentionReason | null` to `WorktreeSession` for MCP self-reports and derived session-level state.

Add `agentAttentionReason: AgentAttentionReason | null` to `ProcessSession` for terminal-output, stale, and lifecycle reasons. This lets the sidebar show both:

- the strongest worktree-session reason,
- process-specific reasons in the existing compact process rows.

The derived worktree state is the highest-ranked reason across the session-level reason and all process-level reasons owned by that worktree.

Persisting the attention reason is not required in v1. On cold start, restored processes can begin with no agent attention reason and derive new state from future output or MCP reports.

## Architecture

Add a pure classifier module under `src/features/terminals/logic/agent-attention.ts`:

- agent process detection: Codex/Claude by label or command
- terminal output classification
- stale threshold calculation
- state ranking

Add a typed action to `workspaceReducer`:

- `session/reportAgentAttention` for session-level MCP reports,
- `session/reportProcessAgentAttention` for process-level terminal/lifecycle reasons,
- `session/clearSessionAgentAttention`,
- `session/clearProcessAgentAttention`.

Add an MCP tool in `services/mcp/ai14all-mcp-server.ts`:

- validates report input,
- resolves `worktreePath`,
- forwards the report to the renderer through a typed MCP-to-renderer bridge,
- returns structured success/error JSON.

If the renderer is unavailable, the tool should return a clear bridge error rather than silently dropping the report.

## Testing

Unit tests:

- Codex/Claude process detection by label and command.
- Terminal output classification for y/n prompts, permissions, direct questions, completion phrases, failures, and neutral output.
- State ranking.
- Two-minute stale threshold.
- Reducer actions for session-level report, process-level report, clear, and recomputing worktree attention.
- MCP report input validation and worktree resolution failure.

Component tests:

- sidebar shows `waiting`, `ready`, `stale`, and `failed` reason text.
- lower-priority reasons do not hide higher-priority reasons.
- clear-on-view removes the relevant reason without clearing unrelated process reasons.

E2E tests:

- start a Codex/Claude-like terminal process and emit a y/n prompt; sidebar shows `waiting`.
- emit completion output; sidebar shows `ready`.
- keep a running Codex/Claude-like process quiet past two minutes using test-controlled time; sidebar shows `stale`.
- call the MCP `report_session_status` tool for a worktree; sidebar shows the reported status and summary.

## Open Follow-Up

After v1, consider whether Git dirty state and open review comments should contribute to session attention. They are useful, but they should be added only after the agent waiting/ready/stale model is trustworthy.
