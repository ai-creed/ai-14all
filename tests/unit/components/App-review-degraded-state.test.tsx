import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ensureReviewOverlayOpen } from "../helpers/review-overlay";

// Mock TerminalPane to avoid xterm canvas dependency in jsdom
vi.mock("../../../src/features/terminals/components/TerminalPane", () => ({
	TerminalPane: () => null,
}));

// Mock desktop-client before importing App
vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		listWorktrees: vi.fn(),
		pickRoot: vi.fn(),
		previewCreateWorktree: vi.fn(),
		createWorktree: vi.fn(),
		previewRemoveWorktree: vi.fn(),
		removeWorktree: vi.fn(),
	},
	terminals: {
		create: vi.fn(() =>
			Promise.resolve({
				id: "terminal-1",
				workspaceId: "r1",
				worktreeId: "wt1",
				cwd: "/repo",
				status: "running",
				exitCode: null,
			}),
		),
		sendInput: vi.fn(),
		resize: vi.fn(),
		stop: vi.fn(),
		list: vi.fn().mockResolvedValue([]),
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	files: {
		list: vi.fn().mockResolvedValue([]),
		listScoped: vi.fn().mockResolvedValue([]),
		read: vi.fn(),
	},
	git: {
		listChanges: vi.fn().mockResolvedValue([]),
		readDiff: vi.fn().mockResolvedValue(null),
		readSummary: vi.fn().mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		}),
		readCommitHistory: vi
			.fn()
			.mockResolvedValue({ mergeTargetRef: null, entries: [] }),
		readCommitDetail: vi.fn().mockResolvedValue(null),
		getRemoteStatus: vi
			.fn()
			.mockResolvedValue({ hasRemote: false, ahead: 0, behind: 0 }),
	},
	workspace: {
		openRepository: vi.fn(),
		readRestoreState: vi.fn().mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		}),
		writeRestoreState: vi.fn(),
		onOpenPicker: vi.fn(() => vi.fn()),
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
		getAgentAttentionStatus: vi.fn(() =>
			Promise.resolve({ mode: "off", logsDir: "" }),
		),
	},
	system: {
		onUpdateAvailable: vi.fn(() => vi.fn()),
		openExternal: vi.fn(() => Promise.resolve()),
	},
	reviewComments: {
		list: vi.fn().mockResolvedValue({ comments: [] }),
		create: vi.fn().mockResolvedValue({}),
		markAddressed: vi.fn().mockResolvedValue({}),
		reopen: vi.fn().mockResolvedValue({}),
		delete: vi.fn().mockResolvedValue({}),
		rebaseWorktreeIds: vi.fn().mockResolvedValue({}),
		onChanged: vi.fn(() => vi.fn()),
	},
	events: {
		onOpenInstallModal: vi.fn(() => vi.fn()),
	},
	noteBridge: {
		onRequest: vi.fn(() => vi.fn()),
		sendReply: vi.fn(),
		sendReady: vi.fn(),
		sendGoodbye: vi.fn(),
	},
	agentAttentionBridge: {
		onRequest: vi.fn(() => vi.fn()),
		sendReply: vi.fn(),
		sendReady: vi.fn(),
		sendGoodbye: vi.fn(),
	},
	agentInstall: {
		listProviders: vi.fn().mockResolvedValue({
			providers: [],
			mcp: { port: null, bindError: null },
		}),
		install: vi.fn().mockResolvedValue({ results: [] }),
		uninstall: vi.fn().mockResolvedValue({ results: [] }),
	},
}));

import { App } from "../../../src/app/App";
import { workspace, repository, git } from "../../../src/lib/desktop-client";

const mockOpenRepository = vi.mocked(workspace.openRepository);
const mockListWorktrees = vi.mocked(repository.listWorktrees);
const mockReadCommitHistory = vi.mocked(git.readCommitHistory);
const mockReadCommitDetail = vi.mocked(git.readCommitDetail);
const mockReadSummary = vi.mocked(git.readSummary);
const mockReadRestoreState = vi.mocked(workspace.readRestoreState);

const user = userEvent.setup();

async function loadRepositoryWithTwoWorktrees() {
	mockOpenRepository.mockResolvedValueOnce({
		workspaceId: "r1",
		repository: {
			id: "r1",
			name: "test-repo",
			rootPath: "/repo",
			repoId: "repo-id-123",
		},
	});
	mockListWorktrees.mockResolvedValueOnce([
		{
			id: "wt1",
			repositoryId: "r1",
			branchName: "main",
			path: "/repo",
			label: "main",
			isMain: true,
		},
		{
			id: "wt2",
			repositoryId: "r1",
			branchName: "feature-a",
			path: "/repo/.worktrees/feature-a",
			label: "feature-a",
			isMain: false,
		},
	]);

	render(<App />);

	await waitFor(() => {
		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
	});

	fireEvent.change(screen.getByLabelText("Repository path"), {
		target: { value: "/repo" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Load" }));

	await waitFor(() => {
		expect(
			screen.getByRole("button", { name: "feature-a" }),
		).toBeInTheDocument();
	});
}

async function loadRepositoryAndSwitchToCommits() {
	mockOpenRepository.mockResolvedValueOnce({
		workspaceId: "r1",
		repository: {
			id: "r1",
			name: "test-repo",
			rootPath: "/repo",
			repoId: "repo-id-123",
		},
	});
	mockListWorktrees.mockResolvedValueOnce([
		{
			id: "wt1",
			repositoryId: "r1",
			branchName: "main",
			path: "/repo",
			label: "main",
			isMain: true,
		},
	]);

	render(<App />);

	// Wait for startup loading to complete and repository input to appear
	await waitFor(() => {
		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
	});

	// Load the repository
	fireEvent.change(screen.getByLabelText("Repository path"), {
		target: { value: "/repo" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Load" }));

	// Wait for the review chipbar, then open the overlay so the tabs mount.
	await waitFor(() =>
		expect(screen.getByTestId("review-chipbar")).toBeInTheDocument(),
	);
	ensureReviewOverlayOpen();

	// Wait for the workspace to appear
	await waitFor(() => {
		expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
	});

	// Switch to "commits" review mode
	await user.click(screen.getByRole("tab", { name: "Commits" }));

	await waitFor(() => {
		expect(screen.getByRole("tab", { name: "Commits" })).toHaveAttribute(
			"data-state",
			"active",
		);
	});
}

describe("App — degraded commit history read", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// mockReset drains any leftover Once-queue values from previous tests so
		// background refreshWorktreeInventory calls don't receive undefined.
		mockListWorktrees.mockReset();
		mockListWorktrees.mockResolvedValue([
			{
				id: "wt1",
				repositoryId: "r1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);
		mockReadRestoreState.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
		mockReadSummary.mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		});
		mockReadCommitHistory.mockResolvedValue({
			mergeTargetRef: null,
			entries: [],
		});
		mockReadCommitDetail.mockRejectedValue(new Error("not called"));
	});

	it("keeps the previous commit list visible when commit-history refresh fails", async () => {
		let failHistory = false;
		mockReadCommitHistory.mockImplementation(async () => {
			if (failHistory) throw new Error("history failed");
			return {
				mergeTargetRef: "origin/main",
				entries: [
					{
						sha: "abc",
						shortSha: "abc",
						subject: "feature commit",
						isMergeTarget: false,
					},
				],
			};
		});

		await loadRepositoryAndSwitchToCommits();

		// Wait for the initial commit to appear
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /feature commit/i }),
			).toBeInTheDocument();
		});

		failHistory = true;
		fireEvent.click(
			within(screen.getByTestId("review-chipbar")).getByRole("button", {
				name: /refresh review/i,
			}),
		);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /feature commit/i }),
			).toBeInTheDocument();
			expect(
				screen.getByText(/couldn't refresh commit history/i),
			).toBeInTheDocument();
		});
	});

	it("shows an error message (not stale) when history fails on first load", async () => {
		mockReadCommitHistory.mockRejectedValue(new Error("network error"));

		await loadRepositoryAndSwitchToCommits();

		await waitFor(() => {
			expect(
				screen.getByText(/couldn't load commit history/i),
			).toBeInTheDocument();
		});
	});

	it("clears the selected commit when it is no longer present after refresh", async () => {
		let currentEntries = [
			{
				sha: "abc",
				shortSha: "abc",
				subject: "feature commit",
				isMergeTarget: false,
			},
		];
		mockReadCommitHistory.mockImplementation(async () => ({
			mergeTargetRef: "origin/main",
			entries: currentEntries,
		}));
		mockReadCommitDetail.mockResolvedValue({
			sha: "abc",
			shortSha: "abc",
			subject: "feature commit",
			files: [],
		});

		await loadRepositoryAndSwitchToCommits();

		// Wait for commit to appear and select it
		const commitBtn = await screen.findByRole("button", {
			name: /feature commit/i,
		});
		fireEvent.click(commitBtn);

		// Refresh with the commit removed
		currentEntries = [];
		fireEvent.click(
			within(screen.getByTestId("review-chipbar")).getByRole("button", {
				name: /refresh review/i,
			}),
		);

		await waitFor(() => {
			// Commit list is now empty — the selection should have been cleared
			expect(
				screen.queryByRole("button", { name: /feature commit/i }),
			).not.toBeInTheDocument();
		});
	});
});

describe("App — degraded commit detail read", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// mockReset drains any leftover Once-queue values from previous tests so
		// background refreshWorktreeInventory calls don't receive undefined.
		mockListWorktrees.mockReset();
		mockListWorktrees.mockResolvedValue([
			{
				id: "wt1",
				repositoryId: "r1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);
		mockReadRestoreState.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
		mockReadSummary.mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		});
		mockReadCommitHistory.mockResolvedValue({
			mergeTargetRef: "origin/main",
			entries: [
				{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					isMergeTarget: false,
				},
			],
		});
		mockReadCommitDetail.mockRejectedValue(new Error("not called"));
	});

	it("shows an error when commit detail fails to load", async () => {
		mockReadCommitDetail.mockRejectedValue(new Error("detail failed"));

		await loadRepositoryAndSwitchToCommits();

		const commitBtn = await screen.findByRole("button", {
			name: /feature commit/i,
		});
		fireEvent.click(commitBtn);

		await waitFor(() => {
			expect(
				screen.getByText(/couldn't load commit detail/i),
			).toBeInTheDocument();
		});
	});
});

describe("App — focus-gated auto-refresh", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// mockReset drains any leftover Once-queue values from previous tests so
		// background refreshWorktreeInventory calls don't receive undefined.
		mockListWorktrees.mockReset();
		mockListWorktrees.mockResolvedValue([
			{
				id: "wt1",
				repositoryId: "r1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);
		mockReadRestoreState.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
		mockReadSummary.mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		});
		mockReadCommitHistory.mockResolvedValue({
			mergeTargetRef: null,
			entries: [],
		});
		mockReadCommitDetail.mockRejectedValue(new Error("not called"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls summary and commit history only while the app window is focused", async () => {
		await loadRepositoryAndSwitchToCommits();
		vi.useFakeTimers();

		// jsdom does not set document.hasFocus() to true by default, so dispatch a
		// focus event to start the polling interval (window.setInterval is now fake).
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
		});

		const summaryCallsAfterFocus = mockReadSummary.mock.calls.length;
		const historyCallsAfterFocus = mockReadCommitHistory.mock.calls.length;

		await act(async () => {
			vi.advanceTimersByTime(15_000);
		});

		expect(mockReadSummary.mock.calls.length).toBeGreaterThan(
			summaryCallsAfterFocus,
		);
		expect(mockReadCommitHistory.mock.calls.length).toBeGreaterThan(
			historyCallsAfterFocus,
		);

		// Blur first and flush React so the interval is cleared before advancing timers
		await act(async () => {
			window.dispatchEvent(new Event("blur"));
		});
		act(() => {
			vi.advanceTimersByTime(15_000);
		});

		expect(mockReadSummary.mock.calls.length).toBe(summaryCallsAfterFocus + 1);
		expect(mockReadCommitHistory.mock.calls.length).toBe(
			historyCallsAfterFocus + 1,
		);

		vi.useRealTimers();
	});

	it("refreshes immediately on focus regain without double-fetching on worktree switch", async () => {
		await loadRepositoryWithTwoWorktrees();

		fireEvent.click(screen.getByRole("button", { name: "feature-a" }));

		await waitFor(() => {
			expect(mockReadSummary.mock.calls.length).toBeGreaterThan(0);
		});

		const summaryCallsAfterSwitch = mockReadSummary.mock.calls.length;
		vi.useFakeTimers();

		await act(async () => {
			window.dispatchEvent(new Event("blur"));
			window.dispatchEvent(new Event("focus"));
		});

		// After act flushes all async effects, readSummary should have been called once more
		expect(mockReadSummary.mock.calls.length).toBe(summaryCallsAfterSwitch + 1);

		vi.useRealTimers();
	});
});
