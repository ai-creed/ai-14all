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
	PersistedWorktreeSessionSchema,
	WorkspaceSnapshotSchema,
	type PersistedSavedWorkspace,
	type PersistedWorktreeSession,
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

	it("bails out without registering when the workspace goes live mid-hydration", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "workspace:repoB",
			repository: repo("/repos/repoB"),
		});

		const harness = makeHarness(baseRegistry());

		// Simulate activateWorkspace winning the race: it finishes (registering
		// workspace:repoB as live) while hydrateWorkspace's own listWorktrees
		// await is still in flight.
		listWorktreesMock.mockImplementationOnce(async () => {
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
						hydrationState: "active",
						loadError: null,
					},
				},
			);
			return [
				worktree("/repos/repoB", true),
				worktree("/repos/repoB-feature", false),
			];
		});

		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));
		harness.appDispatchLog.length = 0;

		const ok = await result.current.hydrateWorkspace("workspace:repoB");

		expect(ok).toBe(true);
		// No workspace/register dispatch after the liveness check should have
		// downgraded the now-active workspace back to inactiveLive.
		expect(
			harness.appDispatchLog.some(
				(a) =>
					a.type === "workspace/register" &&
					a.workspace.hydrationState === "inactiveLive",
			),
		).toBe(false);
		expect(
			harness.appDispatchLog.some((a) => a.type === "workspace/remove"),
		).toBe(false);
		// The pending map must not be touched either — activateWorkspace owns
		// this workspace's state now.
		expect(harness.pending()).toEqual({});
	});

	it("R1: does not downgrade a live workspace when hydration fails after the registry goes live mid-flight", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "workspace:repoB",
			repository: repo("/repos/repoB"),
		});

		const harness = makeHarness(baseRegistry());

		// Simulate activateWorkspace winning the race (as above), but this time
		// hydrateWorkspace's own listWorktrees call goes on to REJECT — a
		// transient failure racing a successful activateWorkspace must not be
		// allowed to downgrade the now-live workspace back to dormant+loadError.
		listWorktreesMock.mockImplementationOnce(async () => {
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
						hydrationState: "active",
						loadError: null,
					},
				},
			);
			throw new Error("ENOENT");
		});

		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));
		harness.appDispatchLog.length = 0;

		const ok = await result.current.hydrateWorkspace("workspace:repoB");

		// The end state is hydrated (by activateWorkspace), even though this
		// call's own attempt failed — matches the success-path race semantics.
		expect(ok).toBe(true);
		// No dormant+loadError re-register should have clobbered the live workspace.
		expect(
			harness.appDispatchLog.some(
				(a) =>
					a.type === "workspace/register" &&
					a.workspace.hydrationState === "dormant",
			),
		).toBe(false);
		expect(harness.appDispatchLog).toEqual([]);
	});
});

describe("activateWorkspace — pending-restore-map pruning (R2)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function pendingSession(worktreeId: string): PersistedWorktreeSession {
		return PersistedWorktreeSessionSchema.parse({
			worktreeId,
			note: "",
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: null,
			selectedChangedFilePath: null,
			activeProcessSessionId: null,
			nextAdHocNumber: 1,
			processSessions: [],
		});
	}

	it("replacing one workspace's pending entries preserves another workspace's entries", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "workspace:repoA",
			repository: repo("/repos/repoA"),
		});
		listWorktreesMock.mockResolvedValueOnce([
			worktree("/repos/repoA", true),
			worktree("/repos/repoA-feature", false),
		]);

		// Workspace A: dormant, with a two-session persisted snapshot — activating
		// it re-hydrates and re-populates ITS pending entries.
		let state = createAppWorkspacesState();
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "workspace:repoA",
				repository: repo("/repos/repoA"),
				worktrees: [],
				workspaceState: null,
				persistedSnapshot: savedWorkspace(
					"workspace:repoA",
					"/repos/repoA",
					["/repos/repoA", "/repos/repoA-feature"],
					"/repos/repoA",
				),
				hydrationState: "dormant",
				loadError: null,
			},
		});
		// Workspace C: already hydrated live by the background queue, with its own
		// pending (unvisited) entry sitting in the shared map.
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "workspace:repoC",
				repository: repo("/repos/repoC"),
				worktrees: [worktree("/repos/repoC", true)],
				workspaceState: createWorkspaceState([worktree("/repos/repoC", true)]),
				persistedSnapshot: null,
				hydrationState: "inactiveLive",
				loadError: null,
			},
		});

		const harness = makeHarness(state);

		// Seed the shared pending map as if background hydration already ran:
		// a stale entry for A (from a previous, now-superseded hydration) and a
		// live entry for C.
		harness.options.setPendingRestoreSessions({
			"/repos/repoA-stale": {
				workspaceId: "workspace:repoA",
				session: pendingSession("/repos/repoA-stale"),
			},
			"/repos/repoC": {
				workspaceId: "workspace:repoC",
				session: pendingSession("/repos/repoC"),
			},
		});

		const { result } = renderHook(() => useWorkspaceLifecycle(harness.options));
		await result.current.activateWorkspace("workspace:repoA");

		const pending = harness.pending();
		// C's entry must survive untouched — activating A must not wipe it.
		expect(pending["/repos/repoC"]?.workspaceId).toBe("workspace:repoC");
		// A's stale entry is gone, replaced by the fresh hydration's own entries.
		expect(pending["/repos/repoA-stale"]).toBeUndefined();
		// A's fresh pending entry (the non-selected feature worktree) is present,
		// tagged to the reopened workspace id.
		expect(pending["/repos/repoA-feature"]?.workspaceId).toBe(
			"workspace:repoA",
		);
	});
});
