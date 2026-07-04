import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useWorkspaceLifecycle } from "../../../src/app/hooks/use-workspace-lifecycle";
import {
	createAppWorkspacesState,
	appWorkspacesReducer,
	type AppWorkspacesAction,
	type AppWorkspacesState,
} from "../../../src/features/workspace/logic/app-workspaces-state";
import {
	createWorkspaceState,
	type WorkspaceState,
} from "../../../src/features/workspace/logic/workspace-state";
import type { PendingRestoreEntry } from "../../../src/features/workspace/logic/workspace-persistence";
import {
	WorkspaceSnapshotSchema,
	type PersistedSavedWorkspace,
	type WorkspaceSnapshot,
} from "../../../shared/models/persisted-workspace-state";
import type { Repository } from "../../../shared/models/repository";
import type { Worktree } from "../../../shared/models/worktree";

const openRepositoryMock = vi.hoisted(() => vi.fn());
const listWorktreesMock = vi.hoisted(() => vi.fn());
const rebaseWorktreeIdsMock = vi.hoisted(() => vi.fn());
const terminalsListMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/lib/desktop-client", () => ({
	workspace: {
		openRepository: openRepositoryMock,
		readRestoreState: vi.fn(),
		writeRestoreState: vi.fn(),
		onOpenPicker: vi.fn(() => vi.fn()),
	},
	repository: {
		listWorktrees: listWorktreesMock,
	},
	terminals: {
		create: createSessionMock,
		sendInput: vi.fn(),
		list: terminalsListMock,
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	reviewComments: {
		rebaseWorktreeIds: rebaseWorktreeIdsMock,
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
	},
}));

const repo = (rootPath: string): Repository => ({
	id: rootPath,
	name: rootPath.split("/").filter(Boolean).at(-1) ?? rootPath,
	rootPath,
	repoId: null,
});

const worktree = (id: string, isMain: boolean): Worktree => ({
	id,
	repositoryId: "repo",
	branchName: isMain ? "main" : id,
	path: id,
	label: id,
	isMain,
});

function savedWorkspace(
	workspaceId: string,
	rootPath: string,
	worktreeIds: string[],
	selectedWorktreeId: string | null,
): PersistedSavedWorkspace {
	const snapshot: WorkspaceSnapshot = WorkspaceSnapshotSchema.parse({
		repositoryPath: rootPath,
		repoId: null,
		selectedWorktreeId,
		commandPresets: [],
		worktreeSessions: worktreeIds.map((worktreeId) => ({
			worktreeId,
			note: "",
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: null,
			selectedChangedFilePath: null,
			activeProcessSessionId: null,
			nextAdHocNumber: 1,
			processSessions: [],
		})),
	});
	return { workspaceId, repositoryPath: rootPath, repoId: null, snapshot };
}

type Harness = {
	options: Parameters<typeof useWorkspaceLifecycle>[0];
	appDispatchLog: AppWorkspacesAction[];
	pending: () => Record<string, PendingRestoreEntry>;
};

function makeHarness(initial: AppWorkspacesState): Harness {
	const appDispatchLog: AppWorkspacesAction[] = [];
	const stateRef: MutableRefObject<AppWorkspacesState> = { current: initial };
	const dispatchAppWorkspaces = (action: AppWorkspacesAction) => {
		appDispatchLog.push(action);
		stateRef.current = appWorkspacesReducer(stateRef.current, action);
	};

	let pendingState: Record<string, PendingRestoreEntry> = {};
	const setPendingRestoreSessions: Dispatch<
		SetStateAction<Record<string, PendingRestoreEntry>>
	> = (updater) => {
		pendingState =
			typeof updater === "function" ? updater(pendingState) : updater;
	};

	const activeStateRef: MutableRefObject<WorkspaceState> = {
		current: createWorkspaceState([]),
	};

	const options: Parameters<typeof useWorkspaceLifecycle>[0] = {
		appWorkspaces: initial,
		appWorkspacesRef: stateRef,
		prevActiveWorkspaceIdRef: { current: initial.activeWorkspaceId },
		activeWorkspaceStateRef: activeStateRef,
		dispatchAppWorkspaces,
		dispatch: vi.fn(),
		savedSnapshot: null,
		savedDormantWorkspaces: [],
		setSavedSnapshot: vi.fn(),
		setRestorePreference: vi.fn(),
		setPendingRestoreSessions,
		persistRestorePreference: vi.fn(),
		setStartupMode: vi.fn(),
		setStartupError: vi.fn(),
		setError: vi.fn(),
		setRestoreWarning: vi.fn(),
		setWorkspacePickerOpen: vi.fn(),
		createSession: createSessionMock,
		sendInput: vi.fn(),
		adoptSession: vi.fn(),
		resetDefaultShellEnsured: vi.fn(),
	};

	return { options, appDispatchLog, pending: () => pendingState };
}

describe("hydrateWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function baseRegistry(): AppWorkspacesState {
		// Active, live workspace A.
		const stateA = createWorkspaceState([worktree("/repos/repoA", true)]);
		let state = createAppWorkspacesState();
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "workspace:repoA",
				repository: repo("/repos/repoA"),
				worktrees: [worktree("/repos/repoA", true)],
				workspaceState: stateA,
				persistedSnapshot: null,
				hydrationState: "active",
				loadError: null,
			},
		});
		// Dormant workspace B with a two-session persisted snapshot.
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "workspace:repoB",
				repository: repo("/repos/repoB"),
				worktrees: [],
				workspaceState: null,
				persistedSnapshot: savedWorkspace(
					"workspace:repoB",
					"/repos/repoB",
					["/repos/repoB", "/repos/repoB-feature"],
					"/repos/repoB",
				),
				hydrationState: "dormant",
				loadError: null,
			},
		});
		return state;
	}

	it("hydrates a dormant workspace without selecting it", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "workspace:repoB",
			repository: repo("/repos/repoB"),
		});
		listWorktreesMock.mockResolvedValueOnce([
			worktree("/repos/repoB", true),
			worktree("/repos/repoB-feature", false),
		]);

		const harness = makeHarness(baseRegistry());
		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));

		const ok = await result.current.hydrateWorkspace("workspace:repoB");

		expect(ok).toBe(true);
		const registered = harness.appDispatchLog.filter(
			(a) => a.type === "workspace/register",
		);
		expect(
			registered.at(-1)?.type === "workspace/register" &&
				registered.at(-1)?.workspace.hydrationState,
		).toBe("inactiveLive");
		expect(
			harness.appDispatchLog.some((a) => a.type === "workspace/select"),
		).toBe(false);
		// Every saved session became pending (terminals lazy) — selected included.
		expect(Object.keys(harness.pending())).toEqual([
			"/repos/repoB",
			"/repos/repoB-feature",
		]);
		// Entries are tagged with the reopened workspace id.
		expect(harness.pending()["/repos/repoB"].workspaceId).toBe(
			"workspace:repoB",
		);
		expect(createSessionMock).not.toHaveBeenCalled();
	});

	it("returns true without dispatching when the workspace is already live", async () => {
		const harness = makeHarness(baseRegistry());
		// Re-register B as live.
		harness.options.appWorkspacesRef.current = appWorkspacesReducer(
			harness.options.appWorkspacesRef.current,
			{
				type: "workspace/register",
				workspace: {
					workspaceId: "workspace:repoB",
					repository: repo("/repos/repoB"),
					worktrees: [worktree("/repos/repoB", true)],
					workspaceState: createWorkspaceState([
						worktree("/repos/repoB", true),
					]),
					persistedSnapshot: null,
					hydrationState: "inactiveLive",
					loadError: null,
				},
			},
		);
		harness.appDispatchLog.length = 0;

		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));
		const ok = await result.current.hydrateWorkspace("workspace:repoB");

		expect(ok).toBe(true);
		expect(openRepositoryMock).not.toHaveBeenCalled();
		expect(harness.appDispatchLog).toEqual([]);
	});

	it("removes the stale registry entry when the reopened id drifts", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "workspace:repoB-canonical",
			repository: repo("/repos/repoB"),
		});
		listWorktreesMock.mockResolvedValueOnce([worktree("/repos/repoB", true)]);

		const harness = makeHarness(baseRegistry());
		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));

		const ok = await result.current.hydrateWorkspace("workspace:repoB");

		expect(ok).toBe(true);
		expect(
			harness.appDispatchLog.some(
				(a) =>
					a.type === "workspace/remove" && a.workspaceId === "workspace:repoB",
			),
		).toBe(true);
	});

	it("marks loadError and returns false when openRepository throws", async () => {
		openRepositoryMock.mockRejectedValueOnce(new Error("ENOENT"));

		let state = createAppWorkspacesState();
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "workspace:gone",
				repository: repo("/repos/gone"),
				worktrees: [],
				workspaceState: null,
				persistedSnapshot: savedWorkspace(
					"workspace:gone",
					"/repos/gone",
					["/repos/gone"],
					"/repos/gone",
				),
				hydrationState: "dormant",
				loadError: null,
			},
		});

		const harness = makeHarness(state);
		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));

		const ok = await result.current.hydrateWorkspace("workspace:gone");

		expect(ok).toBe(false);
		const reg = harness.appDispatchLog
			.filter((a) => a.type === "workspace/register")
			.at(-1);
		expect(
			reg?.type === "workspace/register" && reg.workspace.hydrationState,
		).toBe("dormant");
		expect(
			reg?.type === "workspace/register" && reg.workspace.loadError,
		).toContain("ENOENT");
	});

	it("returns false when the workspace id is unknown", async () => {
		const harness = makeHarness(baseRegistry());
		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));
		const ok = await result.current.hydrateWorkspace("workspace:nope");
		expect(ok).toBe(false);
		expect(openRepositoryMock).not.toHaveBeenCalled();
	});
});
