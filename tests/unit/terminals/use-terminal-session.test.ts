import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../../src/lib/desktop-client", () => ({
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
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
		logAttentionEvent: vi.fn(),
	},
}));

import { useTerminalSession } from "../../../src/features/terminals/hooks/use-terminal-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";

describe("useTerminalSession.adoptSession", () => {
	it("adds session to list without calling terminals.create", async () => {
		const { terminals } = await import("../../../src/lib/desktop-client");

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
		const { terminals } = await import("../../../src/lib/desktop-client");

		let stateListener:
			| ((event: { sessionId: string; status: string }) => void)
			| null = null;
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
