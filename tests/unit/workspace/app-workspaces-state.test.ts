import { describe, expect, it } from "vitest";
import {
	createAppWorkspacesState,
	appWorkspacesReducer,
	type AppWorkspacesState,
} from "../../../src/features/workspace/logic/app-workspaces-state";
import { createWorkspaceState } from "../../../src/features/workspace/logic/workspace-state";

const repoA = {
	id: "repo-a",
	name: "repo-a",
	rootPath: "/repo-a",
	repoId: "repo-id-a",
};

const repoB = {
	id: "repo-b",
	name: "repo-b",
	rootPath: "/repo-b",
	repoId: "repo-id-b",
};

describe("appWorkspacesReducer", () => {
	it("registers workspaces and selects the first opened workspace", () => {
		let state = createAppWorkspacesState();
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "ws-a",
				repository: repoA,
				worktrees: [],
				workspaceState: createWorkspaceState([]),
				persistedSnapshot: null,
				hydrationState: "active",
				loadError: null,
			},
		});
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: {
				workspaceId: "ws-b",
				repository: repoB,
				worktrees: [],
				workspaceState: null,
				persistedSnapshot: {
					workspaceId: "ws-b",
					repositoryPath: "/repo-b",
					repoId: "repo-id-b",
					snapshot: {
						repositoryPath: "/repo-b",
						repoId: "repo-id-b",
						selectedWorktreeId: null,
						commandPresets: [],
						worktreeSessions: [],
					},
				},
				hydrationState: "dormant",
				loadError: null,
			},
		});

		expect(state.activeWorkspaceId).toBe("ws-a");
		expect(state.workspaceOrder).toEqual(["ws-a", "ws-b"]);
	});

	it("switches the active workspace without removing hydrated inactive workspace state", () => {
		const state = appWorkspacesReducer(
			{
				activeWorkspaceId: "ws-a",
				workspaceOrder: ["ws-a", "ws-b"],
				workspacesById: {
					"ws-a": {
						workspaceId: "ws-a",
						repository: repoA,
						worktrees: [],
						workspaceState: createWorkspaceState([]),
						persistedSnapshot: null,
						hydrationState: "active",
						loadError: null,
					},
					"ws-b": {
						workspaceId: "ws-b",
						repository: repoB,
						worktrees: [],
						workspaceState: createWorkspaceState([]),
						persistedSnapshot: null,
						hydrationState: "inactiveLive",
						loadError: null,
					},
				},
			},
			{ type: "workspace/select", workspaceId: "ws-b" },
		);

		expect(state.activeWorkspaceId).toBe("ws-b");
		expect(state.workspacesById["ws-a"]?.hydrationState).toBe("inactiveLive");
		expect(state.workspacesById["ws-b"]?.hydrationState).toBe("active");
	});

	it("removes the active workspace and shifts active to first remaining", () => {
		let state: AppWorkspacesState = {
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a", "ws-b"],
			workspacesById: {
				"ws-a": {
					workspaceId: "ws-a",
					repository: repoA,
					worktrees: [],
					workspaceState: createWorkspaceState([]),
					persistedSnapshot: null,
					hydrationState: "active",
					loadError: null,
				},
				"ws-b": {
					workspaceId: "ws-b",
					repository: repoB,
					worktrees: [],
					workspaceState: null,
					persistedSnapshot: null,
					hydrationState: "dormant",
					loadError: null,
				},
			},
		};
		state = appWorkspacesReducer(state, {
			type: "workspace/remove",
			workspaceId: "ws-a",
		});
		expect(state.activeWorkspaceId).toBe("ws-b");
		expect(state.workspaceOrder).toEqual(["ws-b"]);
		expect(state.workspacesById["ws-a"]).toBeUndefined();
	});

	it("re-registering an existing workspaceId does not duplicate the order entry", () => {
		let state = createAppWorkspacesState();
		const wsA = {
			workspaceId: "ws-a",
			repository: repoA,
			worktrees: [],
			workspaceState: createWorkspaceState([]),
			persistedSnapshot: null,
			hydrationState: "active" as const,
			loadError: null,
		};
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: wsA,
		});
		state = appWorkspacesReducer(state, {
			type: "workspace/register",
			workspace: { ...wsA, worktrees: [] },
		});
		expect(state.workspaceOrder).toHaveLength(1);
		expect(state.workspaceOrder).toEqual(["ws-a"]);
	});

	it("selecting a non-existent workspaceId is a no-op", () => {
		const state: AppWorkspacesState = {
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a"],
			workspacesById: {
				"ws-a": {
					workspaceId: "ws-a",
					repository: repoA,
					worktrees: [],
					workspaceState: createWorkspaceState([]),
					persistedSnapshot: null,
					hydrationState: "active",
					loadError: null,
				},
			},
		};
		const next = appWorkspacesReducer(state, {
			type: "workspace/select",
			workspaceId: "ws-nonexistent",
		});
		expect(next).toBe(state);
	});
});
