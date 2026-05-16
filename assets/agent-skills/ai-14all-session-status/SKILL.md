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

## When NOT to push

- Routine tool calls or per-turn progress updates.
- Internal planning / self-talk steps.
- Sub-steps within a mission. Stay `active` until you finish or transition to
  waiting/ready/failed.

## Notes

- `task` is the high-level mission, ≤200 chars. Repeat it in every push for the
  same mission. Only change it on pivot.
- The MCP tool is `report_session_status`. Validate it's available before
  using; if not (e.g. the app isn't running), silently skip pushes — your work
  continues normally.
