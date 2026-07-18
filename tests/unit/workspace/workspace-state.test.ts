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
	target: "pinned",
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
		provider: null,
		resumeCommand: null,
		resumePending: false,
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
				provider: null,
				resumeCommand: null,
				resumePending: false,
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
				provider: null,
				resumeCommand: null,
				resumePending: false,
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
				provider: null,
				resumeCommand: null,
				resumePending: false,
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

describe("workspaceReducer — code-nav pendingReveal", () => {
	it("stamps pendingReveal and paneTransient on selectFileAtLocation", () => {
		let state = createWorkspaceState(worktrees);
		expect(state.sessionsByWorktreeId.main.pendingReveal).toBeNull();
		expect(state.sessionsByWorktreeId.main.paneTransient).toBe(false);

		const before = Date.now();
		state = workspaceReducer(state, {
			type: "session/selectFileAtLocation",
			worktreeId: "main",
			relativePath: "src/config.ts",
			revealLine: 42,
			revealColumn: 7,
			transient: true,
		});
		const after = Date.now();

		const session = state.sessionsByWorktreeId.main;
		expect(session.reviewMode).toBe("files");
		expect(session.viewerMode).toBe("file");
		expect(session.selectedFilePath).toBe("src/config.ts");
		expect(session.paneTransient).toBe(true);
		expect(session.pendingReveal).not.toBeNull();
		expect(session.pendingReveal?.line).toBe(42);
		expect(session.pendingReveal?.column).toBe(7);
		expect(session.pendingReveal?.capturedAt).toBeGreaterThanOrEqual(before);
		expect(session.pendingReveal?.capturedAt).toBeLessThanOrEqual(after);
	});

	it("treats transient=false as a non-preview jump (no paneTransient)", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectFileAtLocation",
			worktreeId: "main",
			relativePath: "src/utils.ts",
			revealLine: 1,
			transient: false,
		});

		const session = state.sessionsByWorktreeId.main;
		expect(session.paneTransient).toBe(false);
		expect(session.pendingReveal?.column).toBeUndefined();
	});

	it("clears pendingReveal on consumePendingReveal but preserves paneTransient", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectFileAtLocation",
			worktreeId: "main",
			relativePath: "src/config.ts",
			revealLine: 10,
			transient: true,
		});
		state = workspaceReducer(state, {
			type: "session/consumePendingReveal",
			worktreeId: "main",
		});

		const session = state.sessionsByWorktreeId.main;
		expect(session.pendingReveal).toBeNull();
		expect(session.paneTransient).toBe(true);
	});

	it("consumePendingReveal is a no-op when pendingReveal is null", () => {
		const state = createWorkspaceState(worktrees);
		const next = workspaceReducer(state, {
			type: "session/consumePendingReveal",
			worktreeId: "main",
		});
		expect(next).toBe(state);
	});

	it("stamps navLocation with line/column on selectFileAtLocation", () => {
		let state = createWorkspaceState(worktrees);
		expect(state.sessionsByWorktreeId.main.navLocation).toBeNull();
		state = workspaceReducer(state, {
			type: "session/selectFileAtLocation",
			worktreeId: "main",
			relativePath: "src/config.ts",
			revealLine: 42,
			revealColumn: 7,
			transient: true,
		});
		expect(state.sessionsByWorktreeId.main.navLocation).toEqual({
			file: "src/config.ts",
			line: 42,
			column: 7,
		});
	});

	it("selectFile ends a transient preview and sets navLocation at file top", () => {
		let state = createWorkspaceState(worktrees);
		// Enter a transient preview via a definition jump.
		state = workspaceReducer(state, {
			type: "session/selectFileAtLocation",
			worktreeId: "main",
			relativePath: "src/config.ts",
			revealLine: 42,
			transient: true,
		});
		expect(state.sessionsByWorktreeId.main.paneTransient).toBe(true);

		// A deliberate tree click must clear the transient flag so the next
		// jump pushes history instead of replacing in place.
		state = workspaceReducer(state, {
			type: "session/selectFile",
			worktreeId: "main",
			relativePath: "src/other.ts",
		});
		const session = state.sessionsByWorktreeId.main;
		expect(session.paneTransient).toBe(false);
		expect(session.navLocation).toEqual({ file: "src/other.ts", line: 1 });
	});

	it("selectChangedFile clears transient flag and code-pane navLocation", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/selectFileAtLocation",
			worktreeId: "main",
			relativePath: "src/config.ts",
			revealLine: 42,
			transient: true,
		});
		state = workspaceReducer(state, {
			type: "session/selectChangedFile",
			worktreeId: "main",
			relativePath: "src/config.ts",
		});
		const session = state.sessionsByWorktreeId.main;
		expect(session.paneTransient).toBe(false);
		expect(session.navLocation).toBeNull();
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
				provider: null,
				resumeCommand: null,
				resumePending: false,
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
				provider: null,
				resumeCommand: null,
				resumePending: false,
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

describe("session/setTreeShowIgnored", () => {
	it("flips treeShowIgnored on the target session only", () => {
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
		expect(initial.sessionsByWorktreeId["wt-a"].treeShowIgnored).toBe(false);
		expect(initial.sessionsByWorktreeId["wt-b"].treeShowIgnored).toBe(false);
		const next = workspaceReducer(initial, {
			type: "session/setTreeShowIgnored",
			worktreeId: "wt-a",
			showIgnored: true,
		});
		expect(next.sessionsByWorktreeId["wt-a"].treeShowIgnored).toBe(true);
		expect(next.sessionsByWorktreeId["wt-b"].treeShowIgnored).toBe(false);
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
			type: "session/setTreeShowIgnored",
			worktreeId: "wt-does-not-exist",
			showIgnored: true,
		});
		expect(next).toBe(initial);
	});

	it("toggles back to false on a second dispatch", () => {
		const wtA: Worktree = {
			id: "wt-a",
			repositoryId: "repo-1",
			branchName: "a",
			path: "/tmp/a",
			label: "a",
			isMain: true,
		};
		let state = createWorkspaceState([wtA]);
		state = workspaceReducer(state, {
			type: "session/setTreeShowIgnored",
			worktreeId: "wt-a",
			showIgnored: true,
		});
		expect(state.sessionsByWorktreeId["wt-a"].treeShowIgnored).toBe(true);
		state = workspaceReducer(state, {
			type: "session/setTreeShowIgnored",
			worktreeId: "wt-a",
			showIgnored: false,
		});
		expect(state.sessionsByWorktreeId["wt-a"].treeShowIgnored).toBe(false);
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
						filesPaneMode: "files",
						viewerMode: "diff",
						selectedFilePath: null,
						selectedChangedFilePath: "src/index.ts",
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						reviewSidebarWidth: 280,
						reviewedFiles: [],
						reviewOverviewExpanded: false,
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
								resumeCommand: null,
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
				filesPaneMode: "files",
				viewerMode: "file",
				selectedFilePath: "src/new-file.ts",
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				reviewSidebarWidth: 280,
				reviewedFiles: [],
				reviewOverviewExpanded: false,
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
						resumeCommand: null,
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
				filesPaneMode: "files",
				viewerMode: "commit",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: "abc1234",
				selectedCommitFilePath: "src/index.ts",
				reviewSidebarWidth: 280,
				reviewedFiles: [],
				reviewOverviewExpanded: false,
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
				filesPaneMode: "files",
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				reviewSidebarWidth: 280,
				reviewedFiles: [],
				reviewOverviewExpanded: false,
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
						resumeCommand: null,
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
			filesPaneMode: "files",
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
			filesPaneMode: "files",
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
			filesPaneMode: "files",
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

	it("lets a newer same-source MCP push overwrite a stronger earlier reason", () => {
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
		const afterOverwrite = workspaceReducer(withWaiting, {
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
			afterOverwrite.sessionsByWorktreeId["main"].agentAttentionReasons.mcp
				?.state,
		).toBe("active");
	});
});

describe("session/reportAgentAttention — workflow source", () => {
	it("accepts the workflow source at session level and stores the reason", () => {
		const initial = createWorkspaceState(worktrees);
		const next = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "waiting",
				source: "workflow",
				summary: "workflow halted",
				nextAction: "open workflow details",
				reportedAt: 5_000,
			},
		});
		expect(
			next.sessionsByWorktreeId["main"].agentAttentionReasons.workflow,
		).toMatchObject({ state: "waiting", summary: "workflow halted" });
	});

	it("keeps an mcp reason alongside a workflow reason (ranked into the session)", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "running",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "waiting",
				source: "workflow",
				summary: "workflow halted",
				nextAction: "open workflow details",
				reportedAt: 2_000,
			},
		});
		const reasons = state.sessionsByWorktreeId["main"].agentAttentionReasons;
		expect(reasons.mcp?.state).toBe("active");
		expect(reasons.workflow?.state).toBe("waiting");
	});

	it("a workflow report does NOT clear stale terminal reasons (mcp-only side effect)", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("proc-wf", "main", "claude", {
				agentDetected: true,
			}),
		});
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-wf",
			reason: {
				source: "terminal",
				state: "failed",
				summary: "build error",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "workflow",
				summary: "workflow done",
				nextAction: null,
				reportedAt: 2_000,
			},
		});
		// The terminal failed reason must survive — only an mcp self-report
		// supersedes terminal heuristics, not a workflow report.
		expect(
			state.processSessionsById["proc-wf"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("failed");
	});
});

describe("session/reportAgentAttention — task field", () => {
	it("stores task on session when provided", () => {
		const initial = createWorkspaceState(worktrees);
		const next = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "working",
				nextAction: null,
				reportedAt: 1_000,
			},
			task: "Review spec X",
		});
		expect(next.sessionsByWorktreeId["main"].task).toBe("Review spec X");
	});

	it("clears task to null when explicit null pushed", () => {
		const initial = createWorkspaceState(worktrees);
		const seeded = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "working",
				nextAction: null,
				reportedAt: 1_000,
			},
			task: "Review spec X",
		});
		const cleared = workspaceReducer(seeded, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "still working",
				nextAction: null,
				reportedAt: 2_000,
			},
			task: null,
		});
		expect(cleared.sessionsByWorktreeId["main"].task).toBeNull();
	});

	it("leaves existing task unchanged when task is undefined", () => {
		const initial = createWorkspaceState(worktrees);
		const seeded = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "working",
				nextAction: null,
				reportedAt: 1_000,
			},
			task: "Review spec X",
		});
		const next = workspaceReducer(seeded, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "still working",
				nextAction: null,
				reportedAt: 2_000,
			},
		});
		expect(next.sessionsByWorktreeId["main"].task).toBe("Review spec X");
	});

	it("does not overwrite task when a stale/rejected MCP push arrives", () => {
		const initial = createWorkspaceState(worktrees);
		// Accepted push at reportedAt 2000 sets the visible task "Mission A".
		const seeded = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "running",
				nextAction: null,
				reportedAt: 2_000,
			},
			task: "Mission A",
		});
		expect(seeded.sessionsByWorktreeId["main"].task).toBe("Mission A");

		// Stale push: older reportedAt (1000 < 2000) → rejected by
		// shouldReplaceAgentAttentionReason. Its task must NOT clobber the
		// visible task, and the mcp reason must be unchanged — a fully no-op.
		const stale = workspaceReducer(seeded, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "waiting",
				source: "mcp",
				summary: "stale out-of-order report",
				nextAction: null,
				reportedAt: 1_000,
			},
			task: "Stale B",
		});
		expect(stale.sessionsByWorktreeId["main"].task).toBe("Mission A");
		expect(
			stale.sessionsByWorktreeId["main"].agentAttentionReasons.mcp,
		).toEqual(seeded.sessionsByWorktreeId["main"].agentAttentionReasons.mcp);
		expect(
			stale.sessionsByWorktreeId["main"].agentAttentionReasons.mcp?.state,
		).toBe("active");
	});

	it("updates task on an accepted (newer) MCP push", () => {
		const initial = createWorkspaceState(worktrees);
		const seeded = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "running",
				nextAction: null,
				reportedAt: 1_000,
			},
			task: "Mission A",
		});
		const next = workspaceReducer(seeded, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "waiting",
				source: "mcp",
				summary: "now waiting",
				nextAction: null,
				reportedAt: 2_000,
			},
			task: "Mission B",
		});
		expect(next.sessionsByWorktreeId["main"].task).toBe("Mission B");
	});
});

describe("session/reportAgentAttention — MCP push clears stale terminal failed", () => {
	function seedProcess(processId: string) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess(processId, "main", "claude", {
				agentDetected: true,
			}),
		});
		return state;
	}

	it("removes process terminal failed reason when MCP pushes non-failed state", () => {
		let state = seedProcess("proc-clear-1");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-clear-1",
			reason: {
				source: "terminal",
				state: "failed",
				summary: "build error",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(
			state.processSessionsById["proc-clear-1"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("failed");
		expect(state.processSessionsById["proc-clear-1"]?.attentionState).toBe(
			"actionRequired",
		);

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "implementation complete",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(
			state.processSessionsById["proc-clear-1"]?.agentAttentionReasons.terminal,
		).toBeUndefined();
		expect(state.processSessionsById["proc-clear-1"]?.attentionState).not.toBe(
			"actionRequired",
		);
	});

	it("preserves lifecycle failed reason when MCP pushes non-failed", () => {
		let state = seedProcess("proc-clear-2");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-clear-2",
			reason: {
				source: "lifecycle",
				state: "failed",
				summary: "process exited 1",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "done",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(
			state.processSessionsById["proc-clear-2"]?.agentAttentionReasons.lifecycle
				?.state,
		).toBe("failed");
	});

	it("does NOT clear terminal failed when MCP itself pushes failed", () => {
		let state = seedProcess("proc-clear-3");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-clear-3",
			reason: {
				source: "terminal",
				state: "failed",
				summary: "build error",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "failed",
				source: "mcp",
				summary: "task failed",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(
			state.processSessionsById["proc-clear-3"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("failed");
	});

	it("recomputes worktree-level attention state after clearing", () => {
		let state = seedProcess("proc-clear-4");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-clear-4",
			reason: {
				source: "terminal",
				state: "failed",
				summary: "build error",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(state.sessionsByWorktreeId["main"].attentionState).toBe(
			"actionRequired",
		);

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "done",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(state.sessionsByWorktreeId["main"].attentionState).not.toBe(
			"actionRequired",
		);
	});

	it("a rejected (older reportedAt) MCP push does NOT clear a fresh terminal failed", () => {
		let state = seedProcess("proc-clear-5");
		// Accept an MCP reason at reportedAt: 2000 so the session's mcp reason
		// has reportedAt 2000.
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "working",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		// Set the process's terminal reason to `failed` (fresh).
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-clear-5",
			reason: {
				source: "terminal",
				state: "failed",
				summary: "build error",
				nextAction: null,
				reportedAt: 3_000,
			},
		});
		expect(
			state.processSessionsById["proc-clear-5"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("failed");

		// Dispatch a stale MCP push (reportedAt 1000 < 2000 → rejected by
		// shouldReplaceAgentAttentionReason).
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "stale done",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		// The rejected push must have no clearing side effect.
		expect(
			state.processSessionsById["proc-clear-5"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("failed");
	});
});

describe("session/reportAgentAttention — MCP push supersedes stale terminal reason (RC2)", () => {
	function seedProcess(processId: string) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess(processId, "main", "claude", {
				agentDetected: true,
			}),
		});
		return state;
	}

	it("removes a stale terminal waiting reason when MCP pushes ready (the lying-card bug)", () => {
		let state = seedProcess("proc-rc2-1");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-rc2-1",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "answered prompt, never cleared",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(state.processSessionsById["proc-rc2-1"]?.attentionState).toBe(
			"actionRequired",
		);

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "task complete",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(
			state.processSessionsById["proc-rc2-1"]?.agentAttentionReasons.terminal,
		).toBeUndefined();
		expect(state.processSessionsById["proc-rc2-1"]?.attentionState).not.toBe(
			"actionRequired",
		);
		expect(state.sessionsByWorktreeId["main"].attentionState).not.toBe(
			"actionRequired",
		);
	});

	it("removes a stale terminal active reason when MCP pushes ready (perpetual-cooking)", () => {
		let state = seedProcess("proc-rc2-2");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-rc2-2",
			reason: {
				source: "terminal",
				state: "active",
				summary: "tui repaint",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "done",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(
			state.processSessionsById["proc-rc2-2"]?.agentAttentionReasons.terminal,
		).toBeUndefined();
	});

	it("keeps lifecycle failed but clears terminal waiting on MCP non-failed", () => {
		let state = seedProcess("proc-rc2-3");
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-rc2-3",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "stale prompt",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-rc2-3",
			reason: {
				source: "lifecycle",
				state: "failed",
				summary: "process exited 1",
				nextAction: null,
				reportedAt: 1_500,
			},
		});

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "done",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		expect(
			state.processSessionsById["proc-rc2-3"]?.agentAttentionReasons.terminal,
		).toBeUndefined();
		expect(
			state.processSessionsById["proc-rc2-3"]?.agentAttentionReasons.lifecycle
				?.state,
		).toBe("failed");
		expect(state.processSessionsById["proc-rc2-3"]?.attentionState).toBe(
			"actionRequired",
		);
	});

	it("a rejected (older reportedAt) MCP push does NOT clear a fresh terminal waiting", () => {
		let state = seedProcess("proc-rc2-4");
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "working",
				nextAction: null,
				reportedAt: 2_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/reportProcessAgentAttention",
			worktreeId: "main",
			processId: "proc-rc2-4",
			reason: {
				source: "terminal",
				state: "waiting",
				summary: "real prompt",
				nextAction: null,
				reportedAt: 3_000,
			},
		});

		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "stale done",
				nextAction: null,
				reportedAt: 1_000,
			},
		});

		expect(
			state.processSessionsById["proc-rc2-4"]?.agentAttentionReasons.terminal
				?.state,
		).toBe("waiting");
	});
});

describe("session/reportAgentAttention — same-source MCP overwrites without rank gate", () => {
	it("overwrites previous MCP waiting with later MCP active", () => {
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
		const withActive = workspaceReducer(withWaiting, {
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
			withActive.sessionsByWorktreeId["main"].agentAttentionReasons.mcp?.state,
		).toBe("active");
	});

	it("breaks ties with reportedAt — older push ignored", () => {
		const initial = createWorkspaceState(worktrees);
		const withReady = workspaceReducer(initial, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "ready",
				source: "mcp",
				summary: "done",
				nextAction: null,
				reportedAt: 2_000,
			},
		});
		const withStaleActive = workspaceReducer(withReady, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				state: "active",
				source: "mcp",
				summary: "running",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		expect(
			withStaleActive.sessionsByWorktreeId["main"].agentAttentionReasons.mcp
				?.state,
		).toBe("ready");
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

	it("removes only the requested source, leaving other reasons intact", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				source: "mcp",
				state: "active",
				summary: "running",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				source: "workflow",
				state: "waiting",
				summary: "halted",
				nextAction: null,
				reportedAt: 2_000,
			},
		});

		const next = workspaceReducer(state, {
			type: "session/clearSessionAgentAttention",
			worktreeId: "main",
			source: "workflow",
		});
		expect(
			next.sessionsByWorktreeId["main"].agentAttentionReasons.workflow,
		).toBeUndefined();
		expect(
			next.sessionsByWorktreeId["main"].agentAttentionReasons.mcp?.state,
		).toBe("active");
	});

	it("is a no-op state identity when clearing a source that is not present", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: {
				source: "mcp",
				state: "active",
				summary: "running",
				nextAction: null,
				reportedAt: 1_000,
			},
		});
		const next = workspaceReducer(state, {
			type: "session/clearSessionAgentAttention",
			worktreeId: "main",
			source: "workflow",
		});
		expect(next).toBe(state);
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
				provider: null,
				resumeCommand: null,
				resumePending: false,
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
						filesPaneMode: "files",
						viewerMode: "file",
						selectedFilePath: null,
						selectedChangedFilePath: null,
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						reviewSidebarWidth: 280,
						reviewedFiles: [],
						reviewOverviewExpanded: false,
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
						filesPaneMode: "files",
						viewerMode: "file",
						selectedFilePath: null,
						selectedChangedFilePath: null,
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						reviewSidebarWidth: 280,
						reviewedFiles: [],
						reviewOverviewExpanded: false,
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
								resumeCommand: null,
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
				filesPaneMode: "files",
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				reviewSidebarWidth: 280,
				reviewedFiles: [],
				reviewOverviewExpanded: false,
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
				filesPaneMode: "files",
				viewerMode: "file",
				selectedFilePath: null,
				selectedChangedFilePath: null,
				selectedCommitSha: null,
				selectedCommitFilePath: null,
				reviewSidebarWidth: 280,
				reviewedFiles: [],
				reviewOverviewExpanded: false,
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
						resumeCommand: null,
					},
				],
			},
		});

		const proc = state.processSessionsById["proc-restore-2"];
		expect(proc?.agentAttentionReasons).toEqual({});
		expect(proc?.agentAttentionClearedAt).toBeNull();
	});
});

describe("session and process models — new fields", () => {
	it("creates worktree session with task = null by default", () => {
		const state = workspaceReducer(createWorkspaceState([]), {
			type: "workspace/loadWorktrees",
			worktrees,
		});
		expect(state.sessionsByWorktreeId.main.task).toBeNull();
	});

	it("registers a process session with provider = null by default", () => {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("p1", "main", "shell 1"),
		});
		expect(state.processSessionsById.p1.provider).toBeNull();
	});
});

describe("session/reportAgentAttention and session/updateProcessStatus — agentAttentionClearedAt advancement", () => {
	// Helper: seed a session with a session-level reason via reportAgentAttention.
	function seedSessionWithReason(reason: {
		state: "waiting" | "active" | "ready" | "failed";
		source: "mcp" | "workflow";
		summary: string;
		nextAction: string | null;
		reportedAt: number;
	}) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason,
		});
		return state;
	}

	// Helper: seed a session with a session-level reason AND a registered process.
	function seedSessionWithReasonAndProcess(
		reason: {
			state: "waiting" | "active" | "ready" | "failed";
			source: "mcp" | "workflow";
			summary: string;
			nextAction: string | null;
			reportedAt: number;
		},
		proc: {
			processId: string;
			lastActivityAt: number | null;
			status: ProcessSession["status"];
		},
	) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess(proc.processId, "main", "shell", {
				lastActivityAt: proc.lastActivityAt,
				status: proc.status,
			}),
		});
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason,
		});
		return state;
	}

	// Helper: return the "main" worktree id (the worktree used in all seeding helpers above).
	function onlyWorktreeId(_state: ReturnType<typeof createWorkspaceState>) {
		return "main";
	}

	it("advances agentAttentionClearedAt when an accepted ready reason arrives", () => {
		// Arrange: a session already carrying a stale mcp:waiting (reportedAt 1000).
		let state = seedSessionWithReason({
			state: "waiting",
			source: "mcp",
			summary: "?",
			nextAction: null,
			reportedAt: 1000,
		});
		const worktreeId = onlyWorktreeId(state);

		// Act: a workflow-source ready (done) at reportedAt 2000.
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId,
			reason: {
				state: "ready",
				source: "workflow",
				summary: "workflow done",
				nextAction: null,
				reportedAt: 2000,
			},
		});

		// Assert.
		expect(state.sessionsByWorktreeId[worktreeId].agentAttentionClearedAt).toBe(
			2000,
		);
	});

	it("advances agentAttentionClearedAt to the exit EVENT time on process exit", () => {
		// Arrange: a session with an mcp:waiting (reportedAt 1200) reported AFTER the
		// process's last activity (1100) but BEFORE the exit (1500). Using lastActivityAt
		// would fail to retire it; using the exit event time retires it.
		let state = seedSessionWithReasonAndProcess(
			{
				state: "waiting",
				source: "mcp",
				summary: "?",
				nextAction: null,
				reportedAt: 1200,
			},
			{ processId: "p1", lastActivityAt: 1100, status: "running" },
		);
		const worktreeId = onlyWorktreeId(state);

		// Act: the process exits at event time 1500.
		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "p1",
			status: "exited",
			exitCode: 0,
			at: 1500,
		});

		// Assert: the clear timestamp is the exit event time (1500), NOT lastActivityAt
		// (1100) — so the mcp:waiting (reportedAt 1200) is retired.
		expect(state.sessionsByWorktreeId[worktreeId].agentAttentionClearedAt).toBe(
			1500,
		);
	});

	it("falls back to lastActivityAt when process exits without an `at` timestamp", () => {
		// Arrange: process with lastActivityAt 1100; no `at` will be supplied on exit.
		let state = seedSessionWithReasonAndProcess(
			{
				state: "waiting",
				source: "mcp",
				summary: "?",
				nextAction: null,
				reportedAt: 900,
			},
			{ processId: "p2", lastActivityAt: 1100, status: "running" },
		);
		const worktreeId = onlyWorktreeId(state);

		// Act: exit dispatched WITHOUT `at` — reducer must fall back to lastActivityAt.
		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "p2",
			status: "exited",
			exitCode: 0,
			// `at` intentionally absent
		});

		// Assert: agentAttentionClearedAt is the process's lastActivityAt (1100).
		expect(state.sessionsByWorktreeId[worktreeId].agentAttentionClearedAt).toBe(
			1100,
		);
	});

	it("does NOT advance agentAttentionClearedAt when a ready reason is rejected (stale reportedAt)", () => {
		// Arrange: seed an accepted reason at reportedAt 2000 so the session's mcp
		// reason has reportedAt 2000. agentAttentionClearedAt starts at null.
		let state = seedSessionWithReason({
			state: "active",
			source: "mcp",
			summary: "running",
			nextAction: null,
			reportedAt: 2000,
		});
		const worktreeId = onlyWorktreeId(state);
		expect(
			state.sessionsByWorktreeId[worktreeId].agentAttentionClearedAt,
		).toBeNull();

		// Act: dispatch a `ready` reason with an older reportedAt (1000 < 2000).
		// shouldReplaceAgentAttentionReason returns false → rejected push.
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId,
			reason: {
				state: "ready",
				source: "mcp",
				summary: "stale done",
				nextAction: null,
				reportedAt: 1000,
			},
		});

		// Assert: the rejected push must not advance agentAttentionClearedAt.
		expect(
			state.sessionsByWorktreeId[worktreeId].agentAttentionClearedAt,
		).toBeNull();
	});
});

describe("session/setResumeCommand and session/setResumePending", () => {
	function seedWithTerminal(processId: string, terminalSessionId: string) {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess(processId, "main", "shell", { terminalSessionId }),
		});
		return state;
	}

	it("session/setResumeCommand sets the field on the process matching terminalSessionId", () => {
		const seeded = seedWithTerminal("p1", "term-1");
		const next = workspaceReducer(seeded, {
			type: "session/setResumeCommand",
			terminalSessionId: "term-1",
			resumeCommand: "claude --resume abc-123",
		});
		const proc = Object.values(next.processSessionsById).find(
			(p) => p.terminalSessionId === "term-1",
		);
		expect(proc?.resumeCommand).toBe("claude --resume abc-123");
	});

	it("session/setResumeCommand is a no-op for unknown terminal ids", () => {
		const seeded = seedWithTerminal("p1", "term-1");
		const next = workspaceReducer(seeded, {
			type: "session/setResumeCommand",
			terminalSessionId: "nope",
			resumeCommand: "claude --resume abc-123",
		});
		expect(next).toBe(seeded);
	});

	it("session/setResumePending sets the field on the process matching processId", () => {
		const seeded = seedWithTerminal("p1", "term-1");
		const next = workspaceReducer(seeded, {
			type: "session/setResumePending",
			processId: "p1",
			resumePending: true,
		});
		expect(next.processSessionsById.p1.resumePending).toBe(true);
	});

	it("session/setResumePending is a no-op for an unknown processId", () => {
		const seeded = seedWithTerminal("p1", "term-1");
		const next = workspaceReducer(seeded, {
			type: "session/setResumePending",
			processId: "nope",
			resumePending: true,
		});
		expect(next).toBe(seeded);
	});
});

describe("mcpReportingActive lifecycle (spec §5, D4)", () => {
	const mcpReason = (reportedAt: number) => ({
		state: "active" as const,
		source: "mcp" as const,
		summary: "working",
		nextAction: null,
		reportedAt,
	});

	function seedRunningAgent() {
		const state = workspaceReducer(createWorkspaceState(worktrees), {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("agent-1", "main", "claude", {
				agentDetected: true,
			}),
		});
		return state;
	}

	it("sets the flag on an accepted mcp push while a detected agent runs", () => {
		let state = seedRunningAgent();
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(1_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);
	});

	it("does NOT set the flag when no running detected agent exists (late-report race, spec §7)", () => {
		let state = seedRunningAgent();
		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "agent-1",
			status: "exited",
			exitCode: 0,
			at: 900,
		});
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(1_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(false);
		// The reason itself is still recorded normally (display-layer purity, D5).
		expect(
			state.sessionsByWorktreeId.main.agentAttentionReasons.mcp,
		).toBeDefined();
	});

	it("is unaffected by a rejected (stale) mcp push", () => {
		let state = seedRunningAgent();
		// Accept a fresh mcp push (reportedAt 3000): flag set, reason stored.
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(3_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);
		expect(
			state.sessionsByWorktreeId.main.agentAttentionReasons.mcp?.reportedAt,
		).toBe(3_000);

		// Now dispatch an OLDER same-source mcp push (reportedAt 2000). It is
		// stale → shouldReplaceAgentAttentionReason returns false → rejected. A
		// rejected push must not touch the flag or overwrite the stored reason.
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(2_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);
		expect(
			state.sessionsByWorktreeId.main.agentAttentionReasons.mcp?.reportedAt,
		).toBe(3_000);
	});

	it("is not set by a workflow-source report", () => {
		let state = seedRunningAgent();
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: { ...mcpReason(3_000), source: "workflow" as const },
		});
		// Only the `mcp` source enters self-reporting mode (spec §5); a
		// workflow-source report leaves the flag false.
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(false);
	});

	it("resets when the last running detected agent exits, and stays when one remains", () => {
		let state = seedRunningAgent();
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("agent-2", "main", "codex", {
				agentDetected: true,
			}),
		});
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(1_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);

		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "agent-1",
			status: "exited",
			exitCode: 0,
			at: 2_000,
		});
		// agent-2 still running → flag holds.
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);

		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "agent-2",
			status: "exited",
			exitCode: 0,
			at: 3_000,
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(false);
	});

	it("survives an unrelated session action", () => {
		let state = seedRunningAgent();
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(1_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);

		// A benign, unrelated action (setNote spreads ...session) must not disturb
		// the flag (spec §8: "survives unrelated actions").
		state = workspaceReducer(state, {
			type: "session/setNote",
			worktreeId: "main",
			note: "an unrelated edit",
		});
		// The action actually ran (note changed) AND the flag is untouched.
		expect(state.sessionsByWorktreeId.main.note).toBe("an unrelated edit");
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);
	});

	it("resets when the last running detected agent is closed, and stays when one remains", () => {
		let state = seedRunningAgent();
		state = workspaceReducer(state, {
			type: "session/reportAgentAttention",
			worktreeId: "main",
			reason: mcpReason(1_000),
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);

		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("agent-2", "main", "codex", {
				agentDetected: true,
			}),
		});

		// Closing agent-1 (sidebar close, not a natural exit) while agent-2 is
		// still running must NOT reset the flag.
		state = workspaceReducer(state, {
			type: "session/closeProcess",
			worktreeId: "main",
			processId: "agent-1",
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(true);

		// Closing agent-2 — the last running detected agent — must reset the
		// flag (spec §5), mirroring the session/updateProcessStatus reset.
		state = workspaceReducer(state, {
			type: "session/closeProcess",
			worktreeId: "main",
			processId: "agent-2",
		});
		expect(state.sessionsByWorktreeId.main.mcpReportingActive).toBe(false);
	});
});

describe("session/updateProcessStatus — onlyIfTerminalSessionId stale-session guard (restart race)", () => {
	// Build the exact restart-race shape: process P bound to terminal session S1,
	// then rebound to a fresh S2 (session/replaceProcessTerminal) with its own
	// authoritative status=running dispatch. The OLD S1's delayed PTY exit event
	// arrives afterward pinned to S1. Because the rebind actions always reduce
	// before the later-arriving exit action, the reducer can drop the stale exit
	// by comparing the pin against the process's CURRENT terminalSessionId.
	function rebound() {
		let state = createWorkspaceState(worktrees);
		state = workspaceReducer(state, {
			type: "session/registerProcess",
			worktreeId: "main",
			process: makeProcess("P", "main", "shell", { terminalSessionId: "S1" }),
		});
		// Restart rebinds P onto a brand-new terminal session S2 ...
		state = workspaceReducer(state, {
			type: "session/replaceProcessTerminal",
			processId: "P",
			terminalSessionId: "S2",
		});
		// ... and re-asserts status=running (the restart's OWN authoritative status
		// dispatch — no pin, so it always applies).
		state = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "P",
			status: "running",
			exitCode: null,
		});
		return state;
	}

	it("drops a stale exit pinned to the OLD session so the rebound process stays running", () => {
		const state = rebound();
		expect(state.processSessionsById["P"]?.status).toBe("running");
		expect(state.processSessionsById["P"]?.terminalSessionId).toBe("S2");

		// The OLD terminal session S1 exits late; its event is pinned to S1 but P
		// is now bound to S2 → the whole action is dropped.
		const next = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "P",
			status: "exited",
			exitCode: 0,
			at: 5_000,
			onlyIfTerminalSessionId: "S1",
		});

		expect(next.processSessionsById["P"]?.status).toBe("running");
		expect(next.processSessionsById["P"]?.exitCode).toBeNull();
		// Dropping the WHOLE action's effects is a referential no-op: no session
		// side-effects (agentAttentionClearedAt / mcpReportingActive) applied either.
		expect(next).toBe(state);
	});

	it("applies the exit when NO pin is supplied (today's behavior preserved)", () => {
		const state = rebound();
		const next = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "P",
			status: "exited",
			exitCode: 0,
			at: 5_000,
		});
		expect(next.processSessionsById["P"]?.status).toBe("exited");
		expect(next.processSessionsById["P"]?.exitCode).toBe(0);
	});

	it("applies the exit when the pin MATCHES the current terminal session", () => {
		const state = rebound();
		const next = workspaceReducer(state, {
			type: "session/updateProcessStatus",
			processId: "P",
			status: "exited",
			exitCode: 0,
			at: 5_000,
			onlyIfTerminalSessionId: "S2",
		});
		expect(next.processSessionsById["P"]?.status).toBe("exited");
		expect(next.processSessionsById["P"]?.exitCode).toBe(0);
	});
});
