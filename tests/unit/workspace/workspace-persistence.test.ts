import { describe, expect, it } from "vitest";
import { buildWorkspaceSnapshot, splitPendingRestores } from "../../../src/features/workspace/workspace-persistence";
import { createWorkspaceState, workspaceReducer } from "../../../src/features/workspace/workspace-state";
import { PersistedWorkspaceStateSchema } from "../../../shared/models/persisted-workspace-state";

describe("buildWorkspaceSnapshot", () => {
	it("serializes only restore-worthy workspace state", () => {
		let state = createWorkspaceState([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-1",
				worktreeId: "main",
				terminalSessionId: "terminal-live",
				origin: "adHoc",
				presetId: null,
				label: "shell 1",
				command: null,
				status: "running",
				lastActivityAt: 1234,
				exitCode: null,
				pinned: false,
				attentionState: "actionRequired",
			},
		});
		state = workspaceReducer(state, {
			type: "session/setNote",
			worktreeId: "main",
			note: "resume here",
		});

		const snapshot = buildWorkspaceSnapshot("/repo", state);

		expect(snapshot).toEqual({
			repositoryPath: "/repo",
			selectedWorktreeId: "main",
			topBandCollapsed: false,
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "main",
					note: "resume here",
					reviewMode: "files",
					viewerMode: "file",
					selectedFilePath: null,
					selectedChangedFilePath: null,
					selectedCommitSha: null,
					selectedCommitFilePath: null,
					activeProcessSessionId: "process-1",
					nextAdHocNumber: 2,
					processSessions: [
						{
							id: "process-1",
							origin: "adHoc",
							presetId: null,
							label: "shell 1",
							command: null,
							pinned: false,
						},
					],
				},
			],
		});
	});

	it("returns empty worktreeSessions and null selectedWorktreeId for empty state", () => {
		const snapshot = buildWorkspaceSnapshot("/repo", createWorkspaceState([]));
		expect(snapshot.worktreeSessions).toEqual([]);
		expect(snapshot.selectedWorktreeId).toBeNull();
	});
});

it("serializes commit review selections into the workspace snapshot", () => {
	let state = createWorkspaceState([
		{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
	]);
	state = workspaceReducer(state, {
		type: "session/selectCommit",
		worktreeId: "feature-a",
		sha: "abc1234",
	});
	state = workspaceReducer(state, {
		type: "session/selectCommitFile",
		worktreeId: "feature-a",
		relativePath: "src/index.ts",
	});

	expect(buildWorkspaceSnapshot("/repo", state).worktreeSessions[0]).toMatchObject({
		selectedCommitSha: "abc1234",
		selectedCommitFilePath: "src/index.ts",
		reviewMode: "commits",
		viewerMode: "commit",
	});
});

it("keeps older phase-5 snapshots readable by defaulting commit fields to null", () => {
	const parsed = PersistedWorkspaceStateSchema.parse({
		version: 1,
		restorePreference: "prompt",
		snapshot: {
			repositoryPath: "/repo",
			selectedWorktreeId: "feature-a",
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "feature-a",
					note: "",
					reviewMode: "files",
					viewerMode: "file",
					selectedFilePath: null,
					selectedChangedFilePath: null,
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [],
				},
			],
		},
	});

	expect(parsed.snapshot?.worktreeSessions[0]?.selectedCommitSha).toBeNull();
	expect(parsed.snapshot?.worktreeSessions[0]?.selectedCommitFilePath).toBeNull();
});

describe("splitPendingRestores", () => {
	it("keeps only non-selected worktrees in the pending restore map", () => {
		const snapshot = {
			repositoryPath: "/repo",
			selectedWorktreeId: "feature-a",
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "main",
					note: "main note",
					reviewMode: "files" as const,
					viewerMode: "file" as const,
					selectedFilePath: "README.md",
					selectedChangedFilePath: null,
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [],
				},
				{
					worktreeId: "feature-a",
					note: "feature note",
					reviewMode: "changes" as const,
					viewerMode: "diff" as const,
					selectedFilePath: null,
					selectedChangedFilePath: "src/index.ts",
					activeProcessSessionId: "process-2",
					nextAdHocNumber: 3,
					processSessions: [],
				},
			],
		};

		expect(splitPendingRestores(snapshot)).toEqual({
			selectedSession: snapshot.worktreeSessions[1],
			pendingByWorktreeId: { main: snapshot.worktreeSessions[0] },
		});
	});

	it("puts all sessions in pendingByWorktreeId when selectedWorktreeId is null", () => {
		const snapshot = {
			repositoryPath: "/repo",
			selectedWorktreeId: null,
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "main",
					note: "",
					reviewMode: "files" as const,
					viewerMode: "file" as const,
					selectedFilePath: null,
					selectedChangedFilePath: null,
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [],
				},
			],
		};

		const result = splitPendingRestores(snapshot);
		expect(result.selectedSession).toBeNull();
		expect(result.pendingByWorktreeId).toEqual({ main: snapshot.worktreeSessions[0] });
	});
});
