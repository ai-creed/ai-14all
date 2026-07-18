import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalRuntime } from "../../../src/app/hooks/use-terminal-runtime";
import {
	createWorkspaceState,
	workspaceReducer,
	type WorkspaceAction,
	type WorkspaceState,
} from "../../../src/features/workspace/logic/workspace-state";
import type { AppWorkspacesState } from "../../../src/features/workspace/logic/app-workspaces-state";
import type { AppWorkspace } from "../../../shared/models/app-workspace";
import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessSession } from "../../../shared/models/process-session";

// Capture the wrapper callbacks that useTerminalSession registers against the
// desktop-client terminal-event subscriptions, so the tests can fire real
// PTY exit/error/output events straight into the live hook.
const { captured } = vi.hoisted(() => ({
	captured: {} as {
		onOutput?: (event: { sessionId: string; data: string }) => void;
		onExit?: (event: { sessionId: string; exitCode: number | null }) => void;
		onError?: (event: { sessionId: string }) => void;
		onState?: (event: { sessionId: string; status: string }) => void;
	},
}));

vi.mock("../../../src/lib/desktop-client", () => ({
	terminals: {
		onOutput: (cb: (event: { sessionId: string; data: string }) => void) => {
			captured.onOutput = cb;
			return () => {};
		},
		onExit: (
			cb: (event: { sessionId: string; exitCode: number | null }) => void,
		) => {
			captured.onExit = cb;
			return () => {};
		},
		onError: (cb: (event: { sessionId: string }) => void) => {
			captured.onError = cb;
			return () => {};
		},
		onState: (cb: (event: { sessionId: string; status: string }) => void) => {
			captured.onState = cb;
			return () => {};
		},
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
		logAttentionEvent: vi.fn(() => Promise.resolve()),
	},
}));

vi.mock("../../../src/features/terminals/logic/replay-buffer", () => ({
	recordReplayOutput: vi.fn(),
	clearReplayOutput: vi.fn(),
	getReplayOutput: vi.fn(() => ""),
}));

const worktree = {
	id: "wt",
	repositoryId: "repo-1",
	branchName: "wt",
	path: "/repo",
	label: "wt",
	isMain: true,
} as unknown as Worktree;

/**
 * Builds the stale-event race: a detected agent process P whose ref snapshot
 * still maps to the OLD terminal session "S1" (findProcessByTerminalSessionId
 * resolves ownership from this lagging ref). In truth P has been rebound to a
 * fresh "S2" and is running, but the OLD S1's delayed exit/error arrives first
 * and resolves against the stale P→S1 mapping. Every action the runtime emits
 * must therefore be pinned to S1 so the reducer can drop it.
 */
function renderRuntime() {
	let wsState = createWorkspaceState([worktree]);
	wsState = workspaceReducer(wsState, {
		type: "session/registerProcess",
		worktreeId: "wt",
		process: {
			id: "P",
			workspaceId: "ws",
			worktreeId: "wt",
			terminalSessionId: "S1",
			origin: "adHoc",
			presetId: null,
			label: "claude",
			command: "claude",
			status: "running",
			lastActivityAt: null,
			lastOutputPreview: null,
			exitCode: null,
			pinned: false,
			attentionState: "idle",
			agentAttentionReasons: {},
			agentAttentionClearedAt: null,
			agentDetected: true,
			provider: null,
			resumeCommand: null,
			resumePending: false,
		} as ProcessSession,
	});

	const appWorkspacesRef = {
		current: {
			activeWorkspaceId: "ws",
			workspaceOrder: ["ws"],
			workspacesById: {
				ws: {
					workspaceId: "ws",
					workspaceState: wsState,
				} as unknown as AppWorkspace,
			},
		} as AppWorkspacesState,
	};

	const dispatch = vi.fn();
	const dispatchAppWorkspaces = vi.fn();
	const options = {
		appWorkspacesRef,
		inactiveWorkspaceStatesRef: {
			current: new Map<string, WorkspaceState>(),
		},
		dispatch,
		dispatchAppWorkspaces: dispatchAppWorkspaces as never,
		getVisibleProcessIds: () => [] as readonly string[],
		getActiveWorktreeId: () => null,
	};

	renderHook(() => useTerminalRuntime(options));

	const dispatchedOfType = (type: WorkspaceAction["type"]) =>
		dispatch.mock.calls
			.map((c) => c[0] as WorkspaceAction)
			.filter((a) => a.type === type);

	return { dispatch, dispatchedOfType };
}

describe("useTerminalRuntime — lifecycle attention pinned to the originating session", () => {
	beforeEach(() => {
		captured.onOutput = undefined;
		captured.onExit = undefined;
		captured.onError = undefined;
		captured.onState = undefined;
		vi.clearAllMocks();
	});

	it("pins the status AND the failed lifecycle attention to S1 on a non-zero exit", () => {
		const { dispatchedOfType } = renderRuntime();

		act(() => {
			captured.onExit?.({ sessionId: "S1", exitCode: 1 });
		});

		const statusActions = dispatchedOfType("session/updateProcessStatus");
		const attentionActions = dispatchedOfType(
			"session/reportProcessAgentAttention",
		);
		expect(statusActions.length).toBeGreaterThan(0);
		expect(attentionActions.length).toBeGreaterThan(0);
		// The dispatched failed lifecycle report is the newly-restarted agent's
		// stale twin — it must carry the pin so the reducer drops it.
		expect(attentionActions[0]).toMatchObject({
			reason: expect.objectContaining({ state: "failed", source: "lifecycle" }),
			onlyIfTerminalSessionId: "S1",
		});
		// Every status + lifecycle action the runtime emitted is pinned to S1.
		for (const a of [...statusActions, ...attentionActions]) {
			expect(a).toHaveProperty("onlyIfTerminalSessionId", "S1");
		}
	});

	it("pins the status AND the failed lifecycle attention to S1 on a terminal error", () => {
		const { dispatchedOfType } = renderRuntime();

		act(() => {
			captured.onError?.({ sessionId: "S1" });
		});

		const statusActions = dispatchedOfType("session/updateProcessStatus");
		const attentionActions = dispatchedOfType(
			"session/reportProcessAgentAttention",
		);
		expect(statusActions.length).toBeGreaterThan(0);
		expect(attentionActions.length).toBeGreaterThan(0);
		expect(attentionActions[0]).toMatchObject({
			reason: expect.objectContaining({ state: "failed", source: "lifecycle" }),
			onlyIfTerminalSessionId: "S1",
		});
		for (const a of [...statusActions, ...attentionActions]) {
			expect(a).toHaveProperty("onlyIfTerminalSessionId", "S1");
		}
	});

	it("pins the ready-promotion lifecycle attention to S1 on a clean exit after a ready signal", () => {
		const { dispatchedOfType } = renderRuntime();

		// A terminal "ready" verdict is recorded synchronously for S1 first ...
		act(() => {
			captured.onOutput?.({ sessionId: "S1", data: "ready for review" });
		});
		// ... then the OLD session exits cleanly, promoting terminal ready to a
		// lifecycle reason that must also be pinned to its originating session.
		act(() => {
			captured.onExit?.({ sessionId: "S1", exitCode: 0 });
		});

		const attentionActions = dispatchedOfType(
			"session/reportProcessAgentAttention",
		);
		const readyLifecycle = attentionActions.find(
			(a) =>
				a.type === "session/reportProcessAgentAttention" &&
				a.reason.source === "lifecycle" &&
				a.reason.state === "ready",
		);
		expect(readyLifecycle).toBeDefined();
		expect(readyLifecycle).toHaveProperty("onlyIfTerminalSessionId", "S1");
		for (const a of attentionActions) {
			expect(a).toHaveProperty("onlyIfTerminalSessionId", "S1");
		}
	});
});
