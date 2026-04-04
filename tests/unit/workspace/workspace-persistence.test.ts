import { describe, expect, it } from "vitest";
import { buildWorkspaceSnapshot, splitPendingRestores } from "../../../src/features/workspace/workspace-persistence";
import { createWorkspaceState, workspaceReducer } from "../../../src/features/workspace/workspace-state";

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
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "main",
					note: "resume here",
					reviewMode: "files",
					viewerMode: "file",
					selectedFilePath: null,
					selectedChangedFilePath: null,
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
});
