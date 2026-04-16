import { describe, expect, it } from "vitest";
import type { Worktree } from "../../../shared/models/worktree";
import {
	DEFAULT_COMMAND_PRESETS,
	type CommandPreset,
} from "../../../shared/models/command-preset";
import {
	createWorkspaceState,
	workspaceReducer,
} from "../../../src/features/workspace/workspace-state";
import type { ProcessSession } from "../../../shared/models/process-session";

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

function makeProcess(
	id: string,
	worktreeId: string,
	label: string,
): ProcessSession {
	return {
		id,
		workspaceId: "ws-test",
		worktreeId,
		terminalSessionId: `terminal-${id}`,
		origin: "adHoc",
		presetId: null,
		label,
			command: null,
			status: "running",
			lastActivityAt: null,
			lastOutputPreview: null,
			exitCode: null,
			pinned: false,
			attentionState: "idle",
	};
}

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

	it("seeds fresh workspaces with default terminal presets", () => {
		const state = createWorkspaceState(worktrees);
		expect(state.commandPresets).toEqual(DEFAULT_COMMAND_PRESETS);
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
				workspaceId: "ws-test",
				worktreeId: "main",
				terminalSessionId: "term-1",
				origin: "adHoc",
				presetId: null,
				label: "shell 1",
					command: null,
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
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
				workspaceId: "ws-test",
				worktreeId: "main",
				terminalSessionId: "term-2",
				origin: "adHoc",
				presetId: null,
				label: "shell 2",
					command: null,
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
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

	it("updates a process label without changing process selection", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-1",
				workspaceId: "ws-test",
				worktreeId: "main",
				terminalSessionId: "term-1",
				origin: "adHoc",
				presetId: null,
				label: "shell 1",
					command: null,
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
					exitCode: null,
					pinned: false,
					attentionState: "idle",
			},
		});

		state = workspaceReducer(state, {
			type: "session/updateProcessLabel",
			processId: "process-1",
			label: "codex",
		});

		expect(state.processSessionsById["process-1"]?.label).toBe("codex");
		expect(state.sessionsByWorktreeId.main.activeProcessSessionId).toBe(
			"process-1",
		);
	});
});

describe("workspaceReducer — Phase 4 review state", () => {
	it("records git summary fetch error per worktree session", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/cacheGitSummaryFailure",
			worktreeId: "main",
			message: "git error",
		});
		expect(state.sessionsByWorktreeId.main.gitSummaryError).toBe(true);
		expect(state.sessionsByWorktreeId.main.gitSummary).toBeNull();
	});

	it("clears git summary error on successful fetch", () => {
		let state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/cacheGitSummaryFailure",
			worktreeId: "main",
			message: "git error",
		});
		state = workspaceReducer(state, {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "main",
			gitSummary: {
				branchName: "main",
				isDirty: false,
				changedFileCount: 0,
				changedFiles: [],
				recentCommits: [],
			},
		});
		expect(state.sessionsByWorktreeId.main.gitSummaryError).toBe(false);
	});

	it("stores cached git summary per worktree session", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/cacheGitSummarySuccess",
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

describe("workspaceReducer — Phase 3 process model", () => {
	it("stores repo-level presets", () => {
		const initial = createWorkspaceState(worktrees);
		const state = workspaceReducer(initial, {
			type: "preset/upsert",
			preset,
		});
		expect(state.commandPresets).toEqual([
			...DEFAULT_COMMAND_PRESETS,
			preset,
		]);
	});

	it("registers preset-launched process sessions as pinned", () => {
		const initial = createWorkspaceState(worktrees);
		const state = workspaceReducer(initial, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "process-1",
				workspaceId: "ws-test",
				worktreeId: "main",
				terminalSessionId: "terminal-1",
				origin: "preset",
				presetId: "preset-claude",
				label: "Claude",
					command: "claude",
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
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
				workspaceId: "ws-test",
				worktreeId: "main",
				terminalSessionId: "terminal-1",
				origin: "preset",
				presetId: "preset-claude",
				label: "Claude",
					command: "claude",
					status: "running",
					lastActivityAt: null,
					lastOutputPreview: null,
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

	it("stores the latest output preview when a chunk yields a complete line", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-1", "main", "shell 1"),
		});

		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "process-1",
			attentionState: "activity",
			at: 1_000,
			isViewed: false,
			lastOutputPreview: "compiled in 124ms",
		});

		expect(state.processSessionsById["process-1"]?.lastOutputPreview).toBe(
			"compiled in 124ms",
		);
	});

	it("keeps the prior preview when an output chunk has no useful preview", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				...makeProcess("process-1", "main", "shell 1"),
				lastOutputPreview: "compiled in 124ms",
			},
		});

		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "process-1",
			attentionState: "activity",
			at: 2_000,
			isViewed: false,
			lastOutputPreview: undefined,
		});

		expect(state.processSessionsById["process-1"]?.lastOutputPreview).toBe(
			"compiled in 124ms",
		);
	});

	it("keeps actionRequired latched until the process is viewed", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-1", "main", "shell 1"),
		});

		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "process-1",
			attentionState: "actionRequired",
			at: 1_000,
			isViewed: false,
			lastOutputPreview: "Continue? [y/N]",
		});
		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "process-1",
			attentionState: "activity",
			at: 2_000,
			isViewed: false,
			lastOutputPreview: "compiled in 124ms",
		});

		expect(state.processSessionsById["process-1"]?.attentionState).toBe(
			"actionRequired",
		);
	});
});

describe("workspaceReducer — git summary stale state", () => {
	const worktree: Worktree = {
		id: "wt1",
		repositoryId: "r1",
		branchName: "main",
		path: "/repo",
		label: "main",
		isMain: true,
	};

	const summary = {
		branchName: "main",
		isDirty: true,
		changedFileCount: 1,
		changedFiles: [{ path: "src/index.ts", status: "M" as const }],
		recentCommits: [{ sha: "abc", shortSha: "abc", subject: "initial commit" }],
	};

	it("marks the existing git summary stale instead of clearing it on refresh failure", () => {
		const loaded = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "wt1",
			gitSummary: summary,
		});

		const next = workspaceReducer(loaded, {
			type: "session/cacheGitSummaryFailure",
			worktreeId: "wt1",
			message: "git error",
		});

		expect(next.sessionsByWorktreeId.wt1.gitSummary).toEqual(summary);
		expect(next.sessionsByWorktreeId.wt1.gitSummaryStale).toBe(true);
		expect(next.sessionsByWorktreeId.wt1.gitSummaryMessage).toMatch(/showing last successful result/i);
	});

	it("session/startGitSummaryRefresh clears the message when not already stale", () => {
		const state = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/startGitSummaryRefresh",
			worktreeId: "wt1",
		});

		expect(state.sessionsByWorktreeId.wt1.gitSummaryMessage).toBeNull();
	});

	it("session/startGitSummaryRefresh preserves the message when already stale", () => {
		const withSummary = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "wt1",
			gitSummary: summary,
		});
		const stale = workspaceReducer(withSummary, {
			type: "session/cacheGitSummaryFailure",
			worktreeId: "wt1",
			message: "git error",
		});

		const next = workspaceReducer(stale, {
			type: "session/startGitSummaryRefresh",
			worktreeId: "wt1",
		});

		expect(next.sessionsByWorktreeId.wt1.gitSummaryStale).toBe(true);
		expect(next.sessionsByWorktreeId.wt1.gitSummaryMessage).not.toBeNull();
	});

	it("session/cacheGitSummarySuccess clears stale/error/message fields", () => {
		const withSummary = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "wt1",
			gitSummary: summary,
		});
		const stale = workspaceReducer(withSummary, {
			type: "session/cacheGitSummaryFailure",
			worktreeId: "wt1",
			message: "git error",
		});

		const newSummary = { ...summary, changedFileCount: 2 };
		const next = workspaceReducer(stale, {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "wt1",
			gitSummary: newSummary,
		});

		expect(next.sessionsByWorktreeId.wt1.gitSummaryError).toBe(false);
		expect(next.sessionsByWorktreeId.wt1.gitSummaryStale).toBe(false);
		expect(next.sessionsByWorktreeId.wt1.gitSummaryMessage).toBeNull();
		expect(next.sessionsByWorktreeId.wt1.gitSummary).toEqual(newSummary);
	});

	it("session/cacheGitSummarySuccess invalidates selectedChangedFilePath if the file is no longer in the new summary", () => {
		let state = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "wt1",
			gitSummary: summary,
		});
		state = workspaceReducer(state, {
			type: "session/selectChangedFile",
			worktreeId: "wt1",
			relativePath: "src/index.ts",
		});

		const next = workspaceReducer(state, {
			type: "session/cacheGitSummarySuccess",
			worktreeId: "wt1",
			gitSummary: { ...summary, changedFiles: [], changedFileCount: 0 },
		});

		expect(next.sessionsByWorktreeId.wt1.selectedChangedFilePath).toBeNull();
	});

	it("session/cacheGitSummaryFailure with no previous summary sets gitSummaryError=true and gitSummaryStale=false", () => {
		const next = workspaceReducer(createWorkspaceState([worktree]), {
			type: "session/cacheGitSummaryFailure",
			worktreeId: "wt1",
			message: "git error",
		});

		expect(next.sessionsByWorktreeId.wt1.gitSummaryError).toBe(true);
		expect(next.sessionsByWorktreeId.wt1.gitSummaryStale).toBe(false);
		expect(next.sessionsByWorktreeId.wt1.gitSummary).toBeNull();
	});
});

describe("workspaceReducer — Phase 7 worktree reconciliation", () => {
	it("reconciles discovered worktrees while preserving surviving session state", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/setNote",
			worktreeId: "feature-a",
			note: "keep me",
		});
		state = workspaceReducer(state, {
			type: "workspace/reconcileWorktrees",
			worktrees: [
				worktrees[0],
				{
					id: "feature-b",
					repositoryId: "repo-1",
					branchName: "feature-b",
					path: "/repo/.worktrees/feature-b",
					label: "feature-b",
					isMain: false,
				},
			],
		});

		expect(state.sessionsByWorktreeId.main).toBeDefined();
		expect(state.sessionsByWorktreeId["feature-a"]).toBeUndefined();
		expect(state.sessionsByWorktreeId["feature-b"].note).toBe("");
	});

	it("falls back to the main worktree when the selected worktree disappears", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectWorktree",
			worktreeId: "feature-a",
		});
		state = workspaceReducer(state, {
			type: "workspace/reconcileWorktrees",
			worktrees: [worktrees[0]],
		});

		expect(state.selectedWorktreeId).toBe("main");
	});
});

describe("workspaceReducer — split shell mode", () => {
	it("tracks split layout mode and explicit slot assignment per worktree session", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-1", "main", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-2", "main", "shell 2"),
		});
		state = workspaceReducer(state, {
			type: "session/setTerminalLayoutMode",
			worktreeId: "main",
			layoutMode: "split",
		});
		state = workspaceReducer(state, {
			type: "session/assignProcessToSplitSlot",
			worktreeId: "main",
			processId: "process-1",
			slot: "left",
		});
		state = workspaceReducer(state, {
			type: "session/assignProcessToSplitSlot",
			worktreeId: "main",
			processId: "process-2",
			slot: "right",
		});

		expect(state.sessionsByWorktreeId.main.terminalLayoutMode).toBe("split");
		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBe("process-1");
		expect(state.sessionsByWorktreeId.main.splitRightProcessId).toBe("process-2");
	});

	it("auto-assigns exactly two processes when enabling split mode with empty slots", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-1", "main", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-2", "main", "shell 2"),
		});
		state = workspaceReducer(state, {
			type: "session/setTerminalLayoutMode",
			worktreeId: "main",
			layoutMode: "split",
			autoAssignProcessIds: ["process-1", "process-2"],
		});

		expect(state.sessionsByWorktreeId.main.terminalLayoutMode).toBe("split");
		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBe("process-1");
		expect(state.sessionsByWorktreeId.main.splitRightProcessId).toBe("process-2");
	});

	it("keeps existing split assignments when enabling split mode again", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-1", "main", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-2", "main", "shell 2"),
		});
		state = workspaceReducer(state, {
			type: "session/assignProcessToSplitSlot",
			worktreeId: "main",
			processId: "process-2",
			slot: "left",
		});
		state = workspaceReducer(state, {
			type: "session/assignProcessToSplitSlot",
			worktreeId: "main",
			processId: "process-1",
			slot: "right",
		});
		state = workspaceReducer(state, {
			type: "session/setTerminalLayoutMode",
			worktreeId: "main",
			layoutMode: "single",
		});
		state = workspaceReducer(state, {
			type: "session/setTerminalLayoutMode",
			worktreeId: "main",
			layoutMode: "split",
			autoAssignProcessIds: ["process-1", "process-2"],
		});

		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBe("process-2");
		expect(state.sessionsByWorktreeId.main.splitRightProcessId).toBe("process-1");
	});

	it("clears split slots that reference a closed process", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("process-1", "main", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/setTerminalLayoutMode",
			worktreeId: "main",
			layoutMode: "split",
		});
		state = workspaceReducer(state, {
			type: "session/assignProcessToSplitSlot",
			worktreeId: "main",
			processId: "process-1",
			slot: "left",
		});
		state = workspaceReducer(state, {
			type: "session/closeProcess",
			worktreeId: "main",
			processId: "process-1",
		});

		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBeNull();
		expect(state.sessionsByWorktreeId.main.terminalLayoutMode).toBe("split");
	});
});

describe("workspaceReducer — Phase 6 commit review state", () => {
	it("switches into commit review mode when selecting a commit", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectCommit",
			worktreeId: "main",
			sha: "abc1234",
		});

		expect(state.sessionsByWorktreeId.main.reviewMode).toBe("commits");
		expect(state.sessionsByWorktreeId.main.viewerMode).toBe("commit");
		expect(state.sessionsByWorktreeId.main.selectedCommitSha).toBe("abc1234");
	});

	it("records the focused file within a selected commit", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectCommit",
			worktreeId: "main",
			sha: "abc1234",
		});
		state = workspaceReducer(state, {
			type: "session/selectCommitFile",
			worktreeId: "main",
			relativePath: "src/index.ts",
		});

		expect(state.sessionsByWorktreeId.main.selectedCommitFilePath).toBe(
			"src/index.ts",
		);
	});
});

describe("workspaceReducer — Phase 6 top-band collapse", () => {
	it("stores and restores the top-band collapse flag", () => {
		const worktrees = [
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		];

		let state = createWorkspaceState(worktrees);
		expect(state.topBandCollapsed).toBe(false);

		state = workspaceReducer(state, {
			type: "workspace/setTopBandCollapsed",
			collapsed: true,
		});
		expect(state.topBandCollapsed).toBe(true);

		state = workspaceReducer(state, {
			type: "workspace/restoreSnapshot",
			worktrees,
			workspaceId: "ws-test",
			snapshot: {
				repositoryPath: "/repo",
				repoId: null,
				selectedWorktreeId: "main",
				topBandCollapsed: true,
				commandPresets: [],
				worktreeSessions: [],
			},
		});

		expect(state.topBandCollapsed).toBe(true);
	});
});

describe("session/setTreeExpandedPaths", () => {
	it("updates treeExpandedPaths on the target session only", () => {
		const wtA: Worktree = { id: "wt-a", repositoryId: "repo-1", branchName: "a", path: "/tmp/a", label: "a", isMain: true };
		const wtB: Worktree = { id: "wt-b", repositoryId: "repo-1", branchName: "b", path: "/tmp/b", label: "b", isMain: false };
		const initial = createWorkspaceState([wtA, wtB]);
		const next = workspaceReducer(initial, { type: "session/setTreeExpandedPaths", worktreeId: "wt-a", paths: ["", "src"] });
		expect(next.sessionsByWorktreeId["wt-a"].treeExpandedPaths).toEqual(["", "src"]);
		expect(next.sessionsByWorktreeId["wt-b"].treeExpandedPaths).toEqual([]);
	});

	it("is a no-op when the worktreeId is unknown", () => {
		const wtA: Worktree = { id: "wt-a", repositoryId: "repo-1", branchName: "a", path: "/tmp/a", label: "a", isMain: true };
		const initial = createWorkspaceState([wtA]);
		const next = workspaceReducer(initial, { type: "session/setTreeExpandedPaths", worktreeId: "wt-does-not-exist", paths: ["x"] });
		expect(next).toBe(initial);
	});

	it("drops treeExpandedPaths when workspace/reconcileWorktrees removes that worktree (spec §4.6)", () => {
		const wtA: Worktree = { id: "wt-a", repositoryId: "repo-1", branchName: "a", path: "/tmp/a", label: "a", isMain: true };
		const wtB: Worktree = { id: "wt-b", repositoryId: "repo-1", branchName: "b", path: "/tmp/b", label: "b", isMain: false };
		let state = createWorkspaceState([wtA, wtB]);
		state = workspaceReducer(state, { type: "session/setTreeExpandedPaths", worktreeId: "wt-b", paths: ["", "src"] });
		expect(state.sessionsByWorktreeId["wt-b"].treeExpandedPaths).toEqual(["", "src"]);

		const after = workspaceReducer(state, { type: "workspace/reconcileWorktrees", worktrees: [wtA] });

		expect(after.sessionsByWorktreeId["wt-b"]).toBeUndefined();
		expect(after.sessionsByWorktreeId["wt-a"].treeExpandedPaths).toEqual([]);
	});
});

describe("treeExpandedPaths defaults", () => {
	it("initializes treeExpandedPaths to an empty array on a fresh session", () => {
		const worktree: Worktree = {
			id: "wt-1",
			repositoryId: "repo-1",
			branchName: "main",
			path: "/tmp/wt-1",
			label: "main",
			isMain: true,
		};
		const state = createWorkspaceState([worktree]);
		expect(state.sessionsByWorktreeId["wt-1"].treeExpandedPaths).toEqual([]);
	});
});

describe("workspaceReducer — Phase 5 persistence restore", () => {
	it("restores the selected worktree session from a snapshot", () => {
		const state = workspaceReducer(createWorkspaceState([]), {
			type: "workspace/restoreSnapshot",
			worktrees,
			workspaceId: "ws-test",
			snapshot: {
				repositoryPath: "/repo",
				repoId: null,
				topBandCollapsed: false,
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
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						terminalLayoutMode: "single" as const,
						splitLeftProcessId: null,
						splitRightProcessId: null,
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
								terminalSessionId: null,
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
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "feature-a",
				note: "later",
				reviewMode: "files",
				viewerMode: "file",
				selectedFilePath: "src/new-file.ts",
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
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
						terminalSessionId: null,
					},
				],
			},
		});

		expect(state.sessionsByWorktreeId["feature-a"].selectedFilePath).toBe("src/new-file.ts");
		expect(state.nextAdHocNumberByWorktreeId["feature-a"]).toBe(4);
		expect(state.processSessionsById["process-2"]?.status).toBe("restarting");
	});

	it("restores selectedCommitSha and reviewMode from a persisted commit-review snapshot", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "main",
				note: "",
				reviewMode: "commits",
				viewerMode: "commit",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: "abc1234",
				selectedCommitFilePath: "src/index.ts",
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				activeProcessSessionId: null,
				nextAdHocNumber: 1,
				processSessions: [],
			},
		});

		expect(state.sessionsByWorktreeId.main.reviewMode).toBe("commits");
		expect(state.sessionsByWorktreeId.main.viewerMode).toBe("commit");
		expect(state.sessionsByWorktreeId.main.selectedCommitSha).toBe("abc1234");
		expect(state.sessionsByWorktreeId.main.selectedCommitFilePath).toBe("src/index.ts");
	});

	it("clamps activeProcessSessionId when it no longer matches a restored process", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "feature-a",
				note: "",
				reviewMode: "files",
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				activeProcessSessionId: "orphan-id", // not in processSessions
				nextAdHocNumber: 2,
				processSessions: [
					{
						id: "process-1",
						origin: "adHoc",
						presetId: null,
						label: "shell 1",
						command: null,
						pinned: false,
						terminalSessionId: null,
					},
				],
			},
		});

		expect(state.sessionsByWorktreeId["feature-a"].activeProcessSessionId).toBe("process-1");
	});
});
