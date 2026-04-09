import { describe, expect, it } from "vitest";
import { DEFAULT_COMMAND_PRESETS } from "../../../shared/models/command-preset";
import {
	buildSavedWorkspace,
	buildWorkspaceSnapshot,
	findSavedWorkspaceMatch,
	rebaseSnapshotPaths,
	reconcileSnapshotToWorktrees,
	shouldReattachSnapshot,
	splitPendingRestores,
} from "../../../src/features/workspace/workspace-persistence";
import { createWorkspaceState, workspaceReducer } from "../../../src/features/workspace/workspace-state";
import { PersistedWorkspaceStateSchema } from "../../../shared/models/persisted-workspace-state";
import type { WorkspaceSnapshot } from "../../../shared/models/persisted-workspace-state";

it("serializes multiple workspaces into one persisted file", () => {
	const parsed = PersistedWorkspaceStateSchema.parse({
		version: 2,
		restorePreference: "prompt",
		activeWorkspaceId: "ws-a",
		workspaceOrder: ["ws-a", "ws-b"],
		workspaces: [
			{
				workspaceId: "ws-a",
				repositoryPath: "/repo-a",
				repoId: "repo-id-a",
				snapshot: {
					repositoryPath: "/repo-a",
					repoId: "repo-id-a",
					selectedWorktreeId: null,
					topBandCollapsed: false,
					commandPresets: [],
					worktreeSessions: [],
				},
			},
		],
	});

	expect(parsed.workspaceOrder).toEqual(["ws-a", "ws-b"]);
});

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

		const snapshot = buildWorkspaceSnapshot("/repo", null, state);

		expect(snapshot).toEqual({
			repositoryPath: "/repo",
			repoId: null,
			selectedWorktreeId: "main",
			topBandCollapsed: false,
			commandPresets: DEFAULT_COMMAND_PRESETS,
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
					terminalLayoutMode: "single",
					splitLeftProcessId: null,
					splitRightProcessId: null,
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
		const snapshot = buildWorkspaceSnapshot("/repo", null, createWorkspaceState([]));
		expect(snapshot.commandPresets).toEqual(DEFAULT_COMMAND_PRESETS);
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

	expect(buildWorkspaceSnapshot("/repo", null, state).worktreeSessions[0]).toMatchObject({
		selectedCommitSha: "abc1234",
		selectedCommitFilePath: "src/index.ts",
		reviewMode: "commits",
		viewerMode: "commit",
	});
});

it("serializes repoId into the workspace snapshot", () => {
	const state = createWorkspaceState([
		{
			id: "main",
			repositoryId: "repo-1",
			branchName: "main",
			path: "/repo",
			label: "main",
			isMain: true,
		},
	]);

	expect(buildWorkspaceSnapshot("/repo", "repo-id-123", state)).toMatchObject({
		repositoryPath: "/repo",
		repoId: "repo-id-123",
	});
});

it("defaults repoId to null for older snapshots", () => {
	const parsed = PersistedWorkspaceStateSchema.parse({
		version: 1,
		restorePreference: "prompt",
		snapshot: {
			repositoryPath: "/repo",
			selectedWorktreeId: null,
			commandPresets: [],
			worktreeSessions: [],
		},
	});

	expect(parsed.snapshot?.repoId).toBeNull();
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

it("serializes split-shell layout fields into the workspace snapshot", () => {
	let state = createWorkspaceState([
		{
			id: "main",
			repositoryId: "repo-1",
			branchName: "main",
			path: "/repo",
			label: "main",
			isMain: true,
		},
	]);
	state = workspaceReducer(state, {
		type: "session/registerProcess",
		worktreeId: "main",
		process: {
			id: "process-1",
			worktreeId: "main",
			terminalSessionId: "terminal-1",
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

	expect(buildWorkspaceSnapshot("/repo", null, state).worktreeSessions[0]).toMatchObject({
		terminalLayoutMode: "split",
		splitLeftProcessId: "process-1",
		splitRightProcessId: null,
	});
});

it("defaults split-shell fields for older snapshots", () => {
	const parsed = PersistedWorkspaceStateSchema.parse({
		version: 1,
		restorePreference: "prompt",
		snapshot: {
			repositoryPath: "/repo",
			selectedWorktreeId: "main",
			commandPresets: [],
			worktreeSessions: [
				{
					worktreeId: "main",
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

	expect(parsed.snapshot?.worktreeSessions[0]?.terminalLayoutMode).toBe("single");
	expect(parsed.snapshot?.worktreeSessions[0]?.splitLeftProcessId).toBeNull();
	expect(parsed.snapshot?.worktreeSessions[0]?.splitRightProcessId).toBeNull();
});

describe("splitPendingRestores", () => {
	it("keeps only non-selected worktrees in the pending restore map", () => {
		const snapshot = {
			repositoryPath: "/repo",
			repoId: null,
			topBandCollapsed: false,
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
					selectedCommitSha: null,
					selectedCommitFilePath: null,
					terminalLayoutMode: "single" as const,
					splitLeftProcessId: null,
					splitRightProcessId: null,
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
					selectedCommitSha: null,
					selectedCommitFilePath: null,
					terminalLayoutMode: "single" as const,
					splitLeftProcessId: null,
					splitRightProcessId: null,
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
			repoId: null,
			topBandCollapsed: false,
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
					selectedCommitSha: null,
					selectedCommitFilePath: null,
					terminalLayoutMode: "single" as const,
					splitLeftProcessId: null,
					splitRightProcessId: null,
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

function makeMinimalSnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
	return {
		repositoryPath: "/repo",
		repoId: null,
		topBandCollapsed: false,
		selectedWorktreeId: null,
		commandPresets: [],
		worktreeSessions: [],
		...overrides,
	};
}

describe("rebaseSnapshotPaths", () => {
	it("replaces old prefix in selectedWorktreeId and worktree session IDs", () => {
		const snapshot = makeMinimalSnapshot({
			repositoryPath: "/old-repo",
			selectedWorktreeId: "/old-repo/.worktrees/feature-a",
			worktreeSessions: [
				{
					worktreeId: "/old-repo",
					note: "main",
					reviewMode: "files",
					viewerMode: "file",
					selectedFilePath: null,
					selectedChangedFilePath: null,
					selectedCommitSha: null,
					selectedCommitFilePath: null,
					terminalLayoutMode: "single" as const,
					splitLeftProcessId: null,
					splitRightProcessId: null,
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [],
				},
				{
					worktreeId: "/old-repo/.worktrees/feature-a",
					note: "feature",
					reviewMode: "files",
					viewerMode: "file",
					selectedFilePath: null,
					selectedChangedFilePath: null,
					selectedCommitSha: null,
					selectedCommitFilePath: null,
					terminalLayoutMode: "single" as const,
					splitLeftProcessId: null,
					splitRightProcessId: null,
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [],
				},
			],
		});

		const rebased = rebaseSnapshotPaths(snapshot, "/old-repo", "/new-repo");
		expect(rebased.selectedWorktreeId).toBe("/new-repo/.worktrees/feature-a");
		expect(rebased.worktreeSessions[0].worktreeId).toBe("/new-repo");
		expect(rebased.worktreeSessions[1].worktreeId).toBe("/new-repo/.worktrees/feature-a");
		expect(rebased.worktreeSessions[1].note).toBe("feature");
	});

	it("returns the same reference when prefixes are equal", () => {
		const snapshot = makeMinimalSnapshot({ selectedWorktreeId: "/repo" });
		expect(rebaseSnapshotPaths(snapshot, "/repo", "/repo")).toBe(snapshot);
	});

	it("leaves IDs that do not match the old prefix untouched", () => {
		const snapshot = makeMinimalSnapshot({
			selectedWorktreeId: "unrelated-id",
			worktreeSessions: [
				{
					worktreeId: "unrelated-id",
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
					activeProcessSessionId: null,
					nextAdHocNumber: 1,
					processSessions: [],
				},
			],
		});

		const rebased = rebaseSnapshotPaths(snapshot, "/old-repo", "/new-repo");
		expect(rebased.selectedWorktreeId).toBe("unrelated-id");
		expect(rebased.worktreeSessions[0].worktreeId).toBe("unrelated-id");
	});

	it("handles null selectedWorktreeId", () => {
		const snapshot = makeMinimalSnapshot({ selectedWorktreeId: null });
		const rebased = rebaseSnapshotPaths(snapshot, "/old", "/new");
		expect(rebased.selectedWorktreeId).toBeNull();
	});
});

describe("shouldReattachSnapshot", () => {
	it("returns true when both repoIds match", () => {
		expect(
			shouldReattachSnapshot(
				{ repoId: "id-1", name: "repo" },
				makeMinimalSnapshot({ repoId: "id-1" }),
			),
		).toBe(true);
	});

	it("returns false when repoIds differ", () => {
		expect(
			shouldReattachSnapshot(
				{ repoId: "id-1", name: "repo" },
				makeMinimalSnapshot({ repoId: "id-2" }),
			),
		).toBe(false);
	});

	it("returns false when snapshot has repoId but repo does not", () => {
		expect(
			shouldReattachSnapshot(
				{ repoId: null, name: "repo" },
				makeMinimalSnapshot({ repoId: "id-1" }),
			),
		).toBe(false);
	});

	it("returns false when repo has repoId but snapshot does not", () => {
		expect(
			shouldReattachSnapshot(
				{ repoId: "id-1", name: "repo" },
				makeMinimalSnapshot({ repoId: null }),
			),
		).toBe(false);
	});

	it("falls back to basename match when neither has repoId", () => {
		expect(
			shouldReattachSnapshot(
				{ repoId: null, name: "my-repo" },
				makeMinimalSnapshot({ repositoryPath: "/home/user/my-repo", repoId: null }),
			),
		).toBe(true);
	});

	it("returns false on basename mismatch when neither has repoId", () => {
		expect(
			shouldReattachSnapshot(
				{ repoId: null, name: "different-repo" },
				makeMinimalSnapshot({ repositoryPath: "/home/user/my-repo", repoId: null }),
			),
		).toBe(false);
	});

	it("returns false for null snapshot", () => {
		expect(
			shouldReattachSnapshot({ repoId: "id-1", name: "repo" }, null),
		).toBe(false);
	});
});

function makeSession(worktreeId: string, note = ""): WorkspaceSnapshot["worktreeSessions"][number] {
	return {
		worktreeId,
		note,
		reviewMode: "files",
		viewerMode: "file",
		selectedFilePath: null,
		selectedChangedFilePath: null,
		selectedCommitSha: null,
		selectedCommitFilePath: null,
		terminalLayoutMode: "single",
		splitLeftProcessId: null,
		splitRightProcessId: null,
		activeProcessSessionId: null,
		nextAdHocNumber: 1,
		processSessions: [],
	};
}

describe("reconcileSnapshotToWorktrees", () => {
	const wts = [
		{ id: "/old/repo" },
		{ id: "/old/repo/.worktrees/feature-a" },
	];

	it("returns rebasedSnapshot unchanged when all ids are already in wts", () => {
		const rebased = makeMinimalSnapshot({
			selectedWorktreeId: "/old/repo/.worktrees/feature-a",
			worktreeSessions: [makeSession("/old/repo"), makeSession("/old/repo/.worktrees/feature-a", "note")],
		});
		const original = makeMinimalSnapshot({
			selectedWorktreeId: "/old/repo/.worktrees/feature-a",
			worktreeSessions: [makeSession("/old/repo"), makeSession("/old/repo/.worktrees/feature-a", "note")],
		});
		expect(reconcileSnapshotToWorktrees(rebased, original, wts)).toBe(rebased);
	});

	it("falls back to original id for linked worktree whose rebased id is absent from wts", () => {
		// Simulates: repo renamed old→new, main worktree id updated in wts but
		// linked worktree still reports the old path (stale gitdir).
		const wtsAfterRename = [
			{ id: "/new/repo" },
			{ id: "/old/repo/.worktrees/feature-a" }, // stale — git didn't update this
		];
		const rebased = makeMinimalSnapshot({
			selectedWorktreeId: "/new/repo/.worktrees/feature-a", // correctly rebased
			worktreeSessions: [
				makeSession("/new/repo"),
				makeSession("/new/repo/.worktrees/feature-a", "resume here"),
			],
		});
		const original = makeMinimalSnapshot({
			selectedWorktreeId: "/old/repo/.worktrees/feature-a",
			worktreeSessions: [
				makeSession("/old/repo"),
				makeSession("/old/repo/.worktrees/feature-a", "resume here"),
			],
		});

		const result = reconcileSnapshotToWorktrees(rebased, original, wtsAfterRename);

		// Main worktree rebased id IS in wts → keep rebased
		expect(result.worktreeSessions[0].worktreeId).toBe("/new/repo");
		// Linked worktree rebased id is NOT in wts, original IS → fall back to original
		expect(result.selectedWorktreeId).toBe("/old/repo/.worktrees/feature-a");
		expect(result.worktreeSessions[1].worktreeId).toBe("/old/repo/.worktrees/feature-a");
		// Note is preserved
		expect(result.worktreeSessions[1].note).toBe("resume here");
	});

	it("keeps rebased id when neither rebased nor original id is in wts (worktree gone)", () => {
		const wtsGone = [{ id: "/new/repo" }];
		const rebased = makeMinimalSnapshot({
			selectedWorktreeId: "/new/repo/.worktrees/feature-a",
			worktreeSessions: [makeSession("/new/repo/.worktrees/feature-a", "note")],
		});
		const original = makeMinimalSnapshot({
			selectedWorktreeId: "/old/repo/.worktrees/feature-a",
			worktreeSessions: [makeSession("/old/repo/.worktrees/feature-a", "note")],
		});

		const result = reconcileSnapshotToWorktrees(rebased, original, wtsGone);
		expect(result.selectedWorktreeId).toBe("/new/repo/.worktrees/feature-a");
		expect(result.worktreeSessions[0].worktreeId).toBe("/new/repo/.worktrees/feature-a");
	});

	it("handles null selectedWorktreeId without throwing", () => {
		const rebased = makeMinimalSnapshot({ selectedWorktreeId: null });
		const original = makeMinimalSnapshot({ selectedWorktreeId: null });
		const result = reconcileSnapshotToWorktrees(rebased, original, wts);
		expect(result.selectedWorktreeId).toBeNull();
	});
});

it("builds a saved workspace entry from repo-scoped runtime state", () => {
	const state = createWorkspaceState([
		{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
	]);

	const saved = buildSavedWorkspace("ws-a", "/repo", "repo-id-a", state);
	expect(saved.workspaceId).toBe("ws-a");
	expect(saved.snapshot.repositoryPath).toBe("/repo");
});

it("finds a saved workspace by repoId before falling back to path", () => {
	expect(
		findSavedWorkspaceMatch(
			{
				workspaceId: "ws-a",
				repositoryPath: "/repo-a",
				repoId: "repo-id-a",
				snapshot: {
					repositoryPath: "/repo-a",
					repoId: "repo-id-a",
					selectedWorktreeId: null,
					topBandCollapsed: false,
					commandPresets: [],
					worktreeSessions: [],
				},
			},
			{ repoId: "repo-id-a", rootPath: "/different-path", name: "repo-a" },
		),
	).toBe(true);
});
