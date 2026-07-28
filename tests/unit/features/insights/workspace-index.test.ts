import { describe, expect, it } from "vitest";
import {
	PersistedWorkspaceStateV2Schema,
	type PersistedWorktreeSession,
} from "../../../../shared/models/persisted-workspace-state";
import { workspaceIndexFromRestoreState } from "../../../../src/features/insights/workspaceIndex";

// Minimal PersistedWorktreeSessionSchema-valid object — required fields only,
// so the fixture below actually parses through the real zod schema (the
// point of this test: shape drift fails HERE, not at runtime).
function wtSession(id: string): PersistedWorktreeSession {
	return {
		worktreeId: id,
		title: "",
		note: "",
		reviewMode: "files",
		filesPaneMode: "files",
		viewerMode: "file",
		selectedFilePath: null,
		selectedChangedFilePath: null,
		selectedCommitSha: null,
		selectedCommitFilePath: null,
		activeProcessSessionId: null,
		reviewSidebarWidth: 280,
		reviewedFiles: [],
		reviewOverviewExpanded: false,
		nextAdHocNumber: 1,
		processSessions: [],
	};
}

describe("workspaceIndexFromRestoreState", () => {
	it("maps the real V2 state: one entry per workspace, basename title, session count, repoId", () => {
		const state = PersistedWorkspaceStateV2Schema.parse({
			// RestorePreferenceSchema enum: "prompt" | "alwaysRestore" | "alwaysStartClean"
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws1",
			workspaceOrder: ["ws1", "ws2"],
			workspaces: [
				{
					workspaceId: "ws1",
					repositoryPath: "/Users/dev/alpha",
					repoId: "r1",
					snapshot: {
						repositoryPath: "/Users/dev/alpha",
						repoId: "r1",
						selectedWorktreeId: null,
						commandPresets: [],
						worktreeSessions: [wtSession("a"), wtSession("b"), wtSession("c")],
					},
				},
				{
					workspaceId: "ws2",
					repositoryPath: "/Users/dev/beta/",
					repoId: null,
					snapshot: {
						repositoryPath: "/Users/dev/beta",
						repoId: null,
						selectedWorktreeId: null,
						commandPresets: [],
						worktreeSessions: [],
					},
				},
			],
		});

		expect(workspaceIndexFromRestoreState(state)).toEqual([
			{
				workspaceId: "ws1",
				title: "alpha",
				repoId: "r1",
				rootPath: "/Users/dev/alpha",
				worktreeCount: 3,
			},
			{
				workspaceId: "ws2",
				title: "beta",
				repoId: null,
				rootPath: "/Users/dev/beta/",
				worktreeCount: 1,
			},
		]);
	});

	it("returns an empty index for an empty workspaces array", () => {
		const state = PersistedWorkspaceStateV2Schema.parse({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
		expect(workspaceIndexFromRestoreState(state)).toEqual([]);
	});
});
