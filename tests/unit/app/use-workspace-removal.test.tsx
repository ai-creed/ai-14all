import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ProcessSession } from "../../../shared/models/process-session";
import type { WorkspaceState } from "../../../src/features/workspace/logic/workspace-state";
import type {
	AppWorkspacesAction,
	AppWorkspacesState,
} from "../../../src/features/workspace/logic/app-workspaces-state";
import type { AppWorkspace } from "../../../shared/models/app-workspace";

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

import { useWorkspaceRemoval } from "../../../src/app/hooks/use-workspace-removal";

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

function makeAppWorkspace(overrides: Partial<AppWorkspace> = {}): AppWorkspace {
	return {
		workspaceId: "ws-a",
		repository: {
			id: "repo-a",
			name: "repo-a",
			rootPath: "/repo-a",
			repoId: null,
		},
		worktrees: [],
		workspaceState: null,
		persistedSnapshot: null,
		hydrationState: "active",
		loadError: null,
		...overrides,
	};
}

beforeEach(() => {
	upsertMock.mockClear();
	removeMock.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useWorkspaceRemoval", () => {
	it("publishes an agentPtys.remove for every process (live and exited) when removing the ACTIVE workspace, before dispatching workspace/remove", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		const stopSession = vi.fn().mockResolvedValue(undefined);
		const dispatchAppWorkspaces =
			vi.fn<(action: AppWorkspacesAction) => void>();
		const callOrder: string[] = [];
		removeMock.mockImplementation((...args: unknown[]) => {
			callOrder.push(`remove:${String(args[1])}`);
			return Promise.resolve(undefined);
		});
		dispatchAppWorkspaces.mockImplementation(() => {
			callOrder.push("dispatch");
		});

		const liveProcess = makeProcess({
			id: "proc-live",
			worktreeId: "wt-1",
			status: "running",
			terminalSessionId: "term-1",
		});
		const exitedProcess = makeProcess({
			id: "proc-exited",
			worktreeId: "wt-1",
			status: "exited",
			terminalSessionId: null,
		});
		const workspaceState = makeWorkspaceState({
			[liveProcess.id]: liveProcess,
			[exitedProcess.id]: exitedProcess,
		});
		const appWorkspaces: AppWorkspacesState = {
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a"],
			workspacesById: {
				"ws-a": makeAppWorkspace({
					workspaceId: "ws-a",
					workspaceState,
					hydrationState: "active",
				}),
			},
		};

		const { result } = renderHook(() =>
			useWorkspaceRemoval({
				appWorkspaces,
				dispatchAppWorkspaces,
				stopSession,
			}),
		);

		await result.current.handleRemoveWorkspace("ws-a");

		expect(confirmSpy).toHaveBeenCalledTimes(1);
		expect(stopSession).toHaveBeenCalledWith("term-1");
		expect(removeMock).toHaveBeenCalledTimes(2);
		expect(removeMock).toHaveBeenCalledWith("wt-1", "proc-live");
		expect(removeMock).toHaveBeenCalledWith("wt-1", "proc-exited");
		expect(dispatchAppWorkspaces).toHaveBeenCalledWith({
			type: "workspace/remove",
			workspaceId: "ws-a",
		});
		// Removes must land before the workspace/remove dispatch, matching the
		// order the diff would have used had this workspace still been active.
		expect(callOrder.indexOf("dispatch")).toBe(callOrder.length - 1);
	});

	it("publishes an agentPtys.remove for every process when removing an INACTIVE (background, state-bearing) workspace — the case the active-only publisher diff can never clean", async () => {
		const confirmSpy = vi.spyOn(window, "confirm");
		const stopSession = vi.fn().mockResolvedValue(undefined);
		const dispatchAppWorkspaces =
			vi.fn<(action: AppWorkspacesAction) => void>();

		// This workspace is NOT the active one, but it retained workspaceState
		// (hydrationState: "inactiveLive") from when it was last active — its
		// process already exited, so there is no live session to confirm.
		const exitedProcess = makeProcess({
			id: "proc-bg",
			workspaceId: "ws-b",
			worktreeId: "wt-2",
			status: "exited",
			terminalSessionId: null,
		});
		const workspaceState = makeWorkspaceState({
			[exitedProcess.id]: exitedProcess,
		});
		const appWorkspaces: AppWorkspacesState = {
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a", "ws-b"],
			workspacesById: {
				"ws-a": makeAppWorkspace({ workspaceId: "ws-a" }),
				"ws-b": makeAppWorkspace({
					workspaceId: "ws-b",
					workspaceState,
					hydrationState: "inactiveLive",
				}),
			},
		};

		const { result } = renderHook(() =>
			useWorkspaceRemoval({
				appWorkspaces,
				dispatchAppWorkspaces,
				stopSession,
			}),
		);

		await result.current.handleRemoveWorkspace("ws-b");

		expect(confirmSpy).not.toHaveBeenCalled();
		expect(stopSession).not.toHaveBeenCalled();
		expect(removeMock).toHaveBeenCalledTimes(1);
		expect(removeMock).toHaveBeenCalledWith("wt-2", "proc-bg");
		expect(dispatchAppWorkspaces).toHaveBeenCalledWith({
			type: "workspace/remove",
			workspaceId: "ws-b",
		});
	});
});
