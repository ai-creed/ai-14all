import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { useAgentResumeBridge } from "../../../src/app/hooks/use-agent-resume-bridge";
import type { AppWorkspacesState } from "../../../src/features/workspace/logic/app-workspaces-state";
import type { AgentResumeBridgeRequest } from "../../../shared/contracts/agent-resume-bridge";

beforeEach(() => {
	delete (window as unknown as { ai14all?: unknown }).ai14all;
});

type Bridge = {
	handler: ((req: AgentResumeBridgeRequest) => void) | null;
	sendReply: ReturnType<typeof vi.fn>;
	sendReady: ReturnType<typeof vi.fn>;
	sendGoodbye: ReturnType<typeof vi.fn>;
};

function installBridge(): Bridge {
	const bridge: Bridge = {
		handler: null,
		sendReply: vi.fn(),
		sendReady: vi.fn(),
		sendGoodbye: vi.fn(),
	};
	(window as unknown as { ai14all: unknown }).ai14all = {
		events: {
			onAgentResumeRequest: (h: (req: AgentResumeBridgeRequest) => void) => {
				bridge.handler = h;
				return () => {
					bridge.handler = null;
				};
			},
			sendAgentResumeReply: bridge.sendReply,
			sendAgentResumeReady: bridge.sendReady,
			sendAgentResumeGoodbye: bridge.sendGoodbye,
		},
	};
	return bridge;
}

function refWith(
	processSessionsById: Record<string, { terminalSessionId: string | null }>,
	workspaceId = "ws-1",
): MutableRefObject<AppWorkspacesState> {
	return {
		current: {
			activeWorkspaceId: workspaceId,
			workspaceOrder: [workspaceId],
			workspacesById: {
				[workspaceId]: { workspaceState: { processSessionsById } },
			},
		},
	} as unknown as MutableRefObject<AppWorkspacesState>;
}

function makeRequest(
	overrides: Partial<AgentResumeBridgeRequest> = {},
): AgentResumeBridgeRequest {
	return {
		id: "req-1",
		worktreeId: "wt-1",
		terminalSessionId: "term-1",
		provider: "claude",
		resumeCommand: "claude --resume abc-123",
		reportedAt: 123,
		...overrides,
	};
}

describe("useAgentResumeBridge", () => {
	it("announces ready on mount and goodbye on unmount", () => {
		const bridge = installBridge();
		const ref = refWith({ "proc-1": { terminalSessionId: "term-1" } });
		const dispatchToWorkspace = vi.fn();

		const { unmount } = renderHook(() =>
			useAgentResumeBridge({ appWorkspacesRef: ref, dispatchToWorkspace }),
		);

		expect(bridge.sendReady).toHaveBeenCalledOnce();
		expect(bridge.sendGoodbye).not.toHaveBeenCalled();

		unmount();
		expect(bridge.sendGoodbye).toHaveBeenCalledOnce();
	});

	it("dispatches the resume command to the owning workspace and acks ok", () => {
		const bridge = installBridge();
		const ref = refWith(
			{ "proc-1": { terminalSessionId: "term-1" } },
			"ws-owner",
		);
		const dispatchToWorkspace = vi.fn();

		renderHook(() =>
			useAgentResumeBridge({ appWorkspacesRef: ref, dispatchToWorkspace }),
		);

		act(() => bridge.handler!(makeRequest()));

		expect(dispatchToWorkspace).toHaveBeenCalledWith("ws-owner", {
			type: "session/setResumeCommand",
			terminalSessionId: "term-1",
			resumeCommand: "claude --resume abc-123",
		});
		expect(bridge.sendReply).toHaveBeenCalledWith({ id: "req-1", ok: true });
	});

	it("replies no_terminal when no process owns the terminal session", () => {
		const bridge = installBridge();
		const ref = refWith({ "proc-1": { terminalSessionId: "other-term" } });
		const dispatchToWorkspace = vi.fn();

		renderHook(() =>
			useAgentResumeBridge({ appWorkspacesRef: ref, dispatchToWorkspace }),
		);

		act(() => bridge.handler!(makeRequest({ terminalSessionId: "term-1" })));

		expect(dispatchToWorkspace).not.toHaveBeenCalled();
		expect(bridge.sendReply).toHaveBeenCalledWith({
			id: "req-1",
			ok: false,
			error: "no_terminal",
			message: expect.stringContaining("term-1"),
		});
	});

	it("is a no-op (no ready) when the bridge is absent", () => {
		(window as unknown as { ai14all: unknown }).ai14all = { events: {} };
		const ref = refWith({ "proc-1": { terminalSessionId: "term-1" } });
		const dispatchToWorkspace = vi.fn();

		expect(() =>
			renderHook(() =>
				useAgentResumeBridge({ appWorkspacesRef: ref, dispatchToWorkspace }),
			),
		).not.toThrow();
		expect(dispatchToWorkspace).not.toHaveBeenCalled();
	});
});
