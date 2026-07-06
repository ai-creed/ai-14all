import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWorkspaceLifecycle } from "../../../src/app/hooks/use-workspace-lifecycle";
import { createAppWorkspacesState } from "../../../src/features/workspace/logic/app-workspaces-state";
import {
	createWorkspaceState,
	type WorkspaceAction,
} from "../../../src/features/workspace/logic/workspace-state";
import {
	PersistedWorktreeSessionSchema,
	type PersistedWorktreeSession,
} from "../../../shared/models/persisted-workspace-state";
import type { AgentResumeMode } from "../../../shared/models/persisted-settings";
import type { Worktree } from "../../../shared/models/worktree";
import type { TerminalSession } from "../../../shared/models/terminal-session";

const terminalsListMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());
const sendInputMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/lib/desktop-client", () => ({
	workspace: {
		openRepository: vi.fn(),
		readRestoreState: vi.fn(),
		writeRestoreState: vi.fn(),
		onOpenPicker: vi.fn(() => vi.fn()),
	},
	repository: {
		listWorktrees: vi.fn(),
	},
	terminals: {
		create: createSessionMock,
		sendInput: sendInputMock,
		list: terminalsListMock,
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	reviewComments: {
		rebaseWorktreeIds: vi.fn(),
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
	},
}));

const worktree: Worktree = {
	id: "wt-1",
	repositoryId: "repo",
	branchName: "main",
	path: "/repo/main",
	label: "main",
	isMain: true,
};

function sessionWith(
	processOverrides: Record<string, unknown>,
): PersistedWorktreeSession {
	return PersistedWorktreeSessionSchema.parse({
		worktreeId: "wt-1",
		note: "",
		reviewMode: "files",
		viewerMode: "file",
		selectedFilePath: null,
		selectedChangedFilePath: null,
		activeProcessSessionId: null,
		nextAdHocNumber: 1,
		processSessions: [
			{
				id: "proc-1",
				origin: "adHoc",
				presetId: null,
				label: "claude",
				command: "claude",
				pinned: false,
				terminalSessionId: "term-old",
				resumeCommand: null,
				...processOverrides,
			},
		],
	});
}

function makeHarness() {
	const dispatchLog: WorkspaceAction[] = [];
	const dispatch = (action: WorkspaceAction) => {
		dispatchLog.push(action);
	};

	const options: Parameters<typeof useWorkspaceLifecycle>[0] = {
		appWorkspaces: createAppWorkspacesState(),
		appWorkspacesRef: { current: createAppWorkspacesState() },
		prevActiveWorkspaceIdRef: { current: null },
		activeWorkspaceStateRef: { current: createWorkspaceState([]) },
		dispatchAppWorkspaces: vi.fn(),
		dispatch,
		savedSnapshot: null,
		savedDormantWorkspaces: [],
		setSavedSnapshot: vi.fn(),
		setRestorePreference: vi.fn(),
		setPendingRestoreSessions: vi.fn(),
		persistRestorePreference: vi.fn(),
		setStartupMode: vi.fn(),
		setStartupError: vi.fn(),
		setError: vi.fn(),
		setRestoreWarning: vi.fn(),
		setWorkspacePickerOpen: vi.fn(),
		createSession: createSessionMock,
		sendInput: sendInputMock,
		adoptSession: vi.fn(),
		resetDefaultShellEnsured: vi.fn(),
		agentResume: "auto",
	};

	return { options, dispatchLog };
}

describe("recreatePersistedProcesses — agent-resume replay (Task 13)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createSessionMock.mockResolvedValue({
			id: "term-new",
			workspaceId: "ws-1",
			worktreeId: "wt-1",
			cwd: "/repo/main",
			status: "running",
			exitCode: null,
		} satisfies TerminalSession);
	});

	async function recreate(input: {
		agentResume: AgentResumeMode;
		resumeCommand?: string | null;
		liveTerminal?: TerminalSession;
	}) {
		terminalsListMock.mockResolvedValueOnce(
			input.liveTerminal ? [input.liveTerminal] : [],
		);
		const harness = makeHarness();
		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));
		const snapshot = sessionWith({
			resumeCommand: input.resumeCommand ?? null,
		});
		await result.current.recreatePersistedProcesses(
			worktree,
			snapshot,
			"ws-1",
			input.agentResume,
			harness.options.dispatch,
		);
		return harness;
	}

	it("auto: types resumeCommand instead of command on fresh create", async () => {
		await recreate({
			agentResume: "auto",
			resumeCommand: "claude --resume abc",
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			"term-new",
			expect.stringContaining("claude --resume abc"),
		);
	});

	it("auto: falls back to command when resumeCommand fails re-validation", async () => {
		// Tampered on disk: contains a shell metacharacter forbidden by the
		// character allowlist.
		await recreate({
			agentResume: "auto",
			resumeCommand: "claude --resume abc; rm x",
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			"term-new",
			expect.stringMatching(/^claude[\r\n]/),
		);
	});

	it("manual: spawns shell, sets resumePending, types nothing", async () => {
		const harness = await recreate({
			agentResume: "manual",
			resumeCommand: "claude --resume abc",
		});
		expect(sendInputMock).not.toHaveBeenCalled();
		expect(harness.dispatchLog).toContainEqual(
			expect.objectContaining({
				type: "session/setResumePending",
				resumePending: true,
			}),
		);
	});

	it("manual: falls back to command replay when resumeCommand fails re-validation", async () => {
		const harness = await recreate({
			agentResume: "manual",
			resumeCommand: "claude --resume abc; rm x",
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			"term-new",
			expect.stringMatching(/^claude[\r\n]/),
		);
		expect(harness.dispatchLog).not.toContainEqual(
			expect.objectContaining({ type: "session/setResumePending" }),
		);
	});

	it("off: behaves exactly as today (command replay)", async () => {
		await recreate({
			agentResume: "off",
			resumeCommand: "claude --resume abc",
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			"term-new",
			expect.stringMatching(/^claude[\r\n]/),
		);
	});

	it("adopt path never replays resumeCommand", async () => {
		await recreate({
			agentResume: "auto",
			resumeCommand: "claude --resume abc",
			liveTerminal: {
				id: "term-old",
				workspaceId: "ws-1",
				worktreeId: "wt-1",
				cwd: "/repo/main",
				status: "running",
				exitCode: null,
			},
		});
		expect(sendInputMock).not.toHaveBeenCalled();
		expect(createSessionMock).not.toHaveBeenCalled();
	});
});
