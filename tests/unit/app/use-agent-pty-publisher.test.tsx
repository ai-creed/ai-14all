import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { WorkspaceState } from "../../../src/features/workspace/logic/workspace-state";

const upsertMock = vi.fn().mockResolvedValue(undefined);
const removeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/lib/desktop-client", () => ({
	agentPtys: {
		upsert: (...args: unknown[]) => upsertMock(...args),
		remove: (...args: unknown[]) => removeMock(...args),
		rebindIntent: vi.fn().mockResolvedValue(undefined),
		rebindCancel: vi.fn().mockResolvedValue(undefined),
	},
}));

import { useAgentPtyPublisher } from "../../../src/app/hooks/use-agent-pty-publisher";

function makeProcess(overrides: Partial<ProcessSession> = {}): ProcessSession {
	return {
		id: "proc-1",
		workspaceId: "ws-a",
		worktreeId: "wt-1",
		terminalSessionId: "term-1",
		origin: "adHoc",
		presetId: null,
		label: "claude",
		command: null,
		status: "running",
		lastActivityAt: null,
		lastOutputPreview: null,
		exitCode: null,
		pinned: false,
		attentionState: "idle",
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: true,
		provider: "claude",
		resumeCommand: null,
		resumePending: false,
		...overrides,
	};
}

function makeWorkspaceState(
	processSessionsById: Record<string, ProcessSession>,
): WorkspaceState {
	return {
		selectedWorktreeId: null,
		commandPresets: [],
		processSessionsById,
		sessionsByWorktreeId: {},
		nextAdHocNumberByWorktreeId: {},
	} as unknown as WorkspaceState;
}

beforeEach(() => {
	upsertMock.mockClear();
	removeMock.mockClear();
});

describe("useAgentPtyPublisher", () => {
	it("publishes an upsert for a tracked agent-detected process on mount", () => {
		const process = makeProcess();
		const state = makeWorkspaceState({ [process.id]: process });

		renderHook(() => useAgentPtyPublisher(state, "ws-a"));

		expect(upsertMock).toHaveBeenCalledTimes(1);
		expect(upsertMock).toHaveBeenCalledWith({
			worktreeId: "wt-1",
			agentId: "proc-1",
			terminalSessionId: "term-1",
			provider: "claude",
			label: "claude",
			live: true,
			agentDetected: true,
		});
	});

	it("publishes agentPtys.remove when the process's worktree disappears from state (not via explicit close)", () => {
		const process = makeProcess();
		const withProcess = makeWorkspaceState({ [process.id]: process });
		const { rerender } = renderHook(
			({ state }) => useAgentPtyPublisher(state, "ws-a"),
			{ initialProps: { state: withProcess } },
		);
		expect(upsertMock).toHaveBeenCalledTimes(1);
		expect(removeMock).not.toHaveBeenCalled();

		// Simulate `workspace/reconcileWorktrees` dropping the process because
		// its worktree was removed — no explicit per-process close action, the
		// process simply no longer exists in processSessionsById.
		const worktreeRemoved = makeWorkspaceState({});
		rerender({ state: worktreeRemoved });

		expect(removeMock).toHaveBeenCalledTimes(1);
		expect(removeMock).toHaveBeenCalledWith("wt-1", "proc-1");
	});

	it("does not evict a background workspace's processes when the active workspace switches", () => {
		const process = makeProcess({ workspaceId: "ws-a", worktreeId: "wt-1" });
		const wsAState = makeWorkspaceState({ [process.id]: process });
		const { rerender } = renderHook(
			({ state, workspaceId }) => useAgentPtyPublisher(state, workspaceId),
			{
				initialProps: { state: wsAState, workspaceId: "ws-a" as string | null },
			},
		);
		expect(upsertMock).toHaveBeenCalledTimes(1);

		// Switch the active workspace: `workspaceState` now reflects a totally
		// different workspace's (empty) processSessionsById. ws-a's process is
		// still alive in the main process — it must NOT be published as removed
		// just because it's no longer the active workspace's state.
		const wsBState = makeWorkspaceState({});
		rerender({ state: wsBState, workspaceId: "ws-b" });

		expect(removeMock).not.toHaveBeenCalled();
	});
});
