---
name: ai-14all-session-status
description: Push your current task and lifecycle state to the ai-14all desktop app's sidebar via report_session_status MCP tool. Always-on; follow these instructions whenever working inside an ai-14all worktree.
---

# Reporting Session Status to ai-14all

The ai-14all app shows each running agent in its left sidebar with an attention
indicator. Help the user track what you're doing by pushing your state via the
`report_session_status` MCP tool at five lifecycle moments.

## When to push

### 1. Task start

Whenever the user gives you a new high-level mission (not a sub-step of an
existing mission), push immediately:

```
report_session_status({
  worktreePath: "<absolute path of your cwd>",
  state: "active",
  task: "<≤200 chars summarizing the mission>",
  summary: "Starting <task>",
  nextAction: null
})
```

### 2. Waiting on user input

Whenever you have to stop and ask the user something:

```
report_session_status({
  worktreePath: "<...>",
  state: "waiting",
  task: "<same as task start>",
  summary: "<what's blocking>",
  nextAction: "answer the question above"
})
```

### 3. Task complete

When the mission is done and you're presenting the result:

```
report_session_status({
  worktreePath: "<...>",
  state: "ready",
  task: "<unchanged>",
  summary: "<what you produced; ≤200 chars>",
  nextAction: "<e.g. 'review findings'>"
})
```

### 4. Task failed or aborted

When you cannot continue without user input or have given up:

```
report_session_status({
  worktreePath: "<...>",
  state: "failed",
  task: "<unchanged>",
  summary: "<what blocked completion>",
  nextAction: "<recovery action>"
})
```

### 5. Task pivot

When the user explicitly redirects you mid-stream to a different mission, push
the same shape as Task start with the NEW `task` value.

### 6. Register for conversation resume (once, at session start)

The app can offer to reopen THIS exact conversation after an ai-14all restart
or a shell relaunch, but only if you tell it how. Do this once, early in the
session:

1. Read the `$AI14ALL_TERMINAL_SESSION_ID` environment variable. If it is
   unset, you are not running inside an ai-14all-managed terminal — skip this
   step silently (no error, no message to the user).
2. Work out YOUR OWN resume invocation using your CLI's own verified
   mechanism (see the per-provider list below). Never guess — if your CLI
   isn't listed, do not register.
3. Call `register_agent_session({ worktreePath, terminalSessionId, provider, resumeCommand })`:
   - `worktreePath`: absolute path of your cwd (same value used elsewhere in
     this skill).
   - `terminalSessionId`: the value read in step 1.
   - `provider`: your CLI's binary name (e.g. `"claude"`, `"codex"`, `"ezio"`).
   - `resumeCommand`: the complete command that reopens this exact
     conversation. It must contain **only** the characters
     `[A-Za-z0-9 ._/:=@-]` — no `$`, `;`, `|`, quotes, or other shell syntax.
     Resolve any environment variable YOURSELF before building the string;
     never pass the literal `$VAR` form.
4. If the MCP tool is absent, times out, or returns an error, skip silently —
   this is a best-effort registration, not a required step.

Per-provider one-liners (each verified by running the CLI's own `--help`
output — do not extend this list without similar verification):

- **Claude Code**: read `$CLAUDE_CODE_SESSION_ID` (set in every Claude Code
  process's environment). If present, register
  `claude --resume <value-of-CLAUDE_CODE_SESSION_ID>` — e.g. if the variable
  holds `11111111-2222-3333-4444-555555555555`, register
  `claude --resume 11111111-2222-3333-4444-555555555555`. Confirmed via
  `claude --help` (`-r, --resume [value]  Resume a conversation by session
ID`) and by observing `CLAUDE_CODE_SESSION_ID` set in the running process's
  own environment.
- **Codex**: register `codex resume --last`. Confirmed via
  `codex resume --help`: "Resume a previous interactive session (picker by
  default; use --last to continue the most recent)", and session listing is
  cwd-scoped by default (`--all` is documented as the flag that _disables_
  cwd filtering) — so `--last` without `--all` picks up the most recent
  session in this worktree, not globally. No session-id environment variable
  was found for Codex, so this coarser cwd-scoped form is the verified
  option — do not invent a `codex resume <id>` form without one.
- **Ezio**: register `ezio --continue`. Confirmed via `ezio --help`:
  `-c, --continue  Resume the most recent conversation in this directory`. No
  session-id environment variable was found for Ezio either, so use this
  cwd-scoped form.
- **Any other CLI** (Cursor, Antigravity, or anything not listed above): do
  not register. Its resume mechanics have not been verified against this
  skill's character-allowlist and cwd/session-id semantics — registering an
  unverified guess risks a `resumeCommand` that silently does the wrong
  thing (or nothing) when replayed.

## When NOT to push

- Routine tool calls or per-turn progress updates.
- Internal planning / self-talk steps.
- Sub-steps within a mission. Stay `active` until you finish or transition to
  waiting/ready/failed.
- **Workflow exception:** if the message you are acting on is an ai-whisper
  workflow handoff (or a workflow resume notice), do not call
  `report_session_status` at all during that turn — the app's workflow lens
  already tracks the run and the sidebar suppresses non-workflow attention
  while it is active. Resume normal lifecycle pushes on ordinary interactive
  turns. (Section 6's one-time resume registration is NOT affected by this
  exception.)

## Notes

- `task` is the high-level mission, ≤200 chars. Repeat it in every push for the
  same mission. Only change it on pivot.
- The MCP tool is `report_session_status`. Validate it's available before
  using; if not (e.g. the app isn't running), silently skip pushes — your work
  continues normally.
