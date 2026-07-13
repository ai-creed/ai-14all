---
name: ai-14all-session-status
description: Use this whenever working inside an ai-14all-managed worktree — at mission start, when blocked waiting on the user, on task completion or failure, on a mid-stream pivot, and once at session start to register for conversation resume — pushing lifecycle state to the ai-14all desktop app's sidebar via the report_session_status and register_agent_session MCP tools.
version: 0.1.0
---

# ai-14all-session-status

## Intent

The ai-14all desktop app shows each running agent in its left sidebar with an
attention indicator. This skill keeps that indicator accurate: push your
current task and lifecycle state via the `report_session_status` MCP tool at
five lifecycle moments (task start, waiting on user input, task complete,
task failed, task pivot), and once at session start, register for
conversation resume via `register_agent_session` so the app can reopen this
exact conversation after an ai-14all restart or a shell relaunch.

## Inputs

For every `report_session_status` push:

- `worktreePath` — absolute path of your cwd (the worktree this session runs
  in).
- `state` — one of `"active"`, `"waiting"`, `"ready"`, `"failed"`.
- `task` — ≤200 chars summarizing the high-level mission. Reuse the same
  string across pushes for one mission; change it only on pivot; `null` when
  idle.
- `summary` — ≤200 chars describing what's happening (what you're starting,
  what's blocking, what you produced, or what failed).
- `nextAction` — a short imperative telling the user what to do next (e.g.
  `"answer the question above"`), or `null` when there is none.

For the one-time resume registration (step 6 of the procedure):

- `$AI14ALL_TERMINAL_SESSION_ID` — environment variable whose presence signals
  you are running inside an ai-14all-managed terminal.
- Your CLI's own verified resume mechanism (see the per-provider list in
  Procedure) — the source for `provider` and `resumeCommand`.

## Preconditions

- The `report_session_status` MCP tool must be available in the current
  session. Validate it before using; if it's absent (e.g. the app isn't
  running), skip pushes silently — your work continues normally. This is
  best-effort telemetry, not a required step.
- For registration: `$AI14ALL_TERMINAL_SESSION_ID` must be set. If it is
  unset, you are not running inside an ai-14all-managed terminal — skip the
  registration step silently, with no error and no message to the user.
- For registration: your CLI must appear on the verified per-provider list
  (Claude Code, Codex, Ezio). If it doesn't, do not register — an unverified
  resume mechanism risks a `resumeCommand` that silently does the wrong thing
  (or nothing) when replayed.
- The `register_agent_session` MCP tool must be available; if it's absent,
  times out, or errors, skip silently.

## Procedure

### When to push

1. **Task start.** Whenever the user gives you a new high-level mission (not
   a sub-step of an existing mission), push immediately:
   ```
   report_session_status({
     worktreePath: "<absolute path of your cwd>",
     state: "active",
     task: "<≤200 chars summarizing the mission>",
     summary: "Starting <task>",
     nextAction: null
   })
   ```
2. **Waiting on user input.** Whenever you have to stop and ask the user
   something:
   ```
   report_session_status({
     worktreePath: "<...>",
     state: "waiting",
     task: "<same as task start>",
     summary: "<what's blocking>",
     nextAction: "answer the question above"
   })
   ```
3. **Task complete.** When the mission is done and you're presenting the
   result:
   ```
   report_session_status({
     worktreePath: "<...>",
     state: "ready",
     task: "<unchanged>",
     summary: "<what you produced; ≤200 chars>",
     nextAction: "<e.g. 'review findings'>"
   })
   ```
4. **Task failed or aborted.** When you cannot continue without user input or
   have given up:
   ```
   report_session_status({
     worktreePath: "<...>",
     state: "failed",
     task: "<unchanged>",
     summary: "<what blocked completion>",
     nextAction: "<recovery action>"
   })
   ```
5. **Task pivot.** When the user explicitly redirects you mid-stream to a
   different mission, push the same shape as task start with the NEW `task`
   value.
6. **Register for conversation resume (once, at session start).** The app can
   offer to reopen THIS exact conversation after an ai-14all restart or a
   shell relaunch, but only if you tell it how. Do this once, early in the
   session:
   1. Read `$AI14ALL_TERMINAL_SESSION_ID`. If unset, skip this step silently
      (see Preconditions).
   2. Work out YOUR OWN resume invocation using your CLI's own verified
      mechanism (the per-provider list below). Never guess — if your CLI
      isn't listed, do not register.
   3. Call `register_agent_session({ worktreePath, terminalSessionId, provider, resumeCommand })`:
      - `worktreePath` — same value used in every push above.
      - `terminalSessionId` — the value read in step 1.
      - `provider` — your CLI's binary name (e.g. `"claude"`, `"codex"`,
        `"ezio"`).
      - `resumeCommand` — the complete command that reopens this exact
        conversation. Must contain **only** the characters
        `[A-Za-z0-9 ._/:=@-]` — no `$`, `;`, `|`, quotes, or other shell
        syntax. Resolve any environment variable YOURSELF before building the
        string; never pass the literal `$VAR` form.
   4. If the MCP tool is absent, times out, or returns an error, skip
      silently — this is a best-effort registration, not a required step.

   Per-provider one-liners (each verified by running the CLI's own `--help`
   output — do not extend this list without similar verification):
   - **Claude Code**: read `$CLAUDE_CODE_SESSION_ID` (set in every Claude
     Code process's environment). If present, register
     `claude --resume <value-of-CLAUDE_CODE_SESSION_ID>` — e.g. if the
     variable holds `11111111-2222-3333-4444-555555555555`, register
     `claude --resume 11111111-2222-3333-4444-555555555555`. Confirmed via
     `claude --help` (`-r, --resume [value]  Resume a conversation by
     session ID`) and by observing `CLAUDE_CODE_SESSION_ID` set in the
     running process's own environment.
   - **Codex**: register `codex resume --last`. Confirmed via
     `codex resume --help`: "Resume a previous interactive session (picker
     by default; use --last to continue the most recent)", and session
     listing is cwd-scoped by default (`--all` is documented as the flag
     that *disables* cwd filtering) — so `--last` without `--all` picks up
     the most recent session in this worktree, not globally. No session-id
     environment variable was found for Codex, so this coarser cwd-scoped
     form is the verified option — do not invent a `codex resume <id>` form
     without one.
   - **Ezio**: register `ezio --continue`. Confirmed via `ezio --help`:
     `-c, --continue  Resume the most recent conversation in this
     directory`. No session-id environment variable was found for Ezio
     either, so use this cwd-scoped form.
   - **Any other CLI** (Cursor, Antigravity, or anything not listed above):
     do not register. Its resume mechanics have not been verified against
     this skill's character-allowlist and cwd/session-id semantics —
     registering an unverified guess risks a `resumeCommand` that silently
     does the wrong thing (or nothing) when replayed.

## Output

- One `report_session_status` call per lifecycle transition, carrying the
  fields described in Inputs. The app's sidebar reflects the pushed `state`
  and attention indicator; there is no other visible output.
- At most one `register_agent_session` call per session (only when the
  preconditions hold), after which the app can offer to reopen this
  conversation.
- When a push or registration is skipped (tool unavailable, precondition
  unmet), no message to the user and no retry — the skill produces silence,
  not an error.

## Examples

**Task start.** Input: the user says "Build a login page with email/password
validation." This is a new high-level mission, and the worktree is
`/workspace/webapp`.

Output: the agent calls
```
report_session_status({
  worktreePath: "/workspace/webapp",
  state: "active",
  task: "Build a login page with email/password validation",
  summary: "Starting login page",
  nextAction: null
})
```
and then begins the work.

**Session-start registration.** Input: this is the first turn of a new
Claude Code session in worktree `/workspace/webapp`.
`$AI14ALL_TERMINAL_SESSION_ID` is `term-abc123` and
`$CLAUDE_CODE_SESSION_ID` is `11111111-2222-3333-4444-555555555555`.

Output: the agent calls
```
register_agent_session({
  worktreePath: "/workspace/webapp",
  terminalSessionId: "term-abc123",
  provider: "claude",
  resumeCommand: "claude --resume 11111111-2222-3333-4444-555555555555"
})
```
once, early in the session, before any lifecycle pushes.

## Anti-patterns

- Pushing status for routine tool calls, per-turn progress updates, or
  internal planning/self-talk steps.
- Pushing on every sub-step within a mission — stay `active` until you finish
  or transition to waiting/ready/failed.
- Calling `report_session_status` during a turn where the message you're
  acting on is an ai-whisper workflow handoff or resume notice — the app's
  workflow lens already tracks the run, and the sidebar suppresses
  non-workflow attention while it's active. (The one-time resume
  registration is not affected by this exception; resume normal lifecycle
  pushes on ordinary interactive turns.)
- Registering a resume command for a CLI that isn't on the verified
  per-provider list — guessing risks a `resumeCommand` that silently does the
  wrong thing (or nothing) when replayed.
- Passing the literal `$VAR` form as `resumeCommand` instead of resolving the
  environment variable yourself before building the string.
- Treating a missing or failing `report_session_status` or
  `register_agent_session` call as blocking — always skip silently and keep
  working.
