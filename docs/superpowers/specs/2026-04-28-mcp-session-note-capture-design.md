# MCP Session Note Capture Design

**Date:** 2026-04-28
**Status:** Approved (brainstorm)
**Scope:** Add MCP tools so an agent can append timestamped sections to the current ai-14all session note when the user explicitly asks.

## 1. Problem

Mid-conversation, the user often hits an idea, correction, or decision worth re-evaluating later. Today the only persistent place to capture it is a markdown file in the repo, which requires writing a file and Git-tracking content that may not belong in the codebase. The desktop app already has a per-`WorktreeSession` `note: string` (rendered by `NoteSheet`), but the agent has no way to write to it. We want the agent to append a new section to that note when (and only when) the user explicitly says to save / note / remember something.

## 2. Goals & Non-Goals

**Goals**

- Agent can append a titled, timestamped section to the current session note via MCP.
- Agent can read the current session note (to avoid duplicates / reference past entries).
- The open `NoteSheet` updates live when the agent appends.
- Append failures (unknown worktree, no session, IPC timeout) surface to the agent so it can tell the user.

**Non-Goals**

- Autonomous capture. The tool description explicitly tells the agent to call only when the user asks.
- Section-level edit / replace / delete. Append + read only. Existing `NoteSheet` textarea remains the editor for everything else.
- Cross-session notes / global notebook. One note per worktree session, same model as today.
- Moving note ownership out of the renderer reducer.

## 3. UX Decisions (resolved during brainstorm)

| Decision | Choice |
|---|---|
| Trigger | Explicit user request only (encoded in tool description) |
| Section format | `## {title} — {YYYY-MM-DD HH:MM local}` then blank line then body |
| Tool surface | `append_session_note` + `read_session_note` |
| MCP server location | Extend existing server, rename to `Ai14allMcpServer` (single port, single agent config) |
| Live UI refresh | Yes — open `NoteSheet` re-renders as note state updates |
| Append position | Bottom (chronological top→bottom) |
| Timestamp TZ | User's local time, no seconds, no timezone suffix |
| Unknown `worktreePath` | Error to agent (no silent no-op) |

## 4. Architecture

```
agent (CLI)
  │ MCP HTTP request (mcp-session-id header)
  ▼
[main] Ai14allMcpServer  ── append_session_note / read_session_note / existing review tools
  │
  ▼
[main] SessionNoteBridge ── correlation-id request/response over IPC
  │ webContents.send("mcp:note:request", { id, op, args })
  ▼
[renderer] noteBridgeReceiver
  │ resolve session by worktreeId, dispatch session/setNote (append) or read current note
  │ ipcRenderer.send("mcp:note:reply", { id, ok, payload | error })
  ▼
[main] bridge resolves pending promise → MCP tool returns to agent
```

The renderer reducer remains the single source of truth for `WorktreeSession.note`. Existing `workspace-persistence` continues to save it. `NoteSheet` is bound to the same state so it refreshes for free when the reducer updates.

## 5. Components / Files

### 5.1 Renamed

- `services/review/review-mcp-server.ts` → `services/mcp/ai14all-mcp-server.ts`
  - Class `ReviewMcpServer` → `Ai14allMcpServer`.
  - Split tool registration into `registerReviewTools(mcp)` and `registerNoteTools(mcp)`.
  - Constructor takes the existing `ReviewCommentService` + `WorktreePathResolver` plus a new `SessionNoteBridge`.
- `tests/unit/review/review-mcp-server.test.ts` → `tests/unit/mcp/ai14all-mcp-server.test.ts`.
- Update all imports referencing the old paths.

### 5.2 New (main process)

`services/mcp/session-note-bridge.ts`

```ts
export class SessionNoteBridge {
  constructor(getWebContents: () => Electron.WebContents | null);
  append(
    worktreeId: string,
    title: string,
    body: string,
  ): Promise<{ note: string; appendedSection: string }>;
  read(worktreeId: string): Promise<{ note: string }>;
  dispose(): void;
}
```

Internal:
- `pending: Map<string, { resolve, reject, timer }>` keyed by `randomUUID()`.
- `rendererReady: boolean` flag, default `false`.
- Three `ipcMain.on(...)` listeners installed at construction:
  - `mcp:note:ready` → set `rendererReady = true`. Renderer pings on receiver install.
  - `mcp:note:goodbye` → set `rendererReady = false` and reject all `pending` with `RendererGone`. Renderer pings on receiver dispose.
  - `mcp:note:reply` → match by id, resolve / reject pending entry, clear timer. Replies for unknown ids are dropped silently (defensive; never throw).
- Per-request timeout: 5000 ms → reject `BridgeTimeout`.
- Pre-flight on `append` / `read`:
  - If `rendererReady === false` → reject `RendererNotReady` immediately (no IPC send, no 5 s wait). This is the expected state during the early-boot window between MCP server start and renderer mount, and again after window destroy.
  - If `getWebContents()` returns null at request time → reject `RendererNotReady` (same code; treat as "renderer not currently reachable").
- `dispose()` removes all three listeners, rejects every pending entry with `BridgeDisposed`, and clears timers. Idempotent.

### 5.3 Preload additions

In `electron/preload/index.ts`, add to the existing exposed API:

- `onNoteBridgeRequest(handler: (req: NoteBridgeRequest) => void): () => void` — wraps `ipcRenderer.on("mcp:note:request", …)`, returns an unsubscribe.
- `sendNoteBridgeReply(reply: NoteBridgeReply): void` — `ipcRenderer.send("mcp:note:reply", reply)`.
- `sendNoteBridgeReady(): void` — `ipcRenderer.send("mcp:note:ready")`.
- `sendNoteBridgeGoodbye(): void` — `ipcRenderer.send("mcp:note:goodbye")`.

`NoteBridgeRequest` / `NoteBridgeReply` types live in `shared/contracts/note-bridge.ts` (new) so both sides agree:

```ts
export type NoteBridgeRequest =
  | { id: string; op: "read"; worktreeId: string }
  | { id: string; op: "append"; worktreeId: string; title: string; body: string };

export type NoteBridgeReplySuccess =
  | { id: string; ok: true; op: "read"; note: string }
  | { id: string; ok: true; op: "append"; note: string; appendedSection: string };

export type NoteBridgeReplyError = {
  id: string;
  ok: false;
  error: "no_session";
  message: string;
};

export type NoteBridgeReply = NoteBridgeReplySuccess | NoteBridgeReplyError;
```

Only `no_session` is sent over the IPC reply channel. All other failure modes (`no_worktree`, `renderer_not_ready`, `bridge_timeout`, `bridge_disposed`) are produced by main-side code and never travel over IPC.

### 5.4 New (renderer)

`src/features/workspace/note-bridge-receiver.ts`

The receiver must search across **all** workspaces — active and inactive — because the agent can target any worktree it has access to, not only the one currently focused in the UI. App state already tracks this via `activeWorkspaceStateRef` and `inactiveWorkspaceStatesRef` (see `src/app/App.tsx:196-258`).

```ts
export type WorkspaceLookup = {
  /** Iterates [workspaceId, state] over active + inactive workspaces. */
  forEach(
    cb: (workspaceId: string, state: WorkspaceState) => void,
  ): void;
};

export type WorkspaceDispatch = (
  workspaceId: string,
  action: WorkspaceAction,
) => void;

export function installNoteBridgeReceiver(deps: {
  workspaces: WorkspaceLookup;
  dispatchTo: WorkspaceDispatch;       // routes to the correct workspace
  api: NoteBridgeApi;                  // from preload
  now?: () => Date;                    // injectable for tests
}): () => void;
```

Behaviour per request:

1. Locate session: iterate `workspaces.forEach`; the first `(workspaceId, state)` whose `state.sessionsByWorktreeId[req.worktreeId]` is defined wins. Record both the `workspaceId` and the matched `session = state.sessionsByWorktreeId[req.worktreeId]`. (`WorkspaceState.sessionsByWorktreeId: Record<string, WorktreeSession>` — see `src/features/workspace/workspace-state.ts:25`. Direct key lookup; no scan.)
2. If no match in any workspace → reply `{ id, ok: false, error: "no_session", message: "no session for worktreeId" }` and return.
3. **`op: "read"`**: reply `{ id, ok: true, op: "read", note: session.note }`.
4. **`op: "append"`**: compute `appendedSection` and `next` per §6.1. Call `dispatchTo(workspaceId, { type: "session/setNote", worktreeId, note: next })`. Reply `{ id, ok: true, op: "append", note: next, appendedSection }`.

Lifecycle (gated on app readiness):

- The receiver is installed only after the app reaches `startupMode === "ready"` (see `src/app/App.tsx:119,347` for the `StartupMode` enum and the transitions to `"ready"`). Before that, workspaces have not been restored yet, `sessionsByWorktreeId` is empty for all known worktrees, and an agent call would resolve to a valid worktree in main but receive a misleading `no_session`.
- On install (after `"ready"`): send `api.sendNoteBridgeReady()` so the main-side bridge flips `rendererReady = true`.
- On returned unsubscribe: send `api.sendNoteBridgeGoodbye()` and remove the request listener. Wired to the `useEffect` cleanup in `App.tsx`, plus a `beforeunload` listener so HMR / reloads also notify the bridge.
- If startup ever unwinds (e.g., user is sent back to the repository prompt and `startupMode` leaves `"ready"`, or if the model later supports re-entering startup), the effect cleanup fires `goodbye` and the bridge returns to `rendererReady = false`. Subsequent agent calls then get `renderer_not_ready` until the next ready.

`App.tsx` integration: a single `useEffect`, gated on `startupMode === "ready"`, mounts the receiver. `WorkspaceLookup` is implemented inline using the existing refs (`activeWorkspaceStateRef` + `inactiveWorkspaceStatesRef`); `dispatchTo(workspaceId, action)` reuses `getWorkspaceStateById` + the existing per-workspace reducer dispatch path (`src/app/App.tsx:250-290`).

### 5.5 Wiring

- In `electron/main/index.ts`, after `mainWindow` is created and before `Ai14allMcpServer.start()`:
  - Instantiate `const sessionNoteBridge = new SessionNoteBridge(() => mainWindow.webContents)`.
  - Pass it into the `Ai14allMcpServer` constructor.
- Boot-order note: the MCP server starts before `mainWindow.loadURL/loadFile` (see `electron/main/index.ts:138`). The bridge therefore starts in `rendererReady = false`. The renderer also restores its persisted workspace state asynchronously after mount and only sets `startupMode === "ready"` once that completes (see `src/app/App.tsx:404,467,1196,1249,2756`). The receiver does **not** ping `mcp:note:ready` until both conditions hold: the receiver is installed (renderer mounted) **and** `startupMode === "ready"` (workspaces restored). Any agent call arriving before then fast-fails with `renderer_not_ready` rather than misleading the agent with `no_session` from an empty `sessionsByWorktreeId`. Agents should treat `renderer_not_ready` as retryable.
- Shutdown: extend the existing `app.on("before-quit", …)` block in `electron/main/index.ts:145` to also call `sessionNoteBridge.dispose()`.
- `App.tsx`: one effect calls `installNoteBridgeReceiver(...)`. The cleanup function returned by the effect calls the receiver's unsubscribe (which sends `mcp:note:goodbye`).

## 6. Behaviour details

### 6.1 Append rendering

```ts
const pad = (n: number) => String(n).padStart(2, "0");
const d = now();
const ts =
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
  ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const section = `## ${title} — ${ts}\n\n${body}`;
const next = prev.length === 0 ? section : `${prev}\n\n${section}`;
```

- Empty `prev` → no leading blank lines.
- Body is preserved as-is (no trim) so the caller's formatting is not altered.

### 6.2 Tool contracts

`append_session_note`

- Args (zod): `worktreePath: z.string().min(1)`, `title: z.string().min(1)`, `body: z.string().min(1)`.
- Description (shown to agent): "Append a new section to the current ai-14all session note. Call ONLY when the user explicitly asks to save / note / remember something. Do NOT call autonomously."
- Result content (single text item, JSON):
  - Success: `{ ok: true, appendedSection: <string>, note: <newNote> }` — `appendedSection` is the rendered heading line `## {title} — {YYYY-MM-DD HH:MM}`. The renderer is the only side that knows the local timestamp, so it returns `appendedSection` on the bridge reply (per §5.3 reply union) and the MCP server passes it through unchanged.
  - Failure: `{ ok: false, error: <code>, message: <human> }`

`read_session_note`

- Args (zod): `worktreePath: z.string().min(1)`.
- Description: "Read the current ai-14all session note. Useful before appending to avoid duplicates."
- Result content:
  - Success: `{ ok: true, note: string }`
  - Failure: `{ ok: false, error: <code>, message: <human> }`

### 6.3 Error matrix

| Failure | Layer that produces it | Result code |
|---|---|---|
| `worktreePath` not in any worktree | `Ai14allMcpServer` (resolver pre-check, never hits bridge) | `no_worktree` |
| WorktreeId has no session in any workspace | renderer receiver, returned via `NoteBridgeReply` | `no_session` |
| Renderer not yet mounted, workspace restore not complete (`startupMode !== "ready"`), or window destroyed | `SessionNoteBridge` (`rendererReady === false` or webContents null) | `renderer_not_ready` (retryable) |
| Renderer announced `mcp:note:goodbye` mid-flight | `SessionNoteBridge` (rejects pending entries) | `renderer_gone` |
| IPC reply timeout (5 s) | `SessionNoteBridge` (timer fires) | `bridge_timeout` |
| Bridge disposed (app shutdown) mid-flight | `SessionNoteBridge.dispose()` | `bridge_disposed` |
| Empty title / body | zod inside MCP SDK | (SDK validation error) |

`Ai14allMcpServer` is the only layer that builds the final tool result JSON. It catches bridge rejections and maps them to `{ ok: false, error: <code>, message }`. The `NoteBridgeReply` union therefore only needs to carry the renderer-side code (`no_session`); all other codes are produced in main and never travel over IPC.

All non-validation errors are returned as JSON tool content with `ok: false`. The agent can choose to retry or surface to the user.

## 7. Edge cases

- **Concurrent appends from one agent.** Renderer reducer is single-threaded; sequential dispatches preserve order.
- **Renderer reload (Vite HMR / window reload) during in-flight request.** A `beforeunload` listener fires `mcp:note:goodbye`, so the bridge rejects the in-flight request with `renderer_gone` rather than waiting 5 s. After reload, the receiver re-installs and pings `mcp:note:ready`; subsequent calls succeed.
- **Early-boot agent call.** MCP server starts before the renderer mounts, and the renderer further defers `mcp:note:ready` until `startupMode === "ready"` (i.e., persisted workspace state has been restored and `sessionsByWorktreeId` is populated). Calls during this window return `renderer_not_ready` immediately, never `no_session` from an empty session map. Agents should retry on `renderer_not_ready`.
- **Worktree exists but session lives in an inactive workspace.** Receiver still finds it (search covers active + inactive) and dispatches into the owning workspace. The note update applies even if the user is not currently looking at that workspace.
- **Body containing `## ` headings.** Allowed; no escaping. The user wrote it (via the agent), and the textarea is a freeform editor anyway.
- **Body with trailing newline.** Preserved verbatim; no trim.
- **Note size.** Unbounded, same as today. Existing textarea has no cap.
- **Multiple desktop windows.** Out of scope — app is single-window today. `getWebContents` returns the main window.

## 8. Testing

### 8.1 Unit (renderer) — `tests/unit/features/workspace/note-bridge-receiver.test.ts`

- append into empty note → exact `## title — 2026-04-28 14:32\n\nbody` shape (mock `now`); reply payload contains `appendedSection` matching the heading line only.
- append into non-empty note → `prev + "\n\n" + section`.
- unknown `worktreeId` (no match in any workspace) → reply `{ ok: false, error: "no_session" }`, no dispatch.
- session present in an **inactive** workspace → receiver finds it via `WorkspaceLookup.forEach`, `dispatchTo` is invoked with the inactive workspace's id (multi-workspace coverage).
- read returns the current note for the matched workspace.
- timestamp components zero-padded (single-digit month/day/hour/minute).
- on install the receiver calls `api.sendNoteBridgeReady()`; the unsubscribe returned by `installNoteBridgeReceiver` calls `api.sendNoteBridgeGoodbye()`.
- session lookup uses `state.sessionsByWorktreeId[req.worktreeId]` (verifies the spec's keyed-record shape, not a scan over a non-existent `state.sessions` array).
- App-level effect test: with `startupMode === "loading"`, `installNoteBridgeReceiver` is **not** mounted and no `sendNoteBridgeReady` fires; once `startupMode` flips to `"ready"`, the effect mounts the receiver and the ready ping fires exactly once.

### 8.2 Unit (main) — `tests/unit/mcp/session-note-bridge.test.ts`

- before `mcp:note:ready`, `append` / `read` reject `RendererNotReady` immediately (no IPC send, no 5 s wait).
- after `mcp:note:ready`, request gets replied → resolves with payload (and `appendedSection` is forwarded for `append`).
- after `mcp:note:goodbye`, a pending request rejects `RendererGone`; subsequent calls reject `RendererNotReady` until the next `ready`.
- no reply within 5 s → rejects `BridgeTimeout`.
- reply with unknown id → silently ignored (no throw, no resolve of unrelated request).
- `getWebContents()` returns null at request time → rejects `RendererNotReady`.
- `dispose()` rejects all pending with `BridgeDisposed`, removes all three `ipcMain` listeners (verify via `ipcMain.listenerCount`), and is idempotent (second call is a no-op).

### 8.3 Unit (MCP server) — `tests/unit/mcp/ai14all-mcp-server.test.ts`

- existing review tool tests retained (renamed from `tests/unit/review/review-mcp-server.test.ts`).
- `append_session_note` with unknown path → result JSON contains `{ ok: false, error: "no_worktree" }`.
- `append_session_note` happy path with stub bridge → returns `{ ok: true, appendedSection, note }` (verifies the server forwards `appendedSection` from the bridge reply unchanged).
- `read_session_note` happy path → returns `{ ok: true, note }`.
- bridge rejection mapping: `RendererNotReady` → `renderer_not_ready`, `BridgeTimeout` → `bridge_timeout`, `RendererGone` → `renderer_gone`, `BridgeDisposed` → `bridge_disposed`.

All MCP server tests connect via the `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` (same pattern as the existing `tests/unit/review/review-mcp-server.test.ts`). No raw `fetch` / `curl` against the endpoint — the Streamable HTTP protocol requires `initialize` + session header negotiation, which the SDK client handles for us.

### 8.4 E2E — `tests/e2e/mcp-session-note.test.ts`

- Boot the app, create a worktree session, open `NoteSheet`.
- Connect to the MCP server using the SDK's `StreamableHTTPClientTransport` (same pattern as the unit tests). The server URL is read via the existing `mcp-config.json` / liveness file path used by the review MCP tests.
- Wait for `rendererReady` (i.e., poll `read_session_note` until it stops returning `renderer_not_ready`, with a generous timeout) before exercising `append`.
- Call `append_session_note`, then assert the `NoteSheet` textarea content updates live without manual reload.
- Call `read_session_note` and assert the returned note matches the textarea content.

### 8.5 Manual smoke

- Open `NoteSheet`. From a Node REPL or a small script, connect with `StreamableHTTPClientTransport` (or use the MCP Inspector against the same URL), call `append_session_note`, and watch the textarea update live. `curl` is not sufficient because Streamable HTTP requires the SDK's `initialize` + session-header flow.

## 9. Out of scope / follow-ups

- Section delete / edit-by-title.
- Export note to a file.
- Auto-capture heuristics.
- Per-section metadata (tags, author).
