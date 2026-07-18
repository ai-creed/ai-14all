import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFloatingShellActions } from "../../../src/app/hooks/use-floating-shell-actions";
import { createWorkspaceState } from "../../../src/features/workspace/logic/workspace-state";
import { clearReplayOutput } from "../../../src/features/terminals/logic/replay-buffer";
import { notifyToast } from "../../../src/features/ui/toast/ToastProvider";
import type { Worktree } from "../../../shared/models/worktree";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";

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

const settingsFixture = {
	settings: {
		...DEFAULT_PERSISTED_SETTINGS,
		terminalConfirm: { restart: true, close: true },
	},
	update: vi.fn(),
};
vi.mock("../../../src/app/hooks/use-settings", () => ({
	useSettings: () => settingsFixture,
}));

const worktree = {
	id: "a",
	path: "/repo/a",
	branch: "a",
	isPrimary: false,
} as unknown as Worktree;

const proc = (id: string, terminalSessionId: string): ProcessSession =>
	({
		id,
		terminalSessionId,
		origin: "adHoc",
		worktreeId: "a",
	}) as ProcessSession;

const term = (id: string, status: TerminalSession["status"]): TerminalSession =>
	({
		id,
		workspaceId: "ws",
		worktreeId: "a",
		cwd: "/repo/a",
		status,
		exitCode: null,
	}) as TerminalSession;

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
			spawnAdHocProcess: vi.fn() as never,
			stopSession,
			removeSession,
			subscribeSessionExit: vi.fn(() => () => {}) as never,
			sendInput: vi.fn().mockResolvedValue(undefined) as never,
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
	const dispatch = vi.fn(
		(action: { type: string; process?: ProcessSession }) => {
			if (action.type === "session/registerFloatingShell" && action.process) {
				state.sessionsByWorktreeId.a.floatingShellIds.push(action.process.id);
			}
		},
	);
	const spawnAdHocProcess = vi.fn(
		async (): Promise<ProcessSession> =>
			({
				id: "new",
				terminalSessionId: "t-new",
				origin: "adHoc",
				worktreeId: "a",
			}) as ProcessSession,
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
			spawnAdHocProcess: spawnAdHocProcess as never,
			stopSession,
			removeSession,
			subscribeSessionExit: vi.fn(() => () => {}) as never,
			sendInput: vi.fn().mockResolvedValue(undefined) as never,
		},
		dispatch,
		spawnAdHocProcess,
		stopSession,
		removeSession,
	};
}

type SpawnFn = (opts?: {
	command?: string;
	label?: string;
}) => Promise<ProcessSession | null>;

/**
 * Thin helper for runCommandInFloatingShell tests. Accepts per-test overrides
 * and handles the registerFloatingShell → floatingShellIds book-keeping so the
 * hook's post-dispatch verify sees the process and does not tear it down.
 */
function renderFloatingShellActions(opts: {
	subscribeSessionExit?: (
		sessionId: string,
		cb: (exitCode: number | null) => void,
	) => () => void;
	sendInput?: (sessionId: string, data: string) => Promise<void>;
	spawnAdHocProcess?: SpawnFn | ReturnType<typeof vi.fn>;
	dispatch?:
		| ((action: { type: string; [key: string]: unknown }) => void)
		| ReturnType<typeof vi.fn>;
	floatingShellIds?: string[];
}) {
	const state = createWorkspaceState([worktree]);
	state.sessionsByWorktreeId.a.floatingShellIds = [
		...(opts.floatingShellIds ?? []),
	];

	// Internal dispatch that keeps state in sync (accepts registrations) AND
	// forwards to the caller's spy so assertions on opts.dispatch work.
	const externalDispatch = opts.dispatch as
		| ((action: { type: string; [key: string]: unknown }) => void)
		| undefined;
	const internalDispatch = vi.fn(
		(action: { type: string; process?: ProcessSession }) => {
			if (action.type === "session/registerFloatingShell" && action.process) {
				state.sessionsByWorktreeId.a.floatingShellIds.push(action.process.id);
			}
			externalDispatch?.(action);
		},
	);

	const defaultSpawn: SpawnFn = async () =>
		({
			id: "new",
			terminalSessionId: "t-new",
			origin: "adHoc",
			worktreeId: "a",
		}) as ProcessSession;

	const spawnAdHocProcess = (opts.spawnAdHocProcess ?? defaultSpawn) as SpawnFn;

	const getWorkspaceStateById = (id: string) => (id === "ws" ? state : null);

	const options = {
		workspaceId: "ws",
		worktree,
		workspaceStateRef: { current: state },
		outputPreviewBuffersRef: { current: new Map<string, string>() },
		getWorkspaceStateById,
		createScopedWorkspaceDispatch: () => internalDispatch,
		sessions: [],
		spawnAdHocProcess,
		stopSession: vi.fn(async () => {}),
		removeSession: vi.fn(),
		subscribeSessionExit:
			opts.subscribeSessionExit ?? (vi.fn(() => () => {}) as never),
		sendInput:
			opts.sendInput ?? (vi.fn().mockResolvedValue(undefined) as never),
	};

	const rendered = renderHook(() => useFloatingShellActions(options));
	return { ...rendered, getWorkspaceStateById };
}

describe("useFloatingShellActions.handleAddFloatingShell", () => {
	beforeEach(() => vi.clearAllMocks());

	it("spawns and dispatches registerFloatingShell under the cap", async () => {
		const { options, dispatch, spawnAdHocProcess, stopSession } =
			makeOptions(0);
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(async () => {
			await result.current.handleAddFloatingShell();
		});
		expect(spawnAdHocProcess).toHaveBeenCalledTimes(1);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session/registerFloatingShell",
				worktreeId: "a",
			}),
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
		const { options, dispatch, spawnAdHocProcess, stopSession } =
			makeOptions(5);
		// Simulate a concurrent launch filling the last slot while spawn awaited.
		spawnAdHocProcess.mockImplementation(async () => {
			options.workspaceStateRef.current.sessionsByWorktreeId.a.floatingShellIds.push(
				"race",
			);
			return {
				id: "new",
				terminalSessionId: "t-new",
				origin: "adHoc",
				worktreeId: "a",
			} as ProcessSession;
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
			expect.objectContaining({
				type: "session/registerFloatingShell",
				worktreeId: "a",
			}),
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

describe("useFloatingShellActions.runCommandInFloatingShell", () => {
	beforeEach(() => vi.clearAllMocks());

	it("spawns a floating shell with the command, auto-expands, and auto-closes on exit 0", async () => {
		let fireExit: ((code: number | null) => void) | null = null;
		const subscribeSessionExit = vi.fn(
			(_sessionId: string, cb: (exitCode: number | null) => void) => {
				fireExit = cb;
				return () => {};
			},
		);
		const spawnAdHocProcess = vi.fn().mockResolvedValue({
			id: "proc-1",
			terminalSessionId: "term-1",
		});
		const dispatch = vi.fn();
		const sendInput = vi.fn().mockResolvedValue(undefined);
		const { result } = renderFloatingShellActions({
			subscribeSessionExit,
			sendInput,
			spawnAdHocProcess,
			dispatch,
			floatingShellIds: [], // under cap
		});
		const onExit = vi.fn();

		await act(async () => {
			await result.current.runCommandInFloatingShell("whisper skill install", {
				label: "plugin install",
				autoCloseOnZero: true,
				onExit,
			});
		});

		expect(spawnAdHocProcess).toHaveBeenCalledWith({
			command: "whisper skill install",
			label: "plugin install",
		});
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/registerFloatingShell" }),
		);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/expandFloatingShell" }),
		);
		// The command is sent only AFTER the exit listener is installed (no race).
		expect(sendInput).toHaveBeenCalledWith(
			"term-1",
			expect.stringContaining("whisper skill install"),
		);
		expect(subscribeSessionExit.mock.invocationCallOrder[0]).toBeLessThan(
			sendInput.mock.invocationCallOrder[0],
		);

		act(() => fireExit?.(0));
		expect(onExit).toHaveBeenCalledWith(0);
		// auto-close dispatched for exit 0
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/closeFloatingShell" }),
		);
	});

	it("lingers (does NOT auto-close) when the command exits non-zero", async () => {
		let fireExit: ((code: number | null) => void) | null = null;
		const subscribeSessionExit = vi.fn(
			(_sessionId: string, cb: (exitCode: number | null) => void) => {
				fireExit = cb;
				return () => {};
			},
		);
		const spawnAdHocProcess = vi.fn().mockResolvedValue({
			id: "proc-1",
			terminalSessionId: "term-1",
		});
		const dispatch = vi.fn();
		const sendInput = vi.fn().mockResolvedValue(undefined);
		const onExit = vi.fn();
		const { result } = renderFloatingShellActions({
			subscribeSessionExit,
			sendInput,
			spawnAdHocProcess,
			dispatch,
			floatingShellIds: [],
		});

		await act(async () => {
			await result.current.runCommandInFloatingShell("boom", {
				label: "plugin install",
				autoCloseOnZero: true,
				onExit,
			});
		});

		act(() => fireExit?.(1));
		// Non-zero exit still fires onExit (re-probe), but the shell is NOT closed, so
		// the error stays readable.
		expect(onExit).toHaveBeenCalledWith(1);
		expect(dispatch).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/closeFloatingShell" }),
		);
	});

	it("aborts at the floating-shell cap without spawning", async () => {
		const spawnAdHocProcess = vi.fn();
		const { result } = renderFloatingShellActions({
			spawnAdHocProcess,
			floatingShellIds: ["a", "b", "c", "d", "e", "f"], // at MAX (6)
		});
		await act(async () => {
			await result.current.runCommandInFloatingShell("x", { label: "y" });
		});
		expect(spawnAdHocProcess).not.toHaveBeenCalled();
	});
});

describe("gated handleCloseFloatingShell (terminal-ux-hardening spec §5.4)", () => {
	beforeEach(() => {
		settingsFixture.settings.terminalConfirm = { restart: true, close: true };
		settingsFixture.update.mockReset();
	});

	function makeGateOptions(processStatus: ProcessSession["status"]) {
		const made = makeCloseOptions("running");
		(
			made.options.workspaceStateRef.current.processSessionsById
				.px as ProcessSession
		).status = processStatus;
		(
			made.options.workspaceStateRef.current.processSessionsById
				.px as ProcessSession
		).label = "float-px";
		return made;
	}

	it("live + ask parks a pending close; confirm tears down, cancel does not", async () => {
		const { options, dispatch } = makeGateOptions("running");
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(() => result.current.handleCloseFloatingShell("px"));
		expect(result.current.pendingFloatingClose).toEqual({
			processId: "px",
			label: "float-px",
		});
		expect(dispatch).not.toHaveBeenCalled();
		act(() => result.current.cancelPendingFloatingClose());
		expect(result.current.pendingFloatingClose).toBeNull();
		expect(dispatch).not.toHaveBeenCalled();
		await act(() => result.current.handleCloseFloatingShell("px"));
		await act(async () => result.current.confirmPendingFloatingClose(false));
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/closeFloatingShell" }),
		);
	});

	it("pref silent closes immediately", async () => {
		settingsFixture.settings.terminalConfirm = { restart: true, close: false };
		const { options, dispatch } = makeGateOptions("running");
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(() => result.current.handleCloseFloatingShell("px"));
		expect(result.current.pendingFloatingClose).toBeNull();
		expect(dispatch).toHaveBeenCalled();
	});

	it("exited process closes immediately", async () => {
		const { options, dispatch } = makeGateOptions("exited");
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(() => result.current.handleCloseFloatingShell("px"));
		expect(result.current.pendingFloatingClose).toBeNull();
		expect(dispatch).toHaveBeenCalled();
	});

	it("confirm with dontAskAgain writes the bare close patch", async () => {
		const { options } = makeGateOptions("running");
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(() => result.current.handleCloseFloatingShell("px"));
		await act(async () => result.current.confirmPendingFloatingClose(true));
		expect(settingsFixture.update).toHaveBeenCalledWith({
			terminalConfirm: { close: false },
		});
	});

	it("clean autoCloseOnZero exit closes with no dialog regardless of pref", async () => {
		// Reuse the file's EXISTING runCommandInFloatingShell fixture if one
		// exists (the file covers the command path already); otherwise wire
		// subscribeSessionExit capture on makeGateOptions as below. The
		// assertion contract is fixed either way: a clean auto-close never
		// parks pendingFloatingClose and dispatches the close directly.
		const { options, dispatch } = makeGateOptions("running");
		let exitCb: ((code: number | null) => void) | null = null;
		options.subscribeSessionExit = vi.fn(
			(_id: string, cb: (code: number | null) => void) => {
				exitCb = cb;
				return () => {};
			},
		) as never;
		options.spawnAdHocProcess = vi.fn(async () => {
			const p = proc("px", "t-x") as ProcessSession;
			p.status = "running";
			return p;
		}) as never;
		const { result } = renderHook(() => useFloatingShellActions(options));
		await act(() =>
			result.current.runCommandInFloatingShell("true", {
				label: "probe",
				autoCloseOnZero: true,
			}),
		);
		await act(async () => exitCb?.(0));
		expect(result.current.pendingFloatingClose).toBeNull();
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session/closeFloatingShell" }),
		);
	});
});
