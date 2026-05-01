# MCP-driven enforcement for `report_session_status`

**Status:** design · **Date:** 2026-05-01

## Goal

Give agent sessions running inside ai-14all worktrees a server-level orientation
to the `ai-14all` MCP server's full tool surface, so the agent reliably uses the
right tool at the right time. The proximate motivation is that
`report_session_status` is currently never called; the broader fix is that the
server has no "how to use me" voice at all today, only per-tool descriptions of
varying quality. Constraint: no tampering with the user's repository, no writes
to `~/.claude` / `~/.codex` outside the existing installer, no forking behavior
between Claude Code and Codex.

## Non-goals

- Deterministic, harness-level enforcement (would require either repo tampering
  or owning the agent spawn, both rejected).
- Recording / persisting reports beyond the existing in-memory renderer state.
- Adding a new MCP tool or changing the existing tool's argument schema.

## Constraints

- No writes to the user's worktree (no `AGENTS.md`, no `CLAUDE.md`, no
  `.claude/`).
- No new top-level installer, hook, or skill. App-owned surfaces only:
  the MCP server in `services/mcp/`.
- Must work for Claude Code **and** Codex through the same code path.

## Approach

The `@modelcontextprotocol/sdk` `McpServer` constructor takes
`(serverInfo, options)` (see
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:24` and
`server/index.d.ts:13-15`). The `instructions` field lives in `ServerOptions`,
the **second** argument, and is returned to the client in `InitializeResult`.
We use this as the protocol-sanctioned channel for telling the agent how and
when to call our tools.

Client-side surfacing: the `InitializeResult.instructions` field is part of
the MCP spec and is exposed by the SDK client via `client.getInstructions()`.
Claude Code documents server instructions as a tool-search guidance surface
(model-visible). Codex is also an MCP-spec client and receives the string,
but this spec does not prove how prominently Codex shows it to the model — the
manual smoke test (below) is what verifies model visibility on each client.

Two changes, both in `services/mcp/ai14all-mcp-server.ts`:

1. **Server `instructions` option** — change the per-session construction at
   lines 233-236 from
   `new McpServer({ name: "ai-14all", version: "0.1.0" })` to
   `new McpServer({ name: "ai-14all", version: "0.1.0" }, { instructions: "<block>" })`.
   The block is the verbatim text below, which is ~1.9 KB and fits Claude
   Code's documented 2 KB server-instruction budget. Define the string as a
   module-level constant (e.g. `AI14ALL_MCP_INSTRUCTIONS`) so it is reused
   across sessions and easy to test against.
2. **Tighter tool description** — replace the existing one-line description at
   line 197 with a description that restates the lifecycle protocol so the
   rule is also visible at tool-discovery time, as a backstop for any client
   that under-surfaces the server-level `instructions`.

## Content

### Server `instructions` (proposed verbatim)

```
This MCP server is provided by the ai-14all desktop app. It is connected to a
specific git worktree on the user's machine and exposes tools the agent can
call while working in that worktree. Every worktree-scoped tool takes a
`worktreePath` argument — pass the absolute path of the current worktree
(the working directory of this session).

The server exposes three tool families:

Reviews — act on review comments authored in the ai-14all UI:
- `list_pending_reviews({ worktreePath })` returns open review comments
  for the worktree.
- `mark_review_addressed({ commentId })` marks one as addressed; call
  after the fix has been applied.

Session note — a single user-facing markdown note pinned to the worktree:
- `read_session_note({ worktreePath })` reads the current note. Useful
  before appending to avoid duplicates.
- `append_session_note({ worktreePath, title, body })` adds a new
  section. Call ONLY when the user explicitly asks to save / note /
  remember something. Never call autonomously.

Session status — a lifecycle signal that drives the app's sidebar
attention indicator:
- `report_session_status({ worktreePath, state, summary, nextAction })`
  reports the agent session's current state. Call on every transition
  into one of:
  - "active" — starting work or resuming after a pause.
  - "waiting" — blocked on a question or input from the user.
  - "ready" — task is complete and awaiting user review.
  - "failed" — task hit an unrecoverable error.
  Keep `summary` ≤ 200 chars and specific (e.g. "running tsc",
  "awaiting answer on caching strategy", "3 tests failing in
  workspace-state.test.ts"). Set `nextAction` to a short imperative when
  the user has a clear next step (e.g. "review diff", "answer question
  above"), else null. Call once per transition — not on every tool use
  or every assistant turn.
```

### Revised tool description (line 197)

```
Report the lifecycle state of the current ai-14all agent session for the
worktree at `worktreePath`. Call on every transition into "active",
"waiting", "ready", or "failed". `summary` is a one-line description of the
current state (≤200 chars); `nextAction` is an optional short imperative for
the user, or null.
```

## Files touched

- `services/mcp/ai14all-mcp-server.ts` — define a module-level
  `AI14ALL_MCP_INSTRUCTIONS` constant; pass it as
  `new McpServer({ name, version }, { instructions: AI14ALL_MCP_INSTRUCTIONS })`
  in the per-session construction at lines 233-236; update the
  `report_session_status` tool description at line 197.
- `tests/unit/mcp/report-session-status.test.ts` — add a test asserting the
  string returned by `client.getInstructions()` is non-empty and contains
  the five tool names and four lifecycle state names (see Testing).

No new files. No installer or contract changes.

## Error handling

Unchanged. Tool behavior, validation, bridge timeouts, and error codes
(`no_worktree`, `renderer_not_ready`, `bridge_timeout`, `bridge_disposed`)
all stay as-is. This change is text-only.

## Testing

- **Unit:** in the existing rig in `tests/unit/mcp/report-session-status.test.ts`
  (already opens an MCP client), call `client.getInstructions()` after connect
  and assert the returned string is non-empty and contains all five tool names
  (`list_pending_reviews`, `mark_review_addressed`, `read_session_note`,
  `append_session_note`, `report_session_status`) and the four lifecycle state
  names (`active`, `waiting`, `ready`, `failed`). The `getInstructions()`
  method is part of the MCP SDK `Client` interface
  (`node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts:167`).
  Locating the assertion in this file is fine for now; if a more general
  "server orientation" test home is wanted later, it can move.
- **Manual smoke test:** in a real ai-14all session, run a Claude Code agent
  inside a worktree and a Codex agent inside another worktree. For each:
  1. Verify the agent acknowledges the lifecycle protocol if asked
     ("what does the ai-14all server tell you about itself?").
  2. Run a multi-step task that crosses at least one obvious transition
     (active → ready). Confirm the sidebar attention badge updates,
     i.e. the renderer received the report.
- **No e2e change.** The existing
  `tests/e2e/session-attention.spec.ts:283-359` already covers the
  end-to-end MCP → bridge → renderer path; this design does not alter it.

## Risks and fallbacks

- **Client variance.** Both Claude Code and Codex are MCP-spec clients, but
  how prominently each surfaces `instructions` to the model is not guaranteed
  by spec. Mitigation: the lifecycle rule is also written into the tool
  description (line 197), which is shown reliably to the model at every
  tool-discovery pass on both clients. If `instructions` is observed to be
  ignored on either client during the manual smoke test, the tool description
  is the durable backstop.
- **Soft enforcement.** The model can still skip the call. This is an
  accepted limit given the constraint of not tampering with user files and
  not owning the spawn. If stricter enforcement is later needed, the
  follow-up move is a Claude-Code-only `~/.claude/settings.json` hook
  (Codex has no equivalent) layered on top — but that is explicitly
  out of scope for this change.

## Out of scope / follow-ups

- Reporting cadence inside long-running tasks (heartbeat-style "active"
  pings). The tool is one-shot per transition by design.
- Persisting status across renderer reloads.
- Hook-based deterministic enforcement on Claude Code.
- Tightening the per-tool descriptions of `list_pending_reviews` and
  `mark_review_addressed` (currently registered without a description
  string). Server-level `instructions` covers them adequately for now;
  per-tool wording can be revisited separately.
