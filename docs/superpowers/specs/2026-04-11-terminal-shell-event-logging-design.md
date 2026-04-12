# Terminal Shell Event Logging Design

**Date:** 2026-04-11
**Status:** Approved

## Purpose

This spec adds a dedicated shell-event logging system around the embedded terminal stack in `ai-14all`.

The immediate goal is root-cause analysis for a critical product issue: terminal shells are sometimes "lost" during active use. The logging system must make it possible to determine whether a shell was lost because:

- the PTY actually exited
- the backend session registry dropped the session
- the renderer stopped tracking an otherwise-live backend session
- a workspace/worktree/session switch legitimately moved focus away from the shell
- a renderer reload, window lifecycle transition, blur/focus cycle, or reconnect path caused the shell to disappear

This logging is temporary product instrumentation, but it must be shipped in both development and beta release modes until the issue is understood and fixed.

## Problem

Current terminal behavior exposes several failure boundaries:

- Electron main owns the PTY lifecycle
- renderer owns visible session tracking, pane mounting, and workspace/worktree selection
- renderer reconnect logic may adopt live PTY sessions after reloads
- multi-workspace switching intentionally backgrounds some sessions while keeping them alive
- window focus and refresh behavior can trigger worktree refreshes and renderer lifecycle churn

When a shell appears to disappear, current telemetry is too shallow to answer the key questions:

- Which terminal session ID belonged to which process session, worktree, and workspace at the time?
- Which workspace/worktree/process was active immediately before the loss?
- Did the user just switch workspace, switch worktree, select another terminal tab, stop the process, or reload the renderer?
- Did the PTY exit first, or did only the renderer stop showing it?
- Did the backend still consider the session alive after the renderer lost it?

Without a durable, correlated event log, the failure looks like "shell vanished" even when the real cause may be a valid switch, a renderer tracking bug, or an actual PTY crash.

## Goals

This logging slice must:

- run automatically in development builds
- run automatically in packaged beta builds
- write outside the repository, under the app runtime folder (`app.getPath("userData")`)
- capture both backend PTY events and renderer lifecycle/context-switch events
- include enough payload to reconstruct session ownership and causality over time
- distinguish expected session changes caused by valid user actions from unexpected loss
- preserve full PTY payload for debugging, including input and output
- keep log retention tight by pruning files older than 3 days
- avoid adding product UI just for log discovery

## Non-Goals

This spec does not include:

- a user-facing diagnostics panel
- log upload, export, or support tooling
- permanent analytics or product telemetry infrastructure
- replacing the existing terminal architecture
- automated bug diagnosis beyond writing structured logs
- keeping logs forever or across long historical ranges

## Recommended Approach

Use one structured `jsonl` log file per app launch, owned by Electron main.

Why this approach:

- PTY truth already lives in Electron main, so main is the authoritative place to persist logs
- renderer can report its own lifecycle and tracking events to main with lightweight fire-and-forget IPC
- a per-launch log keeps investigation bounded and makes sequence reconstruction straightforward
- `jsonl` is easy to inspect with shell tools and simple scripts without adding storage complexity

This is preferable to a SQLite event store because the current problem is instrumentation, not query power. It is preferable to separate per-session files because the failure likely spans renderer lifecycle, workspace switching, and backend session state in one timeline.

## Enablement Rules

Logging is always on in:

- development mode
- packaged beta builds

Logging is off by default in non-beta packaged production builds after the investigation phase is complete.

Mode detection rules:

- **development**: `app.isPackaged === false`
- **beta release**: `app.isPackaged === true` and `app.getVersion()` contains `-beta.`

The implementation may keep a test-only environment override so unit and e2e tests can redirect logs to controlled temporary paths.

## Storage And Retention

### Location

Logs live under Electron user data, not inside the repository:

- macOS example: `~/Library/Application Support/ai-14all/diagnostics/shell-events/`

This should resolve from:

- `join(app.getPath("userData"), "diagnostics", "shell-events")`

### File Model

One file per app launch:

- file name includes launch timestamp and run ID
- example shape: `2026-04-11T12-34-56.789Z-run_<uuid>.jsonl`

Each line is one event object.

### Retention

On app startup:

- delete shell-event log files older than 3 days

No UI is added for cleanup. Pruning is automatic and best-effort.

## Architecture

### Main-Owned Log Service

Add a `ShellEventLogService` in Electron main.

Responsibilities:

- resolve whether logging is enabled for this app run
- create the diagnostics directory
- create the per-run `jsonl` file
- prune old log files on startup
- append structured event records
- assign monotonic sequence numbers
- provide a small logging API to Electron main services and IPC handlers
- receive renderer-side log events and persist them with the same run sequence

This service must be best-effort only. Logging must never break terminal behavior, workspace switching, restore, or app startup.

### Renderer-To-Main Logging Bridge

Renderer should not write files directly.

Instead:

- preload exposes a typed `diagnostics.logShellEvent(...)` bridge
- renderer emits structured diagnostic events through that bridge
- Electron main persists them through `ShellEventLogService`

This preserves renderer sandboxing and keeps file writes centralized.

### Best-Effort Failure Behavior

If log initialization or append fails:

- emit one in-memory fallback warning to console
- record one `shell-log-disabled` event if possible
- disable further shell logging for the current run

The app must continue running normally.

## Event Record Shape

Every event line must include a common envelope:

```ts
type ShellEventRecord = {
  at: string;
  runId: string;
  seq: number;
  source: "main" | "renderer";
  event: string;
  windowId: number | null;
  rendererAt?: string | null;
  rendererSeq?: number | null;
  reasonKind?: "user_action" | "system_reconnect" | "window_lifecycle" | "process_exit" | "backend_cleanup" | "renderer_drop" | "unknown";
  reason?: string | null;
  triggerEventId?: string | null;
  isExpected?: boolean | null;
  expectedBecause?: string | null;
  eventId: string;
  data: Record<string, unknown>;
};
```

`eventId` is unique per event. `triggerEventId` links derived events to the explicit action that caused them.

`seq` is the durable write order in the log file, not a guarantee of original renderer emission order. For renderer-originated events, `rendererAt` and `rendererSeq` must be populated so analysis can reconstruct renderer-local ordering when IPC delivery order differs from emission order.

## Correlation Payload

To diagnose shell loss, raw event names are not enough. Each relevant event must include a binding snapshot that explains where the shell belonged at that moment.

### Binding Fields

When known, include:

- `terminalSessionId`
- `processSessionId`
- `workspaceId`
- `worktreeId`
- `paneInstanceId`
- `activeWorkspaceId`
- `activeWorktreeId`
- `activeProcessId`
- `trackedRendererSessionIds`
- `liveBackendSessionIds`
- `visibleTerminalSessionIds`

### Transition Fields

For switching or reassignment events, also include:

- `previousBinding`
- `nextBinding`
- `supersedesSessionId`
- `isExpected`
- `expectedBecause`

`previousBinding` and `nextBinding` should each capture the workspace/worktree/process/session tuple known at the time.

### Cause Fields

Every lifecycle-changing event should carry explicit cause metadata:

- `reasonKind`
- `reason`
- `triggerEventId`

Expected examples:

- `reasonKind: "user_action"`, `reason: "workspace_switch"`
- `reasonKind: "user_action"`, `reason: "worktree_switch"`
- `reasonKind: "user_action"`, `reason: "terminal_tab_switch"`
- `reasonKind: "user_action"`, `reason: "user_stop"`
- `reasonKind: "window_lifecycle"`, `reason: "renderer_reload"`
- `reasonKind: "window_lifecycle"`, `reason: "app_blur"`
- `reasonKind: "window_lifecycle"`, `reason: "app_focus_refresh"`
- `reasonKind: "process_exit"`, `reason: "pty_exit"`
- `reasonKind: "renderer_drop"`, `reason: "lost_tracking"`
- `reasonKind: "backend_cleanup"`, `reason: "service_dispose"`
- `reasonKind: "unknown"`, `reason: "unexpected_session_removal"`

This is the mechanism that lets the logs answer not only **what changed**, but **why it changed**.

## Event Taxonomy

### App And Window Lifecycle

Log:

- `app-log-start`
- `app-log-pruned`
- `window-created`
- `window-focus`
- `window-blur`
- `window-close`
- `window-webcontents-did-start-loading`
- `window-webcontents-did-finish-load`
- `window-webcontents-render-process-gone`
- `window-webcontents-destroyed`
- `renderer-start`
- `renderer-before-unload`
- `renderer-window-focus`
- `renderer-window-blur`
- `renderer-visibility-hidden`
- `renderer-visibility-visible`
- `app-became-inactive`
- `app-became-active`

These events provide the app/background/foreground timeline needed to inspect shell loss around blur, focus regain, and reloads.

All `window-*` events must populate `windowId` with the owning Electron `BrowserWindow` ID.

### Workspace And Worktree Context Changes

Log:

- `workspace-open-request`
- `workspace-open-success`
- `workspace-open-failed`
- `workspace-register`
- `workspace-select`
- `workspace-activate-start`
- `workspace-activate-hit-live`
- `workspace-activate-hydrate-dormant`
- `workspace-activate-complete`
- `workspace-backgrounded`
- `workspace-foregrounded`
- `worktree-select`
- `worktree-restore-pending-session`
- `terminal-process-select`
- `terminal-layout-change`
- `terminal-tab-select`
- `terminal-pane-visible`
- `terminal-pane-hidden`

These events are required because a shell may appear "lost" when it was actually backgrounded by switching workspace or selecting another session.

### Backend PTY Lifecycle

Log:

- `terminal-create-request`
- `terminal-create-start`
- `terminal-create-success`
- `terminal-create-failed`
- `terminal-session-registered`
- `terminal-send-input`
- `terminal-output`
- `terminal-resize`
- `terminal-stop-request`
- `terminal-stop-complete`
- `terminal-exit`
- `terminal-dispose`
- `terminal-session-missing`

These events are the PTY source of truth.

### Renderer Tracking And Reconnect

Log:

- `renderer-session-create-request`
- `renderer-session-create-success`
- `renderer-session-adopt`
- `renderer-session-tracked`
- `renderer-session-untracked`
- `renderer-terminal-mounted`
- `renderer-terminal-unmounted`
- `renderer-terminal-subscribe`
- `renderer-terminal-output-received`
- `renderer-terminal-exit-received`
- `renderer-terminal-state-received`
- `renderer-terminal-error-received`
- `renderer-reconnect-list-start`
- `renderer-reconnect-list-success`
- `renderer-reconnect-adopt`
- `renderer-reconnect-fallback-create`
- `renderer-reload-detected`
- `main-session-list-request`
- `main-session-list-response`
- `terminal-handler-forwarded`
- `terminal-handler-dropped`

These events let us determine whether the backend session survived while the renderer lost visibility or tracking.

### Derived Diagnostic Event

Add one explicit derived event:

- `terminal-binding-changed`

This event is logged whenever the app changes its effective terminal binding or discovers that the binding changed unexpectedly.

Payload includes:

- old workspace/worktree/process/session binding
- new workspace/worktree/process/session binding
- `isExpected`
- `expectedBecause`
- `triggerEventId`

This event exists specifically to make diagnosis easier than reconstructing everything from raw low-level events.

## PTY Payload Logging

### Scope

For root-cause analysis, lifecycle metadata alone is insufficient. The logger must capture full PTY payload events for:

- input sent to the PTY
- output produced by the PTY

### Payload Fields

For input/output events include:

- `text`
- `hex`
- `byteLength`
- `truncated`

Text helps quick inspection. Hex preserves exact byte-level truth when escape sequences or control bytes matter.

### Truncation

Large chunks may be truncated to keep single-event size bounded.

Concrete rule:

- truncate `text` and `hex` payload fields at 4 KiB of original text content per event

Truncation must preserve:

- exact byte length
- truncation flag
- leading payload content

This prevents unbounded growth while keeping events useful.

## Write Durability

Because the most important evidence may appear immediately before a PTY exit or renderer/process crash, the log write path must favor durability over throughput.

Required rule:

- Electron main must append shell-event records synchronously to a single open file descriptor for this temporary diagnostics phase

If implementation later switches to buffered async writes, it must explicitly flush and `fsync` after these critical events at minimum:

- `terminal-exit`
- `terminal-create-failed`
- `window-webcontents-render-process-gone`
- `shell-log-disabled`

For this investigation phase, the preferred implementation is synchronous append so crash-adjacent ordering and durability stay simple.

## Expected Vs Unexpected Session Change Rules

The logging system must explicitly classify whether a terminal change was expected.

### Expected Changes

If a user action directly precedes the change, the follow-up events must be linked with:

- `reasonKind: "user_action"`
- `reason: "workspace_switch" | "worktree_switch" | "terminal_tab_switch" | "user_stop"`
- `triggerEventId: <user-action-event>`
- `isExpected: true`

Examples:

- workspace switch
- worktree switch
- terminal tab switch
- explicit stop action

### Unexpected Changes

If a terminal disappears without a valid action chain:

- `isExpected: false`
- `expectedBecause: null`
- `reasonKind` should reflect the best available explanation

Examples:

- PTY exits unexpectedly
- renderer untracks a backend-live session
- backend session registry removes a session without a matching user stop or PTY exit
- session mapping changes after blur/focus/reload with no explicit user switch

### Unknown Cases

If the system cannot prove the cause:

- `reasonKind: "unknown"`
- `reason: "unexpected_session_removal"`
- `isExpected: false`

This is preferable to silently implying the change was legitimate.

## Implementation Boundaries

### Electron Main

Main should log:

- browser window lifecycle
- webContents lifecycle
- terminal service create/send/resize/stop/exit/dispose flows
- IPC request boundaries relevant to terminal listing and switching
- session-list snapshots for backend truth

### Renderer

Renderer should log:

- startup and unload
- focus/blur and visibility state
- workspace activation and selection
- worktree selection
- process selection
- terminal pane mount/unmount
- terminal session adoption/reconnect
- renderer receipt of output/state/exit/error events
- refresh interval start/stop and refocus-triggered refresh

### No UI Changes

No new diagnostics UI is added for this phase.

The user is the beta tester and can inspect logs directly in the app data folder.

## File Changes

Expected files:

- `electron/main/index.ts`
  - initialize `ShellEventLogService`
- `electron/main/windows.ts`
  - hook window and webContents lifecycle logging
- `electron/main/ipc.ts`
  - log terminal-related IPC boundaries
  - add renderer-to-main diagnostics logging handler
- `electron/preload/index.ts`
  - expose typed diagnostics bridge
- `services/terminals/terminal-service.ts`
  - emit detailed PTY lifecycle, input, output, and exit logs
- `shared/contracts/commands.ts`
  - add typed diagnostics logging command schema
- `shared/contracts/events.ts`
  - add shared diagnostic event typing for renderer-to-main payloads
- `src/lib/desktop-client.ts`
  - expose diagnostics log API to renderer
- `src/app/App.tsx`
  - log workspace/worktree/focus/reconnect/refresh transitions
- `src/features/terminals/useTerminalSession.ts`
  - log renderer session tracking and subscription lifecycle
- `src/features/terminals/TerminalPane.tsx`
  - log pane mount/unmount and visible session binding
- `services/diagnostics/shell-event-log-service.ts`
  - new main-owned log service

If the repo already has a better service folder for main-owned diagnostics helpers, that folder may be used instead of `services/diagnostics/`, but the main-owned responsibility split in this section is required.

## Testing

### Unit Tests

Add tests for:

- log enablement in dev and beta, disabled in non-beta packaged mode
- log path resolution under `userData`
- 3-day prune behavior
- `jsonl` event append shape and sequence numbering
- PTY lifecycle logging in `TerminalService`
- renderer logging helper payload shape and cause metadata
- `terminal-binding-changed` derivation for expected and unexpected transitions

### Integration Tests

Add app-level tests for:

- workspace switch logs expected terminal binding changes
- worktree switch logs expected binding changes
- reconnect path logs adopt vs fallback clearly
- renderer unload/reload emits lifecycle sequence without breaking tracking state

### E2E Tests

Extend existing terminal resilience and multi-workspace tests to assert:

- switching workspace does not produce an unexpected terminal loss when backend session remains alive
- renderer reload logs reconnect/adopt flow for surviving sessions
- blur/focus cycles generate app lifecycle logs around refresh-triggered activity

The e2e assertions do not need to validate every event field, but they must prove the diagnostics system captures the failure boundaries this spec is designed to investigate.

## Risks And Tradeoffs

### Log Volume

Full PTY payload logging can grow quickly.

Accepted tradeoff:

- logging is time-limited to dev and beta
- retention is only 3 days
- payload chunks may be truncated with explicit metadata

### Logging Overhead

Structured file append adds some I/O overhead.

Accepted tradeoff:

- durability of the diagnostic trail is worth the temporary cost
- logging must remain best-effort and must never block or crash terminal flows

### Partial Knowledge

Some events may still end with `reasonKind: "unknown"`.

Accepted tradeoff:

- explicit uncertainty is better than silently misclassifying shell loss as a valid switch

## Success Criteria

This slice is successful when a future shell-loss report can be answered from logs with high confidence:

- what terminal session was affected
- what workspace/worktree/process it belonged to
- what the active workspace/worktree/process was immediately before and after
- whether the change followed a valid user action
- whether the PTY exited, the backend dropped the session, or only the renderer lost track of it
- whether app blur/focus, renderer reload, or reconnect logic was involved
