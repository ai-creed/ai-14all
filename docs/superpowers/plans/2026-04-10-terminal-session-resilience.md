# Terminal Session Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renderer reconnects to surviving backend PTY sessions after a page reload, so running agent sessions (Claude, Codex) are never lost.

**Architecture:** Five layers — (1) block Vite HMR full-page reloads in dev, (2) expose `listSessions()` from TerminalService through IPC/preload, (3) add `terminalSessionId` to the persist schema, (4) add `adoptSession()` to the useTerminalSession hook, (5) reconnect-first logic in `recreatePersistedProcesses`.

**Tech Stack:** Electron (main/preload/renderer), node-pty, React, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-terminal-session-resilience-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `services/terminals/terminal-service.ts` | Add `listSessions()` method |
| Modify | `shared/contracts/commands.ts` | Add `ListTerminalSessionsSchema`, extend API type |
| Modify | `electron/main/ipc.ts` | Add `terminals:list` IPC handler |
| Modify | `electron/preload/index.ts` | Add `list` to terminals preload bridge |
| Modify | `src/lib/desktop-client.ts` | Add `list` to terminals wrapper |
| Modify | `shared/models/persisted-workspace-state.ts` | Add `terminalSessionId` to `PersistedProcessSessionSchema` |
| Modify | `src/features/workspace/workspace-persistence.ts` | Include `terminalSessionId` in `buildWorkspaceSnapshot` |
| Modify | `src/features/terminals/useTerminalSession.ts` | Add `adoptSession()` method |
| Modify | `src/app/App.tsx` | Reconnect-first restore flow in `recreatePersistedProcesses` |
| Modify | `src/main.tsx` | Block HMR full-page reload |
| Modify | `docs/shared/architecture_decisions.md` | Note live terminal identity exception |
| Modify | `docs/shared/project_ai_14all_spike.md` | Scope PTY reattachment to renderer reloads |
| Modify | `docs/shared/high_level_plan.md` | Scope PTY reattachment to renderer reloads |
| Modify | `docs/superpowers/specs/2026-04-04-phase-5-persistence-and-restore-design.md` | Note reconnection-first extension |
| Test | `tests/unit/services/terminals/terminal-service.test.ts` | listSessions tests |
| Test | `tests/unit/workspace/workspace-persistence.test.ts` | terminalSessionId schema + snapshot tests |
| Test | `tests/unit/terminals/useTerminalSession.test.ts` | adoptSession tests (new file) |
| Test | `tests/unit/workspace/reconnect-restore.test.ts` | Reconnect-first restore logic tests (new file) |

---

### Task 1: TerminalService.listSessions()

**Files:**
- Test: `tests/unit/services/terminals/terminal-service.test.ts`
- Modify: `services/terminals/terminal-service.ts`

- [ ] **Step 1: Write failing tests for listSessions**

Add these tests to the existing `describe("TerminalService")` block in `tests/unit/services/terminals/terminal-service.test.ts`:

```typescript
it("listSessions returns all active sessions", () => {
	const pty = createPtyDouble();
	spawnMock.mockReturnValue(pty);

	const handlers = {
		onOutput: vi.fn(),
		onExit: vi.fn(),
		onState: vi.fn(),
		onError: vi.fn(),
	};
	const service = new TerminalService(handlers);

	const s1 = service.create("ws-a", "wt1", "/repo-a");
	const s2 = service.create("ws-a", "wt2", "/repo-a/wt2");

	const list = service.listSessions();
	expect(list).toHaveLength(2);
	expect(list.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
});

it("listSessions filters by workspaceId", () => {
	const pty = createPtyDouble();
	spawnMock.mockReturnValue(pty);

	const handlers = {
		onOutput: vi.fn(),
		onExit: vi.fn(),
		onState: vi.fn(),
		onError: vi.fn(),
	};
	const service = new TerminalService(handlers);

	service.create("ws-a", "wt1", "/repo-a");
	const s2 = service.create("ws-b", "wt1", "/repo-b");

	const list = service.listSessions("ws-b");
	expect(list).toHaveLength(1);
	expect(list[0].id).toBe(s2.id);
});

it("listSessions returns empty array after dispose", () => {
	const pty = createPtyDouble();
	spawnMock.mockReturnValue(pty);

	const handlers = {
		onOutput: vi.fn(),
		onExit: vi.fn(),
		onState: vi.fn(),
		onError: vi.fn(),
	};
	const service = new TerminalService(handlers);

	service.create("ws-a", "wt1", "/repo-a");
	service.dispose();

	expect(service.listSessions()).toEqual([]);
});

it("listSessions excludes exited sessions", () => {
	const pty = createPtyDouble();
	spawnMock.mockReturnValue(pty);

	const handlers = {
		onOutput: vi.fn(),
		onExit: vi.fn(),
		onState: vi.fn(),
		onError: vi.fn(),
	};
	const service = new TerminalService(handlers);

	const s1 = service.create("ws-a", "wt1", "/repo-a");
	service.create("ws-a", "wt2", "/repo-a/wt2");

	// Kill s1 — triggers onExit which removes from Map
	service.stop(s1.id);

	const list = service.listSessions();
	expect(list).toHaveLength(1);
	expect(list[0].id).not.toBe(s1.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/services/terminals/terminal-service.test.ts`
Expected: FAIL — `service.listSessions is not a function`

- [ ] **Step 3: Implement listSessions**

Add this method to `TerminalService` in `services/terminals/terminal-service.ts`, after the `create` method (after line 110):

```typescript
// -----------------------------------------------------------------------
// listSessions — pure read from the sessions Map
// -----------------------------------------------------------------------
listSessions(workspaceId?: string): TerminalSession[] {
	const all = [...this.sessions.values()].map((s) => s.meta);
	if (workspaceId !== undefined) {
		return all.filter((s) => s.workspaceId === workspaceId);
	}
	return all;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/terminals/terminal-service.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add services/terminals/terminal-service.ts tests/unit/services/terminals/terminal-service.test.ts
git commit -m "feat: add TerminalService.listSessions() for session enumeration"
```

---

### Task 2: IPC + Preload + Desktop Client for terminals:list

**Files:**
- Modify: `shared/contracts/commands.ts`
- Modify: `electron/main/ipc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/lib/desktop-client.ts`

No unit tests for this task — IPC plumbing is integration-level. Verified by Task 5's reconnect tests.

- [ ] **Step 1: Add Zod schema and API type**

In `shared/contracts/commands.ts`, add after `StopTerminalSessionSchema` (after line 60):

```typescript
export const ListTerminalSessionsSchema = z.object({
	workspaceId: z.string().optional(),
});
```

In the `Ai14AllDesktopApi` type, add `list` to the `terminals` namespace (after line 116, before `sendInput`):

```typescript
list(workspaceId?: string): Promise<TerminalSession[]>;
```

- [ ] **Step 2: Add IPC handler**

In `electron/main/ipc.ts`, add after the `terminals:create` handler (after line 153):

```typescript
ipcMain.handle("terminals:list", (_event, raw: unknown) => {
	const { workspaceId } = ListTerminalSessionsSchema.parse(raw);
	return terminalService.listSessions(workspaceId);
});
```

Add `ListTerminalSessionsSchema` to the imports from `../../shared/contracts/commands.js`.

- [ ] **Step 3: Add preload bridge method**

In `electron/preload/index.ts`, add inside the `terminals` object (after line 45, before `sendInput`):

```typescript
list(workspaceId?) {
	return ipcRenderer.invoke("terminals:list", { workspaceId });
},
```

- [ ] **Step 4: Add desktop client wrapper**

In `src/lib/desktop-client.ts`, add inside the `terminals` export (after line 27, before `sendInput`):

```typescript
list: (workspaceId?) =>
	getDesktopClient().terminals.list(workspaceId),
```

- [ ] **Step 5: Commit**

```bash
git add shared/contracts/commands.ts electron/main/ipc.ts electron/preload/index.ts src/lib/desktop-client.ts
git commit -m "feat: wire terminals:list through IPC, preload, and desktop client"
```

---

### Task 3: Persist terminalSessionId in schema and snapshot

**Files:**
- Test: `tests/unit/workspace/workspace-persistence.test.ts`
- Modify: `shared/models/persisted-workspace-state.ts`
- Modify: `src/features/workspace/workspace-persistence.ts`

- [ ] **Step 1: Write failing tests for schema parsing and snapshot serialization**

Add these tests to `tests/unit/workspace/workspace-persistence.test.ts`:

```typescript
it("defaults terminalSessionId to null for older snapshots without it", () => {
	const parsed = PersistedWorkspaceStateSchema.parse({
		version: 1,
		restorePreference: "prompt",
		snapshot: {
			repositoryPath: "/repo",
			selectedWorktreeId: "main",
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "main",
					note: "",
					reviewMode: "files",
					viewerMode: "file",
					selectedFilePath: null,
					selectedChangedFilePath: null,
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [
						{
							id: "p1",
							origin: "adHoc",
							presetId: null,
							label: "shell 1",
							command: null,
							pinned: false,
						},
					],
				},
			],
		},
	});

	expect(parsed.snapshot?.worktreeSessions[0]?.processSessions[0]?.terminalSessionId).toBeNull();
});

it("preserves terminalSessionId when present in persisted data", () => {
	const parsed = PersistedWorkspaceStateSchema.parse({
		version: 2,
		restorePreference: "prompt",
		activeWorkspaceId: "ws-a",
		workspaceOrder: ["ws-a"],
		workspaces: [
			{
				workspaceId: "ws-a",
				repositoryPath: "/repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/repo",
					selectedWorktreeId: "main",
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: "main",
							note: "",
							reviewMode: "files",
							viewerMode: "file",
							selectedFilePath: null,
							selectedChangedFilePath: null,
							activeProcessSessionId: "p1",
							nextAdHocNumber: 2,
							processSessions: [
								{
									id: "p1",
									origin: "adHoc",
									presetId: null,
									label: "shell 1",
									command: "claude",
									pinned: false,
									terminalSessionId: "term-abc",
								},
							],
						},
					],
				},
			},
		],
	});

	expect(parsed.workspaces[0].snapshot.worktreeSessions[0].processSessions[0].terminalSessionId).toBe("term-abc");
});

it("includes terminalSessionId in buildWorkspaceSnapshot output", () => {
	let state = createWorkspaceState([
		{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
	]);
	state = workspaceReducer(state, {
		type: "session/registerProcess",
		worktreeId: "main",
		process: {
			id: "process-1",
			worktreeId: "main",
			terminalSessionId: "terminal-live-123",
			origin: "adHoc",
			presetId: null,
			label: "shell 1",
			command: "claude",
			status: "running",
			lastActivityAt: 1234,
			exitCode: null,
			pinned: false,
			attentionState: "idle",
		},
	});

	const snapshot = buildWorkspaceSnapshot("/repo", null, state);

	expect(snapshot.worktreeSessions[0].processSessions[0].terminalSessionId).toBe("terminal-live-123");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/workspace/workspace-persistence.test.ts`
Expected: FAIL — `terminalSessionId` not recognized in schema / not present in output

- [ ] **Step 3: Add terminalSessionId to PersistedProcessSessionSchema**

In `shared/models/persisted-workspace-state.ts`, modify `PersistedProcessSessionSchema` (lines 9-16). Add after `pinned: z.boolean()`:

```typescript
terminalSessionId: z.string().nullable().optional().default(null),
```

The full schema becomes:
```typescript
export const PersistedProcessSessionSchema = z.object({
	id: z.string(),
	origin: z.enum(["adHoc", "preset"]),
	presetId: z.string().nullable(),
	label: z.string(),
	command: z.string().nullable(),
	pinned: z.boolean(),
	terminalSessionId: z.string().nullable().optional().default(null),
});
```

- [ ] **Step 4: Include terminalSessionId in buildWorkspaceSnapshot**

In `src/features/workspace/workspace-persistence.ts`, inside `buildWorkspaceSnapshot` (line 82-89), update the `.map<PersistedProcessSession>()` to include `terminalSessionId`:

Change:
```typescript
.map<PersistedProcessSession>((process) => ({
	id: process.id,
	origin: process.origin,
	presetId: process.presetId,
	label: process.label,
	command: process.command,
	pinned: process.pinned,
})),
```

To:
```typescript
.map<PersistedProcessSession>((process) => ({
	id: process.id,
	origin: process.origin,
	presetId: process.presetId,
	label: process.label,
	command: process.command,
	pinned: process.pinned,
	terminalSessionId: process.terminalSessionId,
})),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace/workspace-persistence.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add shared/models/persisted-workspace-state.ts src/features/workspace/workspace-persistence.ts tests/unit/workspace/workspace-persistence.test.ts
git commit -m "feat: persist terminalSessionId for session reconnection"
```

---

### Task 4: useTerminalSession.adoptSession()

**Files:**
- Create: `tests/unit/terminals/useTerminalSession.test.ts`
- Modify: `src/features/terminals/useTerminalSession.ts`

- [ ] **Step 1: Write failing tests for adoptSession**

Create `tests/unit/terminals/useTerminalSession.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../src/lib/desktop-client", () => ({
	terminals: {
		create: vi.fn(),
		sendInput: vi.fn(),
		resize: vi.fn(),
		stop: vi.fn(),
		list: vi.fn(),
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
}));

import { useTerminalSession } from "../../src/features/terminals/useTerminalSession";
import type { TerminalSession } from "../../shared/models/terminal-session";

describe("useTerminalSession.adoptSession", () => {
	it("adds session to list without calling terminals.create", async () => {
		const { terminals } = await import("../../src/lib/desktop-client");

		const { result } = renderHook(() => useTerminalSession());

		const existingSession: TerminalSession = {
			id: "existing-term-1",
			workspaceId: "ws-a",
			worktreeId: "wt1",
			cwd: "/repo",
			status: "running",
			exitCode: null,
		};

		act(() => {
			result.current.adoptSession(existingSession);
		});

		expect(result.current.sessions).toHaveLength(1);
		expect(result.current.sessions[0].id).toBe("existing-term-1");
		expect(terminals.create).not.toHaveBeenCalled();
	});

	it("adopted session receives state updates from backend events", async () => {
		const { terminals } = await import("../../src/lib/desktop-client");

		// Capture the onState listener
		let stateListener: ((event: { sessionId: string; status: string }) => void) | null = null;
		vi.mocked(terminals.onState).mockImplementation((listener) => {
			stateListener = listener as typeof stateListener;
			return vi.fn();
		});

		const { result } = renderHook(() => useTerminalSession());

		const existingSession: TerminalSession = {
			id: "existing-term-2",
			workspaceId: "ws-a",
			worktreeId: "wt1",
			cwd: "/repo",
			status: "running",
			exitCode: null,
		};

		act(() => {
			result.current.adoptSession(existingSession);
		});

		// Simulate a state event from backend
		act(() => {
			stateListener?.({ sessionId: "existing-term-2", status: "exited" });
		});

		expect(result.current.sessions[0].status).toBe("exited");
	});

	it("does not duplicate session if adopted twice with same id", () => {
		const { result } = renderHook(() => useTerminalSession());

		const existingSession: TerminalSession = {
			id: "dup-term",
			workspaceId: "ws-a",
			worktreeId: "wt1",
			cwd: "/repo",
			status: "running",
			exitCode: null,
		};

		act(() => {
			result.current.adoptSession(existingSession);
		});
		act(() => {
			result.current.adoptSession(existingSession);
		});

		expect(result.current.sessions).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/terminals/useTerminalSession.test.ts`
Expected: FAIL — `result.current.adoptSession is not a function`

- [ ] **Step 3: Implement adoptSession**

In `src/features/terminals/useTerminalSession.ts`:

Add `adoptSession` to the `UseTerminalSessionResult` type (after line 23, before the closing `}`):

```typescript
adoptSession: (session: TerminalSession) => void;
```

Add the implementation after `removeSession` (after line 92):

```typescript
const adoptSession = useCallback((session: TerminalSession) => {
	setSessions((prev) => {
		if (prev.some((s) => s.id === session.id)) return prev;
		return [...prev, session];
	});
}, []);
```

Update the return statement (line 98) to include `adoptSession`:

```typescript
return { sessions, createSession, stopSession, removeSession, sendInput, adoptSession };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/terminals/useTerminalSession.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/terminals/useTerminalSession.ts tests/unit/terminals/useTerminalSession.test.ts
git commit -m "feat: add adoptSession() to useTerminalSession for PTY reconnection"
```

---

### Task 5: Reconnect-first restore in recreatePersistedProcesses

**Files:**
- Modify: `src/app/App.tsx` (lines 720-753)

This task modifies `recreatePersistedProcesses` to try reconnection before fresh creation. The function currently always calls `createSession()` — it needs to first call `terminals.list()`, match by `terminalSessionId`, and call `adoptSession()` for live sessions.

- [ ] **Step 1: Update App.tsx destructuring to include adoptSession and list**

In `src/app/App.tsx`, where `useTerminalSession` is destructured (around line 311), add `adoptSession`:

```typescript
const { sessions, createSession, sendInput, stopSession, removeSession, adoptSession } = useTerminalSession({
```

Add an import for `terminals` from desktop-client if not already present (it is used in the hook, but `list` needs to be called directly in `recreatePersistedProcesses`). Add near the top imports:

```typescript
import { terminals } from "../lib/desktop-client";
```

(Check if this import already exists — if `terminals` is imported via `useTerminalSession`, it may not be directly available in App.tsx. The `list` call needs `terminals.list()` from the desktop client.)

- [ ] **Step 2: Modify recreatePersistedProcesses**

Replace the `recreatePersistedProcesses` function (lines 720-753) with:

```typescript
async function recreatePersistedProcesses(
	worktree: Worktree,
	sessionSnapshot: PersistedWorktreeSession,
	targetWorkspaceId: string,
	dispatchFn: (action: WorkspaceAction) => void = dispatch,
) {
	// Fetch live backend sessions once for reconnection matching
	let liveSessions: Map<string, TerminalSession> = new Map();
	try {
		const list = await terminals.list(targetWorkspaceId);
		liveSessions = new Map(list.map((s) => [s.id, s]));
	} catch {
		// Backend unreachable — fall through to fresh creation for all
	}

	for (const process of sessionSnapshot.processSessions) {
		try {
			// Try reconnect: match persisted terminalSessionId to a live backend session
			const liveSession = process.terminalSessionId
				? liveSessions.get(process.terminalSessionId)
				: undefined;

			if (liveSession) {
				// Reconnect — adopt existing PTY without creating a new one
				adoptSession(liveSession);
				dispatchFn({
					type: "session/replaceProcessTerminal",
					processId: process.id,
					terminalSessionId: liveSession.id,
				});
				dispatchFn({
					type: "session/updateProcessStatus",
					processId: process.id,
					status: liveSession.status === "running" ? "running" : "exited",
					exitCode: liveSession.exitCode,
				});
			} else {
				// Fresh creation — no live session found
				const terminal = await createSession(targetWorkspaceId, worktree.id, worktree.path);
				dispatchFn({
					type: "session/replaceProcessTerminal",
					processId: process.id,
					terminalSessionId: terminal.id,
				});
				dispatchFn({
					type: "session/updateProcessStatus",
					processId: process.id,
					status: "running",
					exitCode: null,
				});

				if (process.command) {
					await sendInput(terminal.id, `${process.command}\n`);
				}
			}
		} catch {
			dispatchFn({
				type: "session/updateProcessStatus",
				processId: process.id,
				status: "error",
				exitCode: null,
			});
		}
	}
}
```

- [ ] **Step 3: Add TerminalSession import if needed**

Ensure `TerminalSession` type is imported in App.tsx. Check existing imports — if not present, add:

```typescript
import type { TerminalSession } from "../../shared/models/terminal-session";
```

- [ ] **Step 4: Verify the app builds**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat: reconnect-first restore in recreatePersistedProcesses"
```

---

### Task 6: Block Vite HMR full-page reloads

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Add HMR reload blocker**

In `src/main.tsx`, add before the `createRoot` call (after line 4, before line 6):

```typescript
if (import.meta.hot) {
	import.meta.hot.on("vite:beforeFullReload", () => {
		console.warn("[HMR] Full page reload blocked to preserve terminal sessions.");
		throw "[HMR] Blocked";
	});
}
```

The full file becomes:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import "./app/shell.css";

if (import.meta.hot) {
	import.meta.hot.on("vite:beforeFullReload", () => {
		console.warn("[HMR] Full page reload blocked to preserve terminal sessions.");
		throw "[HMR] Blocked";
	});
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
```

No unit test — `import.meta.hot` is tree-shaken in production and is a Vite runtime API. Verified by manual testing (spec item 10).

- [ ] **Step 2: Commit**

```bash
git add src/main.tsx
git commit -m "feat: block Vite HMR full-page reloads to preserve terminal sessions"
```

---

### Task 7: Update superseded documentation

**Files:**
- Modify: `docs/shared/architecture_decisions.md`
- Modify: `docs/shared/project_ai_14all_spike.md`
- Modify: `docs/shared/high_level_plan.md`
- Modify: `docs/superpowers/specs/2026-04-04-phase-5-persistence-and-restore-design.md`

- [ ] **Step 1: Update architecture_decisions.md**

Find the section near line 184 about persisting UI context. Add a note:

```markdown
> **Update (2026-04-10):** The terminal session resilience spec (`docs/superpowers/specs/2026-04-10-terminal-session-resilience-design.md`) adds live terminal identity to persisted state for renderer-reload reconnection. Fresh-creation remains the fallback when no live PTY exists. This does not change the cold-start behavior.
```

- [ ] **Step 2: Update project_ai_14all_spike.md**

After line 198 ("V1 does not need true live PTY reattachment."), add:

```markdown
> **Update (2026-04-10):** Live PTY reattachment is now supported for renderer reloads while the main process is running. The original statement remains true for cold starts (app closed and reopened). See `docs/superpowers/specs/2026-04-10-terminal-session-resilience-design.md`.
```

- [ ] **Step 3: Update high_level_plan.md**

After line 199 ("V1 should restore context, not true live PTY attachment."), add:

```markdown
> **Update (2026-04-10):** Live PTY reattachment is now supported for renderer reloads with a surviving main process. The original statement holds for cross-session restores. See `docs/superpowers/specs/2026-04-10-terminal-session-resilience-design.md`.
```

- [ ] **Step 4: Update phase-5 persistence spec**

Find the relevant sections (lines 9, 67, 134) about recreating fresh shells. Add a note at the top of the spec:

```markdown
> **Update (2026-04-10):** The terminal session resilience spec extends this restore contract to attempt live PTY reconnection before fresh creation. The original fresh-creation contract holds for cold starts and cross-session restores. See `docs/superpowers/specs/2026-04-10-terminal-session-resilience-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/shared/architecture_decisions.md docs/shared/project_ai_14all_spike.md docs/shared/high_level_plan.md docs/superpowers/specs/2026-04-04-phase-5-persistence-and-restore-design.md
git commit -m "docs: annotate superseded PTY reattachment decisions"
```

---

### Task 8: Manual verification

Not automated — run manually in dev mode.

- [ ] **Step 1: Verify HMR block**

1. Start dev: `npm run dev`
2. Open terminal, run a command (e.g. `echo "hello"`)
3. Make a change to a source file that would trigger full reload
4. Verify console shows `[HMR] Full page reload blocked` and terminal is still active

- [ ] **Step 2: Verify reconnection after manual reload**

1. Start dev: `npm run dev`
2. Open terminal, start an agent (e.g. `claude`)
3. Press Cmd+R to force reload
4. Verify terminal reconnects — ongoing output from agent flows to the reconnected terminal
5. Verify can send input to reconnected terminal

- [ ] **Step 3: Verify fresh creation fallback**

1. Quit and restart app (cold start)
2. Verify terminals are recreated fresh (not reconnected)
3. Verify commands from persisted state are re-executed
