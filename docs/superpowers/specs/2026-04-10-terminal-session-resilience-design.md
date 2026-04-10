# Terminal Session Resilience Design

**Date:** 2026-04-10
**Status:** Approved
**Problem:** Renderer page reloads (Vite HMR in dev, potential renderer crashes in production) destroy all in-memory React state. Running terminal sessions (PTYs) survive in the Electron main process but the renderer loses all references. Agent sessions (Claude, Codex) running inside those terminals are effectively lost.

## Goals

1. Renderer can reconnect to existing backend PTY sessions after a page reload
2. Running agent sessions survive renderer reloads without re-prompting
3. Dev-mode Vite HMR full-page reloads are blocked to prevent unnecessary disruption
4. Backwards compatible with existing persisted workspace state

## Non-Goals

- Terminal scrollback replay (reconnected terminal starts blank; new output flows normally)
- Surviving main process crashes (PTYs die with the main process regardless)
- Persisting session registry to disk (in-memory Map is sufficient)

## Supersedes

This spec intentionally changes the restore contract from "fresh shells only" to live PTY reattachment. The following prior decisions are superseded for the reconnection path:

- `docs/shared/architecture_decisions.md:184` — early phases persist UI context, not live process state. This spec adds live terminal identity to persisted state specifically for reconnection. Fresh-creation remains the fallback when no live PTY exists.
- `docs/superpowers/specs/2026-04-04-phase-5-persistence-and-restore-design.md` (lines 9, 67, 134) — restore defined as recreating fresh shells. This spec extends restore to attempt reconnection first, falling back to fresh creation. The original contract holds for cold starts and cross-session restores.
- `docs/shared/project_ai_14all_spike.md:198` — "V1 does not need true live PTY reattachment." This spec adds live PTY reattachment for renderer reloads while the main process is still running. The original statement remains true for cold starts (app closed and reopened).
- `docs/shared/high_level_plan.md:199` — "V1 should restore context, not true live PTY attachment." Same scoping as above: live reattachment applies only to renderer reloads with a surviving main process, not to cross-session restores.

These docs must be updated as part of the implementation work.

## Architecture

### Layer 1: Dev-mode HMR reload prevention

In the renderer entry point, intercept Vite's full-reload event:

```typescript
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    console.warn('[HMR] Full page reload blocked to preserve terminal sessions.');
    throw '[HMR] Blocked';
  });
}
```

`import.meta.hot` is tree-shaken in production builds. User can still manually reload with Cmd+R.

### Layer 2: Backend session listing

**TerminalService** gets one new public method:

```typescript
listSessions(workspaceId?: string): TerminalSession[]
```

Pure read from the existing private `sessions` Map. Returns `meta` from all entries. Optional `workspaceId` filter. No new state.

**IPC** gets one new handler:

```
terminals:list(workspaceId?: string) -> TerminalSession[]
```

**Preload bridge** adds `list` to the `terminals` namespace.

No changes to existing methods.

### Layer 3: Persist terminal session IDs

`PersistedProcessSessionSchema` gets one new optional field:

```typescript
terminalSessionId: z.string().nullable().optional().default(null)
```

Backwards compatible — old snapshots parse as `null`. No schema version bump or migration needed.

`buildSavedWorkspace` in App.tsx includes `terminalSessionId` from the live `ProcessSession` in the persisted output.

### Layer 4: Renderer session bootstrap

The renderer tracks live terminal sessions in two places:
1. **`useTerminalSession` hook** — owns the `sessions: TerminalSession[]` array, currently only populated by `createSession()` which calls `terminals.create()`.
2. **`workspaceState.processSessionsById`** — maps process IDs to `ProcessSession` records that reference `terminalSessionId`.

For reconnection, both must be populated without calling `terminals.create()`.

**`useTerminalSession`** gets a new method:

```typescript
adoptSession(session: TerminalSession): void
```

Adds an existing `TerminalSession` to the `sessions` array without creating a new PTY. This is the renderer-side equivalent of "I know this session exists in the backend, start tracking it."

This ensures:
- `TerminalPane` mounts for the adopted session (App.tsx uses `sessions` to determine which terminals to render)
- Close/restart flows work (App.tsx:1381 looks up `sessions.find(...)` to check liveness before stopping)
- The empty-state path (App.tsx:1855) is avoided because `sessions.some(...)` finds the adopted session

### Layer 5: Reconnect-first restore flow

`recreatePersistedProcesses` changes from "always create new" to "try reconnect, fall back to create":

```
1. Call terminals.list(workspaceId) once at start — cache result as Map<sessionId, TerminalSession>
2. For each persisted process session:
   a. Has terminalSessionId AND session found in cached list?
      -> YES: Call adoptSession(cachedSession) to register in renderer session list.
              Dispatch process session with existing terminalSessionId.
              TerminalPane mounts, subscribes to output events for that ID.
              Ongoing PTY output flows naturally.
      -> NO:  Fall through to (b)
   b. Has command?
      -> YES: Create new PTY via createSession(), re-run command (current behavior)
      -> NO:  Create new PTY via createSession(), leave idle (current behavior)
```

## Error Handling

- **`listSessions()` is a pure Map read** — cannot fail. Returns empty array if no sessions.
- **Reconnect attempt fails (session died between persist and reload):** Fall back to fresh creation. No error surfaced to user.
- **`terminals.list()` IPC call fails (backend unreachable):** Catch, log warning, fall back to full fresh creation for all processes. Startup never blocked.
- **PTY exits during renderer reload (race):** After reconnection, `terminals.onExit` listener picks up exit events normally. If exit happened in the gap, `terminals.list()` won't include that session — falls through to fresh creation.
- **Stale `terminalSessionId` from previous app run:** Backend Map is empty on fresh app start — `listSessions` returns `[]` — all sessions fall through to fresh creation. Harmless.

## Files Changed

| Component | File | Change |
|-----------|------|--------|
| HMR block | `src/main.tsx` (or renderer entry) | Add `import.meta.hot` handler |
| TerminalService | `services/terminals/terminal-service.ts` | Add `listSessions()` method |
| IPC handlers | `electron/main/ipc.ts` | Add `terminals:list` handler |
| Command contracts | `shared/contracts/commands.ts` | Add `ListTerminalSessionsSchema` |
| API type | `shared/contracts/commands.ts` | Add `list` to terminals API type |
| Preload bridge | `electron/preload/index.ts` | Add `list` to terminals namespace |
| Persist schema | `shared/models/persisted-workspace-state.ts` | Add `terminalSessionId` to `PersistedProcessSessionSchema` |
| Save logic | `src/app/App.tsx` (`buildSavedWorkspace`) | Include `terminalSessionId` in persisted output |
| Restore logic | `src/app/App.tsx` (`recreatePersistedProcesses`) | Try reconnect before create, call `adoptSession` |
| Terminal hook | `src/features/terminals/useTerminalSession.ts` | Add `adoptSession()` method |
| Desktop client | `src/lib/desktop-client.ts` | Add `list` to terminals wrapper |
| Architecture docs | `docs/shared/architecture_decisions.md` | Note live terminal identity exception |
| Phase 5 spec | `docs/superpowers/specs/2026-04-04-phase-5-persistence-and-restore-design.md` | Note reconnection-first extension |
| Spike doc | `docs/shared/project_ai_14all_spike.md` | Scope live PTY reattachment to renderer reloads |
| High-level plan | `docs/shared/high_level_plan.md` | Scope live PTY reattachment to renderer reloads |

## Testing

### Unit tests

1. `TerminalService.listSessions()` — returns active sessions, filters by workspaceId, returns empty after dispose, excludes exited sessions
2. `PersistedProcessSessionSchema` — parses with and without `terminalSessionId`, defaults to null for old snapshots
3. `useTerminalSession.adoptSession()` — adds session to list without calling `terminals.create`, adopted session participates in state/exit/error event updates
4. Reconnect logic — reconnects when session alive, falls back when dead, falls back when `terminalSessionId` null, handles `list()` failure gracefully

### Integration tests (existing App test files)

5. App restore with reconnectable sessions — mock `terminals.list` returning active session, verify `adoptSession` called (not `terminals.create`), verify `TerminalPane` mounts for adopted session
6. App restore with dead sessions — mock `terminals.list` returning empty, verify `terminals.create` called with original command
7. Close/restart adopted session — verify `sessions.find()` finds adopted session, stop works normally

### E2E tests (Playwright)

8. Terminal survives renderer reload — start a terminal, trigger renderer reload (or simulate via test harness), verify terminal is still interactive (send input, receive output) after reload

### Manual verification

9. Dev mode: run agent in terminal, switch to another app, wait, switch back — terminal still active with live output
10. Dev mode: trigger HMR reload — terminal survives, no full page reload
