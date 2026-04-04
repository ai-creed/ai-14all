import { describe, expect, it } from "vitest";
import type { Worktree } from "../../../shared/models/worktree";
import type { CommandPreset } from "../../../shared/models/command-preset";
import {
	createWorkspaceState,
	workspaceReducer,
} from "../../../src/features/workspace/workspace-state";

const worktrees: Worktree[] = [
	{
		id: "main",
		repositoryId: "repo-1",
		branchName: "main",
		path: "/repo",
		label: "main",
		isMain: true,
	},
	{
		id: "feature-a",
		repositoryId: "repo-1",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		label: "feature-a",
		isMain: false,
	},
];

const preset: CommandPreset = {
	id: "preset-claude",
	label: "Claude",
	command: "claude",
};

describe("workspaceReducer", () => {
	it("creates a session per worktree and selects the first worktree on load", () => {
		const state = workspaceReducer(createWorkspaceState([]), {
			type: "workspace/loadWorktrees",
			worktrees,
		});
		expect(state.selectedWorktreeId).toBe("main");
		expect(state.sessionsByWorktreeId.main.reviewMode).toBe("files");
		expect(state.sessionsByWorktreeId["feature-a"].note).toBe("");
	});

	it("restores worktree-specific selections when switching between sessions", () => {
		let state = workspaceReducer(createWorkspaceState([]), {
			type: "workspace/loadWorktrees",
			worktrees,
		});
		state = workspaceReducer(state, {
			type: "session/selectFile",
			worktreeId: "main",
			relativePath: "src/index.ts",
		});
		state = workspaceReducer(state, {
			type: "session/selectWorktree",
			worktreeId: "feature-a",
		});
		state = workspaceReducer(state, {
			type: "session/setNote",
			worktreeId: "feature-a",
			note: "Investigate diff output",
		});
		state = workspaceReducer(state, {
			type: "session/selectWorktree",
			worktreeId: "main",
		});

		expect(state.sessionsByWorktreeId.main.selectedFilePath).toBe(
			"src/index.ts",
		);
		expect(state.sessionsByWorktreeId["feature-a"].note).toBe(
			"Investigate diff output",
		);
	});

	it("assigns ad-hoc shell labels and updates active process selection", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-1",
				worktreeId: "main",
				terminalSessionId: "term-1",
				origin: "adHoc",
				presetId: null,
				label: "shell 1",
				command: null,
				status: "running",
				lastActivityAt: null,
				exitCode: null,
				pinned: false,
				attentionState: "idle",
			},
		});
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-2",
				worktreeId: "main",
				terminalSessionId: "term-2",
				origin: "adHoc",
				presetId: null,
				label: "shell 2",
				command: null,
				status: "running",
				lastActivityAt: null,
				exitCode: null,
				pinned: false,
				attentionState: "idle",
			},
		});
		state = workspaceReducer(state, {
			type: "session/closeProcess",
			worktreeId: "main",
			processId: "process-2",
		});

		expect(state.sessionsByWorktreeId.main.processSessionIds).toEqual([
			"process-1",
		]);
		expect(state.sessionsByWorktreeId.main.activeProcessSessionId).toBe(
			"process-1",
		);
	});
});

describe("workspaceReducer — Phase 4 review state", () => {
	it("records git summary fetch error per worktree session", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/cacheGitSummary",
			worktreeId: "main",
			gitSummary: null,
			error: true,
		});
		expect(state.sessionsByWorktreeId.main.gitSummaryError).toBe(true);
		expect(state.sessionsByWorktreeId.main.gitSummary).toBeNull();
	});

	it("clears git summary error on successful fetch", () => {
		let state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/cacheGitSummary",
			worktreeId: "main",
			gitSummary: null,
			error: true,
		});
		state = workspaceReducer(state, {
			type: "session/cacheGitSummary",
			worktreeId: "main",
			gitSummary: {
				branchName: "main",
				isDirty: false,
				changedFileCount: 0,
				changedFiles: [],
				recentCommits: [],
			},
			error: false,
		});
		expect(state.sessionsByWorktreeId.main.gitSummaryError).toBe(false);
	});

	it("stores cached git summary per worktree session", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/cacheGitSummary",
			worktreeId: "main",
			gitSummary: {
				branchName: "main",
				isDirty: true,
				changedFileCount: 1,
				changedFiles: [{ path: "src/index.ts", status: "M" }],
				recentCommits: [
					{ sha: "abc", shortSha: "abc", subject: "initial commit" },
				],
			},
			error: false,
		});

		expect(state.sessionsByWorktreeId.main.gitSummary?.changedFileCount).toBe(
			1,
		);
	});

	it("sets viewer mode to diff when selecting a changed file", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectFile",
			worktreeId: "main",
			relativePath: "src/index.ts",
		});
		state = workspaceReducer(state, {
			type: "session/selectChangedFile",
			worktreeId: "main",
			relativePath: "src/index.ts",
		});

		expect(state.sessionsByWorktreeId.main.viewerMode).toBe("diff");
		expect(state.sessionsByWorktreeId.main.selectedChangedFilePath).toBe(
			"src/index.ts",
		);
	});

	it("switches viewer mode with the selected review target", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectChangedFile",
			worktreeId: "main",
			relativePath: "src/index.ts",
		});
		state = workspaceReducer(state, {
			type: "session/selectFile",
			worktreeId: "main",
			relativePath: "src/new-file.ts",
		});

		expect(state.sessionsByWorktreeId.main.viewerMode).toBe("file");
		expect(state.sessionsByWorktreeId.main.selectedFilePath).toBe(
			"src/new-file.ts",
		);
	});
});

describe("workspaceReducer — Phase 5 persistence restore", () => {
	it("restores the selected worktree session from a snapshot", () => {
		let state = workspaceReducer(createWorkspaceState([]), {
			type: "workspace/restoreSnapshot",
			worktrees,
			snapshot: {
				repositoryPath: "/repo",
				selectedWorktreeId: "feature-a",
				commandPresets: [preset],
				worktreeSessions: [
					{
						worktreeId: "feature-a",
						note: "resume here",
						reviewMode: "changes",
						viewerMode: "diff",
						selectedFilePath: null,
						selectedChangedFilePath: "src/index.ts",
						activeProcessSessionId: "process-1",
						nextAdHocNumber: 2,
						processSessions: [
							{
								id: "process-1",
								origin: "preset",
								presetId: "preset-claude",
								label: "Claude",
								command: "claude",
								pinned: true,
							},
						],
					},
				],
			},
		});

		expect(state.selectedWorktreeId).toBe("feature-a");
		expect(state.commandPresets).toEqual([preset]);
		expect(state.sessionsByWorktreeId["feature-a"].note).toBe("resume here");
		expect(state.sessionsByWorktreeId["feature-a"].activeProcessSessionId).toBe("process-1");
		expect(state.processSessionsById["process-1"]).toMatchObject({
			terminalSessionId: null,
			status: "restarting",
			label: "Claude",
			command: "claude",
		});
	});

	it("lazily restores a non-selected worktree session", () => {
		let state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/restoreSnapshot",
			snapshot: {
				worktreeId: "feature-a",
				note: "later",
				reviewMode: "files",
				viewerMode: "file",
				selectedFilePath: "src/new-file.ts",
				selectedChangedFilePath: null,
				activeProcessSessionId: "process-2",
				nextAdHocNumber: 4,
				processSessions: [
					{
						id: "process-2",
						origin: "adHoc",
						presetId: null,
						label: "shell 3",
						command: null,
						pinned: false,
					},
				],
			},
		});

		expect(state.sessionsByWorktreeId["feature-a"].selectedFilePath).toBe("src/new-file.ts");
		expect(state.nextAdHocNumberByWorktreeId["feature-a"]).toBe(4);
		expect(state.processSessionsById["process-2"]?.status).toBe("restarting");
	});
});

describe("workspaceReducer — Phase 3 process model", () => {
	it("stores repo-level presets", () => {
		const initial = createWorkspaceState(worktrees);
		const state = workspaceReducer(initial, {
			type: "preset/upsert",
			preset,
		});
		expect(state.commandPresets).toEqual([preset]);
	});

	it("registers preset-launched process sessions as pinned", () => {
		const initial = createWorkspaceState(worktrees);
		const state = workspaceReducer(initial, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-1",
				worktreeId: "main",
				terminalSessionId: "terminal-1",
				origin: "preset",
				presetId: "preset-claude",
				label: "Claude",
				command: "claude",
				status: "running",
				lastActivityAt: null,
				exitCode: null,
				pinned: true,
				attentionState: "idle",
			},
		});
		expect(state.processSessionsById["process-1"]?.pinned).toBe(true);
		expect(state.sessionsByWorktreeId.main.activeProcessSessionId).toBe(
			"process-1",
		);
	});

	it("rolls action-required attention up to the worktree session", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-1",
				worktreeId: "main",
				terminalSessionId: "terminal-1",
				origin: "preset",
				presetId: "preset-claude",
				label: "Claude",
				command: "claude",
				status: "running",
				lastActivityAt: null,
				exitCode: null,
				pinned: true,
				attentionState: "idle",
			},
		});
		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "process-1",
			attentionState: "actionRequired",
			at: 1_234,
			isViewed: false,
		});
		expect(state.sessionsByWorktreeId.main.attentionState).toBe(
			"actionRequired",
		);
	});
});
