import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFloatingShellActions } from "../../../src/app/hooks/use-floating-shell-actions";
import { createWorkspaceState } from "../../../src/features/workspace/logic/workspace-state";
import { clearReplayOutput } from "../../../src/features/terminals/logic/replay-buffer";
import { notifyToast } from "../../../src/features/ui/toast/ToastProvider";
import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";

// Mock the replay buffer so we can assert the dismissal-time free precisely.
vi.mock("../../../src/features/terminals/logic/replay-buffer", () => ({
	clearReplayOutput: vi.fn(),
	recordReplayOutput: vi.fn(),
	getReplayOutput: vi.fn(() => ""),
}));

// Mock the toast module so we can assert the cap hint precisely.
vi.mock("../../../src/features/ui/toast/ToastProvider", () => ({
	notifyToast: vi.fn(),
}));

const worktree = { id: "a", path: "/repo/a", branch: "a", isPrimary: false } as unknown as Worktree;

const proc = (id: string, terminalSessionId: string): ProcessSession =>
	({ id, terminalSessionId, origin: "adHoc", worktreeId: "a" }) as ProcessSession;

const term = (
	id: string,
	status: TerminalSession["status"],
): TerminalSession =>
	({ id, workspaceId: "ws", worktreeId: "a", cwd: "/repo/a", status, exitCode: null }) as TerminalSession;

/** Build options with a single floating shell `px` (terminal `t-x`) present. */
function makeCloseOptions(termStatus: TerminalSession["status"]) {
	const state = createWorkspaceState([worktree]);
	state.sessionsByWorktreeId.a.floatingShellIds = ["px"];
	state.processSessionsById.px = proc("px", "t-x");
	const dispatch = vi.fn();
	const stopSession = vi.fn(async () => {});
	const removeSession = vi.fn();
	return {
		options: {
			workspaceId: "ws",
			worktree,
			workspaceStateRef: { current: state },
			outputPreviewBuffersRef: { current: new Map<string, string>() },
			getWorkspaceStateById: (id: string) => (id === "ws" ? state : null),
			createScopedWorkspaceDispatch: () => dispatch,
			sessions: [term("t-x", termStatus)],
			spawnAdHocProcess: vi.fn(),
			stopSession,
			removeSession,
		},
		dispatch,
		stopSession,
		removeSession,
	};
}

function makeOptions(floatingCount: number) {
	const state = createWorkspaceState([worktree]);
	state.sessionsByWorktreeId.a.floatingShellIds = Array.from(
		{ length: floatingCount },
		(_, i) => `existing-${i}`,
	);
	// Default dispatch SIMULATES the reducer accepting the registration: it pushes
	// the new process id into floatingShellIds so the hook's post-dispatch verify
	// (which reads getWorkspaceStateById) sees the process and skips teardown.
	const dispatch = vi.fn((action: { type: string; process?: ProcessSession }) => {
		if (action.type === "session/registerFloatingShell" && action.process) {
			state.sessionsByWorktreeId.a.floatingShellIds.push(action.process.id);
		}
	});
	const spawnAdHocProcess = vi.fn(
		async (): Promise<ProcessSession> =>
			({ id: "new", terminalSessionId: "t-new", origin: "adHoc", worktreeId: "a" }) as ProcessSession,
	);
	const stopSession = vi.fn(async () => {});
	const removeSession = vi.fn();
	return {
		state,
		options: {
			workspaceId: "ws",
			worktree,
			workspaceStateRef: { current: state },
			outputPreviewBuffersRef: { current: new Map<string, string>() },
			getWorkspaceStateById: (id: string) => (id === "ws" ? state : null),
			createScopedWorkspaceDispatch: () => dispatch,
			sessions: [],
			spawnAdHocProcess,
			stopSession,
			removeSession,
		},
		dispatch,
		spawnAdHocProcess,
		stopSession,
		removeSession,
	};
}

describe("useFloatingShellActions.handleAddFloatingShell", () => {
	beforeEach(() => vi.clearAllMocks());

	it("spawns and dispatches registerFloatingShell under the cap", async () => {
		const { options, dispatch, spawnAdHocProcess, stopSession } = makeOptions(0);
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleAddFloatingShell();
		});
		expect(spawnAdHocProcess).toHaveBeenCalledTimes(1);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/registerFloatingShell", worktreeId: "a" }),
		);
		// The reducer accepted (dispatch mock pushed the id) → no teardown.
		expect(stopSession).not.toHaveBeenCalled();
		expect(clearReplayOutput).not.toHaveBeenCalled();
	});

	it("does NOT spawn when already at the cap (no orphan PTY)", async () => {
		const { options, dispatch, spawnAdHocProcess } = makeOptions(6);
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleAddFloatingShell();
		});
		expect(spawnAdHocProcess).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("tears down the spawned PTY if the cap was reached during the async spawn", async () => {
		const { options, dispatch, spawnAdHocProcess, stopSession } = makeOptions(5);
		// Simulate a concurrent launch filling the last slot while spawn awaited.
		spawnAdHocProcess.mockImplementation(async () => {
			options.workspaceStateRef.current.sessionsByWorktreeId.a.floatingShellIds.push("race");
			return { id: "new", terminalSessionId: "t-new", origin: "adHoc", worktreeId: "a" } as ProcessSession;
		});
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleAddFloatingShell();
		});
		expect(stopSession).toHaveBeenCalledWith("t-new");
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("shows a hint and does not spawn at the cap", async () => {
		const { options, spawnAdHocProcess } = makeOptions(6);
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleAddFloatingShell();
		});
		expect(notifyToast).toHaveBeenCalledWith("Maximum 6 floating shells");
		expect(spawnAdHocProcess).not.toHaveBeenCalled();
	});

	it("tears down the PTY when the reducer rejects registration", async () => {
		// Under the cap at the recheck, so spawn + dispatch happen, but the reducer
		// rejects (e.g. it lost a race at the cap). The default dispatch mock pushes
		// the id on accept; override it to a no-op so the process never lands in
		// floatingShellIds and the post-dispatch verify detects the rejection.
		const { options, dispatch, stopSession, removeSession } = makeOptions(5);
		dispatch.mockImplementation(() => {
			// reducer rejected: do NOT add the process to floatingShellIds
		});
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleAddFloatingShell();
		});
		// Registration WAS dispatched...
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/registerFloatingShell", worktreeId: "a" }),
		);
		// ...but the verify saw the process absent → tear the orphan PTY down.
		expect(stopSession).toHaveBeenCalledWith("t-new");
		expect(removeSession).toHaveBeenCalledWith("t-new");
		expect(clearReplayOutput).toHaveBeenCalledWith("t-new");
	});
});

describe("useFloatingShellActions.handleCloseFloatingShell", () => {
	beforeEach(() => vi.clearAllMocks());

	it("stops, removes, FREES THE REPLAY BUFFER, then dispatches closeFloatingShell", async () => {
		const { options, dispatch, stopSession, removeSession } =
			makeCloseOptions("running");
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleCloseFloatingShell("px");
		});
		expect(stopSession).toHaveBeenCalledWith("t-x");
		expect(removeSession).toHaveBeenCalledWith("t-x");
		// The exact guard the spec requires (§5.3): dismissal frees the buffer.
		expect(clearReplayOutput).toHaveBeenCalledWith("t-x");
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session/closeFloatingShell",
				worktreeId: "a",
				processId: "px",
			}),
		);
	});

	it("still frees the replay buffer when the shell already EXITED (no re-stop)", async () => {
		// This is the spec's exit-then-dismiss path: the retained-past-exit buffer
		// must be freed on dismissal even though the PTY is already gone.
		const { options, stopSession, removeSession } = makeCloseOptions("exited");
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleCloseFloatingShell("px");
		});
		expect(stopSession).not.toHaveBeenCalled(); // already exited
		expect(removeSession).toHaveBeenCalledWith("t-x");
		expect(clearReplayOutput).toHaveBeenCalledWith("t-x");
	});
});
