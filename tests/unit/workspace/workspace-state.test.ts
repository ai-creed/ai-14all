import { describe, expect, it } from "vitest";
import type { Worktree } from "../../../shared/models/worktree";
import {
	DEFAULT_COMMAND_PRESETS,
	type CommandPreset,
} from "../../../shared/models/command-preset";
import {
	createWorkspaceState,
	workspaceReducer,
} from "../../../src/features/workspace/logic/workspace-state";
import type { ProcessSession } from "../../../shared/models/process-session";
import { PersistedWorktreeSessionSchema } from "../../../shared/models/persisted-workspace-state";

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
	overrides: Partial<ProcessSession> = {},
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
		agentAttentionReasons: {},
		agentAttentionClearedAt: null,
		agentDetected: false,
		...overrides,
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
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
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
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
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
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
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

describe("workspaceReducer — agentDetected lifecycle", () => {
	it("sets agentDetected when label transitions to a known agent name", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "shell 1"),
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(false);

		state = workspaceReducer(state, {
			type: "session/updateProcessLabel",
			processId: "p1",
			label: "claude",
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(true);
	});

	it("keeps agentDetected sticky when an agent CLI overwrites its OSC title", () => {
		// Simulates Claude CLI setting the terminal title to the user's prompt
		// after first declaring itself as "claude" — detection must not flip off.
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "claude", { agentDetected: true }),
		});

		state = workspaceReducer(state, {
			type: "session/updateProcessLabel",
			processId: "p1",
			label: "write me a funny joke",
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(true);
	});

	it("detects via label first-token even when label carries flags", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "shell 1"),
		});

		state = workspaceReducer(state, {
			type: "session/updateProcessLabel",
			processId: "p1",
			label: "claude --print",
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(true);
	});

	it("resets agentDetected when status leaves running", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "claude", { agentDetected: true }),
		});

		for (const status of ["exited", "error", "restarting"] as const) {
			const next = workspaceReducer(state, {
				type: "session/updateProcessStatus",
				processId: "p1",
				status,
				exitCode: status === "exited" ? 0 : null,
			});
			expect(next.processSessionsById["p1"]?.agentDetected).toBe(false);
		}
	});

	it("re-detects on status return to running for a known agent command", () => {
		// Preset processes carry their command — when restart brings status back
		// to "running", the command-based detection re-establishes agentDetected.
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "Claude", {
				command: "claude",
				origin: "preset",
				presetId: "preset-claude",
				pinned: true,
				agentDetected: true,
			}),
		});

		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "p1",
			status: "exited",
			exitCode: 0,
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(false);

		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "p1",
			status: "running",
			exitCode: null,
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(true);
	});

	it("does not re-detect on running for an adHoc shell whose label was overwritten", () => {
		// The OSC title set by the agent CLI is gone once the shell exits; the
		// adHoc process has command=null and a non-agent fallback label, so
		// re-detection requires fresh OSC output from the new shell incarnation.
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "p1",
			status: "running",
			exitCode: null,
		});
		expect(state.processSessionsById["p1"]?.agentDetected).toBe(false);
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
		expect(state.commandPresets).toEqual([...DEFAULT_COMMAND_PRESETS, preset]);
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
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
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
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
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

	it("escalates attentionState when agentReason indicates waiting/failed even if action.attentionState is lower", () => {
		// Mirrors the Claude CLI case: "Do you want to create X?" doesn't match
		// the legacy actionRequiredPatterns (so deriveAttentionState yields
		// "activity"), but classifyOutput detects the trailing "?" as waiting
		// and packages it as an agentReason. The dot must escalate to
		// actionRequired so the sidebar reflects the prompt.
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "claude", { agentDetected: true }),
		});

		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "p1",
			attentionState: "activity",
			at: 1_000,
			isViewed: false,
			agentReason: {
				state: "waiting",
				source: "terminal",
				summary: "Do you want to create funny.md?",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		expect(state.processSessionsById["p1"]?.attentionState).toBe(
			"actionRequired",
		);
		expect(state.sessionsByWorktreeId.main.attentionState).toBe(
			"actionRequired",
		);
	});

	it("does not downgrade attentionState when agentReason maps lower than action.attentionState", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "claude", { agentDetected: true }),
		});

		// action says actionRequired (legacy pattern matched), agentReason is
		// only "active" (maps to activity). The max is actionRequired.
		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "p1",
			attentionState: "actionRequired",
			at: 1_000,
			isViewed: false,
			agentReason: {
				state: "active",
				source: "terminal",
				summary: "compiling",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		expect(state.processSessionsById["p1"]?.attentionState).toBe(
			"actionRequired",
		);
	});

	it("respects isViewed suppression even when agentReason would escalate", () => {
		// Viewing the process suppresses dot escalation regardless of source —
		// agent reasons still record (so context text updates), but the dot
		// stays put so the user isn't pestered about something they're looking at.
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "claude", { agentDetected: true }),
		});

		state = workspaceReducer(state, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId: "p1",
			attentionState: "activity",
			at: 1_000,
			isViewed: true,
			agentReason: {
				state: "waiting",
				source: "terminal",
				summary: "?",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		expect(state.processSessionsById["p1"]?.attentionState).toBe("idle");
		expect(
			state.processSessionsById["p1"]?.agentAttentionReasons.terminal?.state,
		).toBe("waiting");
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
		expect(next.sessionsByWorktreeId.wt1.gitSummaryMessage).toMatch(
			/showing last successful result/i,
		);
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
		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBe(
			"process-1",
		);
		expect(state.sessionsByWorktreeId.main.splitRightProcessId).toBe(
			"process-2",
		);
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
		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBe(
			"process-1",
		);
		expect(state.sessionsByWorktreeId.main.splitRightProcessId).toBe(
			"process-2",
		);
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

		expect(state.sessionsByWorktreeId.main.splitLeftProcessId).toBe(
			"process-2",
		);
		expect(state.sessionsByWorktreeId.main.splitRightProcessId).toBe(
			"process-1",
		);
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

describe("session/setTreeExpandedPaths", () => {
	it("updates treeExpandedPaths on the target session only", () => {
		const wtA: Worktree = {
			id: "wt-a",
			repositoryId: "repo-1",
			branchName: "a",
			path: "/tmp/a",
			label: "a",
			isMain: true,
		};
		const wtB: Worktree = {
			id: "wt-b",
			repositoryId: "repo-1",
			branchName: "b",
			path: "/tmp/b",
			label: "b",
			isMain: false,
		};
		const initial = createWorkspaceState([wtA, wtB]);
		const next = workspaceReducer(initial, {
			type: "session/setTreeExpandedPaths",
			worktreeId: "wt-a",
			paths: ["", "src"],
		});
		expect(next.sessionsByWorktreeId["wt-a"].treeExpandedPaths).toEqual([
			"",
			"src",
		]);
		expect(next.sessionsByWorktreeId["wt-b"].treeExpandedPaths).toEqual([]);
	});

	it("is a no-op when the worktreeId is unknown", () => {
		const wtA: Worktree = {
			id: "wt-a",
			repositoryId: "repo-1",
			branchName: "a",
			path: "/tmp/a",
			label: "a",
			isMain: true,
		};
		const initial = createWorkspaceState([wtA]);
		const next = workspaceReducer(initial, {
			type: "session/setTreeExpandedPaths",
			worktreeId: "wt-does-not-exist",
			paths: ["x"],
		});
		expect(next).toBe(initial);
	});

	it("drops treeExpandedPaths when workspace/reconcileWorktrees removes that worktree (spec §4.6)", () => {
		const wtA: Worktree = {
			id: "wt-a",
			repositoryId: "repo-1",
			branchName: "a",
			path: "/tmp/a",
			label: "a",
			isMain: true,
		};
		const wtB: Worktree = {
			id: "wt-b",
			repositoryId: "repo-1",
			branchName: "b",
			path: "/tmp/b",
			label: "b",
			isMain: false,
		};
		let state = createWorkspaceState([wtA, wtB]);
		state = workspaceReducer(state, {
			type: "session/setTreeExpandedPaths",
			worktreeId: "wt-b",
			paths: ["", "src"],
		});
		expect(state.sessionsByWorktreeId["wt-b"].treeExpandedPaths).toEqual([
			"",
			"src",
		]);

		const after = workspaceReducer(state, {
			type: "workspace/reconcileWorktrees",
			worktrees: [wtA],
		});

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
				selectedWorktreeId: "feature-a",
				commandPresets: [preset],
				worktreeSessions: [
					{
						worktreeId: "feature-a",
						title: "",
						note: "resume here",
						reviewMode: "changes",
						reviewDrawerOpen: false,
						viewerMode: "diff",
						selectedFilePath: null,
						selectedChangedFilePath: "src/index.ts",
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						terminalLayoutMode: "single" as const,
						splitLeftProcessId: null,
						splitRightProcessId: null,
						reviewSidebarWidth: 280,
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
		expect(state.sessionsByWorktreeId["feature-a"].activeProcessSessionId).toBe(
			"process-1",
		);
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
				title: "",
				note: "later",
				reviewMode: "files",
				reviewDrawerOpen: false,
				viewerMode: "file",
				selectedFilePath: "src/new-file.ts",
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				reviewSidebarWidth: 280,
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

		expect(state.sessionsByWorktreeId["feature-a"].selectedFilePath).toBe(
			"src/new-file.ts",
		);
		expect(state.nextAdHocNumberByWorktreeId["feature-a"]).toBe(4);
		expect(state.processSessionsById["process-2"]?.status).toBe("restarting");
	});

	it("restores selectedCommitSha and reviewMode from a persisted commit-review snapshot", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "main",
				title: "",
				note: "",
				reviewMode: "commits",
				reviewDrawerOpen: false,
				viewerMode: "commit",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: "abc1234",
				selectedCommitFilePath: "src/index.ts",
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				reviewSidebarWidth: 280,
				activeProcessSessionId: null,
				nextAdHocNumber: 1,
				processSessions: [],
			},
		});

		expect(state.sessionsByWorktreeId.main.reviewMode).toBe("commits");
		expect(state.sessionsByWorktreeId.main.viewerMode).toBe("commit");
		expect(state.sessionsByWorktreeId.main.selectedCommitSha).toBe("abc1234");
		expect(state.sessionsByWorktreeId.main.selectedCommitFilePath).toBe(
			"src/index.ts",
		);
	});

	it("clamps activeProcessSessionId when it no longer matches a restored process", () => {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "feature-a",
				title: "",
				note: "",
				reviewMode: "files",
				reviewDrawerOpen: false,
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				reviewSidebarWidth: 280,
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

		expect(state.sessionsByWorktreeId["feature-a"].activeProcessSessionId).toBe(
			"process-1",
		);
	});
});

describe("persistence omits treeExpandedPaths", () => {
	it("is not a key in the persisted schema shape (guards §4.6)", () => {
		expect(Object.keys(PersistedWorktreeSessionSchema.shape)).not.toContain(
			"treeExpandedPaths",
		);
	});

	it("strips treeExpandedPaths from parse output even if supplied", () => {
		const persisted = PersistedWorktreeSessionSchema.parse({
			worktreeId: "wt-a",
			note: "",
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: null,
			selectedChangedFilePath: null,
			activeProcessSessionId: null,
			nextAdHocNumber: 1,
			processSessions: [],
			treeExpandedPaths: ["", "src"],
		});
		expect(persisted).not.toHaveProperty("treeExpandedPaths");
	});
});

describe("createWorkspaceState title default", () => {
	it("creates sessions with an empty title, not the worktree label", () => {
		const state = createWorkspaceState(worktrees);
		expect(state.sessionsByWorktreeId["main"].title).toBe("");
		expect(state.sessionsByWorktreeId["feature-a"].title).toBe("");
	});
});

describe("restorePersistedSession title hydration", () => {
	it("hydrates title from a new-format snapshot", () => {
		const initial = createWorkspaceState(worktrees);
		const snapshot = PersistedWorktreeSessionSchema.parse({
			worktreeId: "main",
			title: "Auth rewrite",
			note: "",
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: null,
			selectedChangedFilePath: null,
			activeProcessSessionId: null,
			nextAdHocNumber: 1,
			processSessions: [],
		});
		const next = workspaceReducer(initial, {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot,
		});
		expect(next.sessionsByWorktreeId["main"].title).toBe("Auth rewrite");
	});

	it("hydrates an old snapshot (no title key) to an empty title without visual change", () => {
		const initial = createWorkspaceState(worktrees);
		const snapshot = PersistedWorktreeSessionSchema.parse({
			worktreeId: "main",
			note: "",
			reviewMode: "files",
			viewerMode: "file",
			selectedFilePath: null,
			selectedChangedFilePath: null,
			activeProcessSessionId: null,
			nextAdHocNumber: 1,
			processSessions: [],
		});
		const next = workspaceReducer(initial, {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot,
		});
		expect(next.sessionsByWorktreeId["main"].title).toBe("");
	});
});

describe("session/setTitle", () => {
	it("stores a trimmed custom title", () => {
		const initial = createWorkspaceState(worktrees);
		const next = workspaceReducer(initial, {
			type: "session/setTitle",
			worktreeId: "main",
			title: "  Launch prep  ",
		});
		expect(next.sessionsByWorktreeId["main"].title).toBe("Launch prep");
	});

	it("treats whitespace-only input as clearing the title", () => {
		const initial = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/setTitle",
			worktreeId: "main",
			title: "temp",
		});
		const cleared = workspaceReducer(initial, {
			type: "session/setTitle",
			worktreeId: "main",
			title: "   ",
		});
		expect(cleared.sessionsByWorktreeId["main"].title).toBe("");
	});

	it("is a no-op for unknown worktrees", () => {
		const initial = createWorkspaceState(worktrees);
		const next = workspaceReducer(initial, {
			type: "session/setTitle",
			worktreeId: "does-not-exist",
			title: "x",
		});
		expect(next).toBe(initial);
	});
});

describe("session/reportProcessAgentAttention", () => {
	it("writes per-source terminal reason and remaps legacy attention to actionRequired", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("proc-attn-1", "main", "shell 1"),
		});

		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-attn-1",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1000,
			},
		});

		expect(
			state.processSessionsById["proc-attn-1"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("waiting");
		expect(state.processSessionsById["proc-attn-1"]?.attentionState).toBe(
			"actionRequired",
		);
		expect(state.sessionsByWorktreeId["main"].attentionState).toBe(
			"actionRequired",
		);
	});

	it("does not downgrade same-source reason when later signal is weaker", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("proc-attn-2", "main", "shell 2"),
		});

		// First dispatch: strong signal (waiting)
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-attn-2",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1000,
			},
		});

		// Second dispatch: weaker signal (active)
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-attn-2",
			reason: {
				source: "terminal",
				state: "active",
				summary: "running",
				nextAction: null,
				reportedAt: 2000,
			},
		});

		expect(
			state.processSessionsById["proc-attn-2"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("waiting");
		expect(state.processSessionsById["proc-attn-2"]?.attentionState).toBe(
			"actionRequired",
		);
	});

	it("rejects mcp source at process-level and returns unchanged state", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("proc-attn-3", "main", "shell 3"),
		});

		const before = state;
		const after = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-attn-3",
			reason: {
				source: "mcp",
				state: "waiting",
				summary: "mcp signal",
				nextAction: null,
				reportedAt: 1000,
			},
		});

		expect(after).toBe(before);
	});
});

describe("session/reportAgentAttention", () => {
	it("sets MCP reason on the worktree session", () => {
		const initial = createWorkspaceState(worktrees);
		const next = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "implementation complete",
				nextAction: null,
				reportedAt: 5_000,
			},
		});
		expect(
			next.sessionsByWorktreeId["main"].agentAttentionReasons.mcp?.state,
		).toBe("ready");
		// attentionState is intentionally not updated here — session reasons are
		// overlayed at render time by buildWorktreeAttentionDisplay (see Task 15)
		expect(next.sessionsByWorktreeId["main"].attentionState).toBe(
			initial.sessionsByWorktreeId["main"].attentionState,
		);
	});

	it("rejects non-mcp source and returns unchanged state", () => {
		const initial = createWorkspaceState(worktrees);
		const next = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "waiting",
				source: "terminal",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(next).toBe(initial);
	});

	it("does not downgrade same-source reason when later signal is weaker", () => {
		const initial = createWorkspaceState(worktrees);
		const withWaiting = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "waiting",
				source: "mcp",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		const afterDowngrade = workspaceReducer(withWaiting, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "running",
				nextAction: null,
				reportedAt: 2_000,
			},
		});
		expect(
			afterDowngrade.sessionsByWorktreeId["main"].agentAttentionReasons.mcp
				?.state,
		).toBe("waiting");
	});
});

describe("session/recordProcessOutput agentReason", () => {
	function seedWithProcess(processId: string) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess(processId, "main", "shell rpo"),
		});
		return state;
	}

	it("stores terminal agentReason when provided", () => {
		const processId = "proc-rpo-1";
		const seeded = seedWithProcess(processId);
		const next = workspaceReducer(seeded, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId,
			attentionState: "actionRequired",
			at: 10_000,
			isViewed: false,
			lastOutputPreview: "Continue? [y/N]",
			agentReason: {
				state: "waiting",
				source: "terminal",
				summary: "y/n prompt",
				nextAction: null,
				reportedAt: 10_000,
			},
		});
		expect(
			next.processSessionsById[processId]?.agentAttentionReasons.terminal
				?.state,
		).toBe("waiting");
	});

	it("leaves agentAttentionReasons unchanged when agentReason is absent", () => {
		const processId = "proc-rpo-2";
		const seeded = seedWithProcess(processId);
		const seededWithReason = workspaceReducer(seeded, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId,
			reason: {
				state: "waiting",
				source: "terminal",
				summary: "y/n",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		const next = workspaceReducer(seededWithReason, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId,
			attentionState: "activity",
			at: 11_000,
			isViewed: false,
			lastOutputPreview: "compiling",
			// no agentReason
		});
		expect(
			next.processSessionsById[processId]?.agentAttentionReasons.terminal
				?.state,
		).toBe("waiting");
	});

	it("does not replace existing stronger reason (same-source downgrade guard)", () => {
		const processId = "proc-rpo-3";
		const seeded = workspaceReducer(seedWithProcess(processId), {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId,
			reason: {
				state: "waiting",
				source: "terminal",
				summary: "y/n",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		const next = workspaceReducer(seeded, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId,
			attentionState: "activity",
			at: 12_000,
			isViewed: false,
			lastOutputPreview: "compiling",
			agentReason: {
				state: "active",
				source: "terminal",
				summary: "compiling",
				nextAction: null,
				reportedAt: 12_000,
			},
		});
		expect(
			next.processSessionsById[processId]?.agentAttentionReasons.terminal
				?.state,
		).toBe("waiting");
	});

	it("silently ignores mcp source in agentReason", () => {
		const processId = "proc-rpo-4";
		const seeded = seedWithProcess(processId);
		const next = workspaceReducer(seeded, {
			type: "session/recordProcessOutput",
			worktreeId: "main",
			processId,
			attentionState: "activity",
			at: 13_000,
			isViewed: false,
			agentReason: {
				state: "waiting",
				source: "mcp",
				summary: "mcp signal",
				nextAction: null,
				reportedAt: 13_000,
			},
		});
		expect(next.processSessionsById[processId]?.agentAttentionReasons).toEqual(
			{},
		);
	});
});

describe("session/clearProcessAgentAttention", () => {
	function seedWithReasons(processId: string, worktreeId: string) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId,
			process: makeProcess(processId, worktreeId, "shell clear"),
		});
		// seed lifecycle:failed
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId,
			processId,
			reason: {
				source: "lifecycle",
				state: "failed",
				summary: "process crashed",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		// seed terminal:waiting
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId,
			processId,
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 2_000,
			},
		});
		return state;
	}

	it("without sticky: retains failed reasons, removes others, stamps agentAttentionClearedAt", () => {
		const processId = "proc-clear-1";
		const seeded = seedWithReasons(processId, "main");
		const next = workspaceReducer(seeded, {
			type: "session/clearProcessAgentAttention",
			worktreeId: "main",
			processId,
			sticky: false,
			clearedAt: 5_000,
		});
		const proc = next.processSessionsById[processId];
		expect(proc?.agentAttentionReasons.lifecycle?.state).toBe("failed");
		expect(proc?.agentAttentionReasons.terminal).toBeUndefined();
		expect(proc?.agentAttentionClearedAt).toBe(5_000);
	});

	it("with sticky=true: clears all reasons including failed", () => {
		const processId = "proc-clear-2";
		const seeded = seedWithReasons(processId, "main");
		const next = workspaceReducer(seeded, {
			type: "session/clearProcessAgentAttention",
			worktreeId: "main",
			processId,
			sticky: true,
			clearedAt: 5_000,
		});
		const proc = next.processSessionsById[processId];
		expect(proc?.agentAttentionReasons).toEqual({});
		expect(proc?.agentAttentionClearedAt).toBe(5_000);
	});

	it("updates attentionState to reflect remaining reasons after clear", () => {
		const processId = "proc-clear-3";
		const seeded = seedWithReasons(processId, "main");
		expect(seeded.processSessionsById[processId]?.attentionState).toBe(
			"actionRequired",
		);

		const next = workspaceReducer(seeded, {
			type: "session/clearProcessAgentAttention",
			worktreeId: "main",
			processId,
			sticky: true,
			clearedAt: 5_000,
		});
		expect(next.processSessionsById[processId]?.attentionState).toBe("idle");
	});

	it("recalculates worktree attentionState after clear", () => {
		const processId = "proc-clear-4";
		const seeded = seedWithReasons(processId, "main");
		expect(seeded.sessionsByWorktreeId["main"].attentionState).toBe(
			"actionRequired",
		);

		const next = workspaceReducer(seeded, {
			type: "session/clearProcessAgentAttention",
			worktreeId: "main",
			processId,
			sticky: true,
			clearedAt: 5_000,
		});
		expect(next.sessionsByWorktreeId["main"].attentionState).toBe("idle");
	});
});

describe("session/clearSessionAgentAttention", () => {
	it("removes session-level mcp reason", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				source: "mcp",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(
			state.sessionsByWorktreeId["main"].agentAttentionReasons.mcp,
		).toBeDefined();

		const next = workspaceReducer(state, {
			type: "session/clearSessionAgentAttention",
			worktreeId: "main",
		});
		expect(next.sessionsByWorktreeId["main"].agentAttentionReasons).toEqual({});
	});
});

describe("agentAttentionReasons defaults", () => {
	it("new worktree session has agentAttentionReasons: {}", () => {
		const state = createWorkspaceState(worktrees);
		expect(state.sessionsByWorktreeId["main"].agentAttentionReasons).toEqual(
			{},
		);
		expect(
			state.sessionsByWorktreeId["feature-a"].agentAttentionReasons,
		).toEqual({});
	});

	it("newly registered process has agentAttentionReasons: {} and agentAttentionClearedAt: null", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: {
				id: "proc-1",
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
				agentAttentionReasons: {},
				agentAttentionClearedAt: null,
				agentDetected: false,
			},
		});
		const proc = state.processSessionsById["proc-1"];
		expect(proc).toBeDefined();
		expect(proc!.agentAttentionReasons).toEqual({});
		expect(proc!.agentAttentionClearedAt).toBeNull();
	});
});

describe("restore resets agentAttentionReasons", () => {
	it("workspace/restoreSnapshot resets agentAttentionReasons on worktree sessions", () => {
		// Seed a mcp reason on the main worktree session
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				source: "mcp",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(
			state.sessionsByWorktreeId["main"].agentAttentionReasons.mcp,
		).toBeDefined();

		// Restore from snapshot
		state = workspaceReducer(state, {
			type: "workspace/restoreSnapshot",
			worktrees,
			workspaceId: "ws-test",
			snapshot: {
				repositoryPath: "/repo",
				repoId: null,
				selectedWorktreeId: "main",
				commandPresets: [],
				worktreeSessions: [
					{
						worktreeId: "main",
						title: "",
						note: "restored",
						reviewMode: "files",
						reviewDrawerOpen: false,
						viewerMode: "file",
						selectedFilePath: null,
						selectedChangedFilePath: null,
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						terminalLayoutMode: "single" as const,
						splitLeftProcessId: null,
						splitRightProcessId: null,
						reviewSidebarWidth: 280,
						activeProcessSessionId: null,
						nextAdHocNumber: 1,
						processSessions: [],
					},
				],
			},
		});

		expect(state.sessionsByWorktreeId["main"].agentAttentionReasons).toEqual(
			{},
		);
	});

	it("workspace/restoreSnapshot resets agentAttentionReasons and agentAttentionClearedAt on process sessions", () => {
		// Seed process with terminal reason and agentAttentionClearedAt
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("proc-restore-1", "main", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-restore-1",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/clearProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-restore-1",
			sticky: true,
			clearedAt: 2_000,
		});
		expect(
			state.processSessionsById["proc-restore-1"]?.agentAttentionClearedAt,
		).toBe(2_000);

		// Restore from snapshot (process-1 is in persisted list)
		state = workspaceReducer(state, {
			type: "workspace/restoreSnapshot",
			worktrees,
			workspaceId: "ws-test",
			snapshot: {
				repositoryPath: "/repo",
				repoId: null,
				selectedWorktreeId: "main",
				commandPresets: [],
				worktreeSessions: [
					{
						worktreeId: "main",
						title: "",
						note: "",
						reviewMode: "files",
						reviewDrawerOpen: false,
						viewerMode: "file",
						selectedFilePath: null,
						selectedChangedFilePath: null,
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						terminalLayoutMode: "single" as const,
						splitLeftProcessId: null,
						splitRightProcessId: null,
						reviewSidebarWidth: 280,
						activeProcessSessionId: "proc-restore-1",
						nextAdHocNumber: 2,
						processSessions: [
							{
								id: "proc-restore-1",
								origin: "adHoc",
								presetId: null,
								label: "shell 1",
								command: null,
								pinned: false,
								terminalSessionId: null,
							},
						],
					},
				],
			},
		});

		const proc = state.processSessionsById["proc-restore-1"];
		expect(proc?.agentAttentionReasons).toEqual({});
		expect(proc?.agentAttentionClearedAt).toBeNull();
	});

	it("session/restoreSnapshot resets agentAttentionReasons on worktree sessions", () => {
		// Seed mcp reason
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "feature-a",
			reason: {
				source: "mcp",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(
			state.sessionsByWorktreeId["feature-a"].agentAttentionReasons.mcp,
		).toBeDefined();

		state = workspaceReducer(state, {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "feature-a",
				title: "",
				note: "lazy restore",
				reviewMode: "files",
				reviewDrawerOpen: false,
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				reviewSidebarWidth: 280,
				activeProcessSessionId: null,
				nextAdHocNumber: 1,
				processSessions: [],
			},
		});

		expect(
			state.sessionsByWorktreeId["feature-a"].agentAttentionReasons,
		).toEqual({});
	});

	it("session/restoreSnapshot resets agentAttentionReasons and agentAttentionClearedAt on process sessions", () => {
		// Seed process with terminal reason + cleared timestamp
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "feature-a",
			process: makeProcess("proc-restore-2", "feature-a", "shell 1"),
		});
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "feature-a",
			processId: "proc-restore-2",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "awaiting input",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/clearProcessAgentAttention",
			worktreeId: "feature-a",
			processId: "proc-restore-2",
			sticky: true,
			clearedAt: 3_000,
		});
		expect(
			state.processSessionsById["proc-restore-2"]?.agentAttentionClearedAt,
		).toBe(3_000);

		state = workspaceReducer(state, {
			type: "session/restoreSnapshot",
			workspaceId: "ws-test",
			snapshot: {
				worktreeId: "feature-a",
				title: "",
				note: "",
				reviewMode: "files",
				reviewDrawerOpen: false,
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				terminalLayoutMode: "single" as const,
				splitLeftProcessId: null,
				splitRightProcessId: null,
				reviewSidebarWidth: 280,
				activeProcessSessionId: "proc-restore-2",
				nextAdHocNumber: 2,
				processSessions: [
					{
						id: "proc-restore-2",
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

		const proc = state.processSessionsById["proc-restore-2"];
		expect(proc?.agentAttentionReasons).toEqual({});
		expect(proc?.agentAttentionClearedAt).toBeNull();
	});
});
