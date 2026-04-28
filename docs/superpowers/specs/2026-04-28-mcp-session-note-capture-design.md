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
  append(worktreeId: string, title: string, body: string): Promise<{ note: string }>;
  read(worktreeId: string): Promise<{ note: string }>;
}
```

Internal:
- `pending: Map<string, { resolve, reject, timer }>` keyed by `randomUUID()`.
- One `ipcMain.on("mcp:note:reply", …)` listener installed at construction.
- Per-request timeout: 5000 ms → reject `BridgeTimeout`.
- If `getWebContents()` returns null at request time → reject `RendererUnavailable`.
- Replies for unknown ids are dropped (defensive; never throw).

### 5.3 Preload additions

In `electron/preload/index.ts`, add to the existing exposed API:

- `onNoteBridgeRequest(handler: (req: NoteBridgeRequest) => void): () => void` — wraps `ipcRenderer.on("mcp:note:request", …)`, returns an unsubscribe.
- `sendNoteBridgeReply(reply: NoteBridgeReply): void` — `ipcRenderer.send("mcp:note:reply", reply)`.

`NoteBridgeRequest` / `NoteBridgeReply` types live in `shared/contracts/note-bridge.ts` (new) so both sides agree:

```ts
export type NoteBridgeRequest =
  | { id: string; op: "read"; worktreeId: string }
  | { id: string; op: "append"; worktreeId: string; title: string; body: string };

export type NoteBridgeReply =
  | { id: string; ok: true; note: string }
  | { id: string; ok: false; error: "no_session"; message: string };
```

### 5.4 New (renderer)

`src/features/workspace/note-bridge-receiver.ts`

```ts
export function installNoteBridgeReceiver(deps: {
  getState: () => WorkspaceState;
  dispatch: (action: WorkspaceAction) => void;
  api: NoteBridgeApi; // from preload
  now?: () => Date;  // injectable for tests
}): () => void;
```

Behaviour per request:

- **`op: "read"`**: find session with matching `worktreeId` in current state. If found, reply `{ ok: true, note }`. Else reply `{ ok: false, error: "no_session", message: "no session for worktreeId" }`.
- **`op: "append"`**: find session as above. If missing → `no_session`. Else compute new note (see 6.1), dispatch `{ type: "session/setNote", worktreeId, note: next }`, reply `{ ok: true, note: next }`.

Mounted once in `App.tsx` via `useEffect` after dispatch is available. Returns unsubscribe; call on unmount.

### 5.5 Wiring

- Wherever `ReviewMcpServer` is instantiated in main entry: also instantiate `SessionNoteBridge(getWebContents)` and pass it into `Ai14allMcpServer`.
- `getWebContents` resolves the main window's `webContents`, returning null until it exists.
- `App.tsx`: one effect calls `installNoteBridgeReceiver(...)`.

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
  - Success: `{ ok: true, appendedSection: "## {title} — {ts}", note: <newNote> }`
  - Failure: `{ ok: false, error: <code>, message: <human> }`

`read_session_note`

- Args (zod): `worktreePath: z.string().min(1)`.
- Description: "Read the current ai-14all session note. Useful before appending to avoid duplicates."
- Result content:
  - Success: `{ ok: true, note: string }`
  - Failure: `{ ok: false, error: <code>, message: <human> }`

### 6.3 Error matrix

| Failure | Detection | Result code |
|---|---|---|
| `worktreePath` not in any worktree | `resolver.resolve` returns null | `no_worktree` |
| WorktreeId has no session record | renderer can't find it | `no_session` |
| Renderer not mounted yet | `getWebContents()` null | `renderer_unavailable` |
| IPC reply timeout (5 s) | bridge timer fires | `bridge_timeout` |
| Empty title / body | zod | (SDK validation error) |

All non-validation errors are returned as JSON tool content with `ok: false`. The agent can choose to retry or surface to the user.

## 7. Edge cases

- **Concurrent appends from one agent.** Renderer reducer is single-threaded; sequential dispatches preserve order.
- **Renderer reload (Vite HMR / window reload) during in-flight request.** No reply arrives → 5 s timeout → `bridge_timeout`. Agent retries; subsequent calls work once renderer reattaches.
- **Body containing `## ` headings.** Allowed; no escaping. The user wrote it (via the agent), and the textarea is a freeform editor anyway.
- **Body with trailing newline.** Preserved verbatim; no trim.
- **Note size.** Unbounded, same as today. Existing textarea has no cap.
- **Multiple desktop windows.** Out of scope — app is single-window today. `getWebContents` returns the main window.

## 8. Testing

### 8.1 Unit (renderer) — `tests/unit/features/workspace/note-bridge-receiver.test.ts`

- append into empty note → exact `## title — 2026-04-28 14:32\n\nbody` shape (mock `now`).
- append into non-empty note → `prev + "\n\n" + section`.
- unknown `worktreeId` → reply `{ ok: false, error: "no_session" }`, no dispatch.
- read returns the current note.
- timestamp components zero-padded (single-digit month/day/hour/minute).

### 8.2 Unit (main) — `tests/unit/mcp/session-note-bridge.test.ts`

- request gets replied → resolves with payload.
- no reply within 5 s → rejects `BridgeTimeout`.
- reply with unknown id → silently ignored (no throw, no resolve of unrelated request).
- `getWebContents()` returns null → rejects `RendererUnavailable` immediately.

### 8.3 Unit (MCP server) — `tests/unit/mcp/ai14all-mcp-server.test.ts`

- existing review tool tests retained.
- `append_session_note` with unknown path → result JSON contains `{ ok: false, error: "no_worktree" }`.
- `append_session_note` happy path with stub bridge → returns `{ ok: true, appendedSection, note }`.
- `read_session_note` happy path → returns `{ ok: true, note }`.

### 8.4 E2E — `tests/e2e/mcp-session-note.test.ts`

- Boot app, create a worktree session.
- Hit the MCP HTTP endpoint with `append_session_note` (use the SDK client or raw fetch).
- Assert `NoteSheet` (open) shows the new section without manual reload.
- `read_session_note` returns the same content.

### 8.5 Manual smoke

- Open `NoteSheet`, run a `curl` against the MCP `append_session_note` tool, observe the textarea update live.

## 9. Out of scope / follow-ups

- Section delete / edit-by-title.
- Export note to a file.
- Auto-capture heuristics.
- Per-section metadata (tags, author).
