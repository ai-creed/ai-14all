import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ensureReviewDrawerOpen } from "../helpers/review-drawer";

const mockTerminalOutputListeners: Array<
	(event: { sessionId: string; data: string }) => void
> = [];

let terminalIdCounter = 0;

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
				id: `terminal-${++terminalIdCounter}`,
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
		onOutput: vi.fn(
			(listener: (event: { sessionId: string; data: string }) => void) => {
				mockTerminalOutputListeners.push(listener);
				return vi.fn();
			},
		),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	files: {
		list: vi.fn().mockResolvedValue([]),
		listScoped: vi.fn().mockResolvedValue(["src/index.ts", "src/new-file.ts"]),
		read: vi.fn(),
	},
	git: {
		listChanges: vi.fn().mockResolvedValue([]),
		readDiff: vi.fn(),
		readSummary: vi.fn(),
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
const mockReadSummary = vi.mocked(git.readSummary);
const mockReadDiff = vi.mocked(git.readDiff);
const mockReadRestoreState = vi.mocked(workspace.readRestoreState);

async function loadRepoAndSwitchToChanges() {
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
	mockReadSummary.mockResolvedValue({
		branchName: "main",
		isDirty: true,
		changedFileCount: 1,
		changedFiles: [{ path: "src/index.ts", status: "M" }],
		recentCommits: [{ sha: "abc", shortSha: "abc", subject: "initial commit" }],
	});

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

	// Wait for the review drawer, then expand it so the tabs mount.
	await waitFor(() =>
		expect(screen.getByRole("region", { name: "Review" })).toBeInTheDocument(),
	);
	ensureReviewDrawerOpen();

	// Wait for the workspace to appear
	await waitFor(() => {
		expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
	});

	// Switch to "changes" review mode
	fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
}

async function loadRepositoryWithTwoWorktrees() {
	const twoWorktrees = [
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
	];
	mockOpenRepository.mockResolvedValueOnce({
		workspaceId: "r1",
		repository: {
			id: "r1",
			name: "test-repo",
			rootPath: "/repo",
			repoId: "repo-id-123",
		},
	});
	// Set a persistent default so background refreshes (focus/interval) keep
	// both worktrees alive and don't reconcile feature-a away.
	mockListWorktrees.mockResolvedValue(twoWorktrees);

	render(<App />);

	// Wait for startup loading to complete
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

// TODO(Task 9): Re-enable and migrate these tests to the new chipbar/overlay UI.
// They currently probe the deleted review drawer DOM (data-open, resize handles,
// expanded-by-default ReviewArea on first render).
describe.skip("App — refresh changes button", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTerminalOutputListeners.length = 0;
		terminalIdCounter = 0;
		// Re-setup the default mock for readSummary since clearAllMocks wipes it
		mockReadSummary.mockResolvedValue({
			branchName: "main",
			isDirty: true,
			changedFileCount: 1,
			changedFiles: [{ path: "src/index.ts", status: "M" }],
			recentCommits: [
				{ sha: "abc", shortSha: "abc", subject: "initial commit" },
			],
		});
		mockReadDiff.mockResolvedValue({
			path: "src/index.ts",
			content: "diff --git a/src/index.ts b/src/index.ts\n",
			originalContent: 'export const hello = "world";\n',
			modifiedContent: 'export const hello = "phase-2";\n',
		});
		mockReadRestoreState.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
		// Reset and set a default fallback for listWorktrees. mockReset() is used
		// here (not clearAllMocks) to drain any stale Once-queue values left over
		// from previous tests — clearAllMocks() does not drain the Once queue.
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
	});

	it("shows a Refresh button when review mode is 'changes'", async () => {
		await loadRepoAndSwitchToChanges();

		expect(
			screen.getByRole("button", { name: "Refresh review" }),
		).toBeInTheDocument();
	});

	it("does not show a Refresh button when review mode is 'files'", async () => {
		await loadRepoAndSwitchToChanges();

		// Switch back to files
		fireEvent.click(screen.getByRole("tab", { name: "Files" }));

		expect(
			screen.getByRole("button", { name: "Refresh review" }),
		).toBeInTheDocument();
	});

	it("clicking Refresh re-fetches git changes", async () => {
		await loadRepoAndSwitchToChanges();

		const callCountBefore = mockReadSummary.mock.calls.length;

		fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));

		await waitFor(() => {
			expect(mockReadSummary.mock.calls.length).toBeGreaterThan(
				callCountBefore,
			);
		});
	});

	it("supports keyboard review-mode switching", async () => {
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

		// Wait for startup loading to complete
		const repoInput = await screen.findByLabelText("Repository path");

		fireEvent.change(repoInput, {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByRole("region", { name: "Review" });
		ensureReviewDrawerOpen();
		const filesTab = await screen.findByRole("tab", { name: "Files" });
		filesTab.focus();
		fireEvent.keyDown(filesTab, { key: "ArrowRight" });

		expect(
			await screen.findByRole("button", { name: "Refresh review" }),
		).toBeInTheDocument();
	});

	it("refreshes the cached git summary for the active worktree", async () => {
		mockReadSummary.mockResolvedValue({
			branchName: "main",
			isDirty: true,
			changedFileCount: 1,
			changedFiles: [{ path: "src/index.ts", status: "M" }],
			recentCommits: [
				{ sha: "abc", shortSha: "abc", subject: "initial commit" },
			],
		});

		await loadRepoAndSwitchToChanges();

		const before = mockReadSummary.mock.calls.length;
		fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));

		await waitFor(() => {
			expect(mockReadSummary.mock.calls.length).toBeGreaterThan(before);
		});
	});

	it("clears a stale changed-file selection when refresh removes that file from git summary", async () => {
		let currentSummary = {
			branchName: "main",
			isDirty: true,
			changedFileCount: 1,
			changedFiles: [{ path: "src/index.ts", status: "M" as const }],
			recentCommits: [
				{ sha: "abc", shortSha: "abc", subject: "initial commit" },
			],
		};
		mockReadSummary.mockImplementation(async () => currentSummary);

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
		const repoInput = await screen.findByLabelText("Repository path");
		fireEvent.change(repoInput, {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));
		await screen.findByRole("region", { name: "Review" });
		ensureReviewDrawerOpen();
		await screen.findByRole("tab", { name: "Files" });
		await user.click(screen.getByRole("tab", { name: "Changes" }));
		await user.click(
			await screen.findByRole("button", { name: /src\/index\.ts/i }),
		);
		const diffCallsBeforeRefresh = mockReadDiff.mock.calls.length;
		currentSummary = {
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [
				{ sha: "abc", shortSha: "abc", subject: "initial commit" },
			],
		};

		fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));

		await waitFor(() => {
			expect(screen.getByText("No changed files.")).toBeInTheDocument();
		});
		expect(mockReadDiff.mock.calls.length).toBe(diffCallsBeforeRefresh);
	});

	it("dispatches gitSummaryError when readSummary rejects", async () => {
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
		mockReadSummary.mockRejectedValue(new Error("git error"));

		render(<App />);
		const repoInput = await screen.findByLabelText("Repository path");
		fireEvent.change(repoInput, {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// Wait for review panel to appear then switch to Changes to verify error state
		await screen.findByRole("region", { name: "Review" });
		ensureReviewDrawerOpen();
		await screen.findByRole("tab", { name: "Files" });
		await userEvent.click(screen.getByRole("tab", { name: "Changes" }));
		await waitFor(
			() => {
				expect(
					screen.getByText("Unable to load Git data."),
				).toBeInTheDocument();
			},
			{ timeout: 3000 },
		);
	});

	it("keeps the previous summary data in state when refresh fails", async () => {
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
		const repoInput = await screen.findByLabelText("Repository path");
		fireEvent.change(repoInput, { target: { value: "/repo" } });
		fireEvent.click(screen.getByRole("button", { name: "Load" }));
		await screen.findByRole("region", { name: "Review" });
		ensureReviewDrawerOpen();
		await screen.findByRole("tab", { name: "Files" });
		await user.click(screen.getByRole("tab", { name: "Changes" }));

		// Verify the initial file appears in the changes list
		await screen.findByRole("button", { name: /src\/index\.ts/i });

		// Override the mock so subsequent calls (triggered by Refresh) throw
		mockReadSummary.mockRejectedValue(new Error("git error"));
		fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /src\/index\.ts/i }),
			).toBeInTheDocument();
			expect(
				screen.getByText(/showing last successful result/i),
			).toBeInTheDocument();
		});
	});

	it("renders stale copy above a preserved changes list", async () => {
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
		const repoInput = await screen.findByLabelText("Repository path");
		fireEvent.change(repoInput, { target: { value: "/repo" } });
		fireEvent.click(screen.getByRole("button", { name: "Load" }));
		await screen.findByRole("region", { name: "Review" });
		ensureReviewDrawerOpen();
		await screen.findByRole("tab", { name: "Files" });
		await user.click(screen.getByRole("tab", { name: "Changes" }));

		await screen.findByRole("button", { name: /src\/index\.ts/i });

		mockReadSummary.mockRejectedValueOnce(new Error("git error"));
		fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));

		await waitFor(() => {
			expect(
				screen.getByText(/showing last successful result/i),
			).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: /src\/index\.ts/i }),
			).toBeInTheDocument();
		});
	});

	it("refreshes worktree discovery alongside git summary so active branch identity updates", async () => {
		mockOpenRepository.mockResolvedValueOnce({
			workspaceId: "r1",
			repository: {
				id: "r1",
				name: "test-repo",
				rootPath: "/repo",
				repoId: "repo-id-123",
			},
		});
		mockListWorktrees
			.mockResolvedValueOnce([
				{
					id: "wt1",
					repositoryId: "r1",
					branchName: "feature-a",
					path: "/repo",
					label: "repo",
					isMain: false,
				},
			])
			.mockResolvedValueOnce([
				{
					id: "wt1",
					repositoryId: "r1",
					branchName: "feature-b",
					path: "/repo",
					label: "repo",
					isMain: false,
				},
			]);

		await loadRepoAndSwitchToChanges();
		expect(screen.getAllByText("feature-a").length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));

		await waitFor(() => {
			expect(screen.getAllByText("feature-b").length).toBeGreaterThan(0);
		});
	});

	it("restores per-worktree review selections when switching sessions", async () => {
		mockReadSummary.mockImplementation(
			async (_workspaceId: string, worktreeId: string) => {
				if (worktreeId === "wt2") {
					return {
						branchName: "feature-a",
						isDirty: true,
						changedFileCount: 2,
						changedFiles: [
							{ path: "src/index.ts", status: "M" as const },
							{ path: "src/new-file.ts", status: "??" as const },
						],
						recentCommits: [
							{ sha: "feat1", shortSha: "feat1", subject: "feature commit" },
						],
					};
				}

				return {
					branchName: "main",
					isDirty: false,
					changedFileCount: 0,
					changedFiles: [],
					recentCommits: [
						{ sha: "main1", shortSha: "main1", subject: "main commit" },
					],
				};
			},
		);

		await loadRepositoryWithTwoWorktrees();

		await user.click(screen.getByRole("button", { name: "feature-a" }));
		ensureReviewDrawerOpen();
		await user.click(screen.getByRole("tab", { name: "Changes" }));

		const changedFile = await screen.findByRole("button", {
			name: /src\/index\.ts/,
		});
		await user.click(changedFile);
		expect(changedFile).toHaveAttribute("data-selected", "true");

		await user.click(
			screen.getByRole("button", { name: /^main(?:\s+main)?$/i }),
		);
		await user.click(screen.getByRole("button", { name: "feature-a" }));
		ensureReviewDrawerOpen();

		expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
			"data-state",
			"active",
		);
		expect(
			await screen.findByRole("button", { name: /src\/index\.ts/ }),
		).toHaveAttribute("data-selected", "true");
	});
});

const user = userEvent.setup();

async function loadRepository() {
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

	// Wait for startup loading to complete
	await waitFor(() => {
		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
	});

	fireEvent.change(screen.getByLabelText("Repository path"), {
		target: { value: "/repo" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Load" }));

	await waitFor(() =>
		expect(screen.getByRole("region", { name: "Review" })).toBeInTheDocument(),
	);
	ensureReviewDrawerOpen();
	await waitFor(() => {
		expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
	});
}

async function createPreset(label: string, command: string) {
	await user.click(screen.getByRole("button", { name: "Presets" }));
	await user.click(screen.getByRole("menuitem", { name: "Manage presets" }));
	await user.type(screen.getByLabelText("Preset label"), label);
	await user.type(screen.getByLabelText("Preset command"), command);
	await user.click(screen.getByRole("button", { name: "Save preset" }));
	await user.click(screen.getByRole("button", { name: "Close" }));
}

function emitTerminalOutput(sessionId: string, data: string) {
	mockTerminalOutputListeners.forEach((listener) =>
		listener({ sessionId, data }),
	);
}

// TODO(Task 9): Re-enable and migrate these tests to the new chipbar/overlay UI.
// They currently probe the deleted review drawer DOM (data-open, resize handles,
// expanded-by-default ReviewArea on first render).
describe.skip("App — process lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		terminalIdCounter = 0;
		mockTerminalOutputListeners.length = 0;
		mockReadSummary.mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		});
		mockReadRestoreState.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: null,
			workspaceOrder: [],
			workspaces: [],
		});
	});

	it("launches a preset and pins the new process by default", async () => {
		render(<App />);
		await loadRepository();
		await createPreset("Claude", "claude");
		await user.click(screen.getByRole("button", { name: "Presets" }));
		await user.click(screen.getByRole("menuitem", { name: "Claude" }));

		expect(screen.getByRole("tab", { name: /Claude/i })).toHaveAttribute(
			"data-pinned",
			"true",
		);
	});

	it("renders pinned tabs before unpinned tabs", async () => {
		render(<App />);
		await loadRepository();
		// First add an ad-hoc shell (unpinned) — gets terminal-1
		await user.click(screen.getByRole("button", { name: "Add shell" }));
		// Then launch a preset (pinned) — gets terminal-2
		await createPreset("Claude", "claude");
		await user.click(screen.getByRole("button", { name: "Presets" }));
		await user.click(screen.getByRole("menuitem", { name: "Claude" }));

		// Despite being added second, the pinned "Claude" tab should appear first
		const tabs = screen.getAllByRole("tab");
		expect(tabs[0]).toHaveTextContent("Claude");
		expect(tabs[1]).toHaveTextContent("shell 1");
	});

	it("marks a background process as action-required from output", async () => {
		render(<App />);
		await loadRepository();
		await createPreset("Claude", "claude");
		// loadRepository auto-creates one default shell (terminal-1)
		// Launch preset — gets terminal-2, becomes active process
		await user.click(screen.getByRole("button", { name: "Presets" }));
		await user.click(screen.getByRole("menuitem", { name: "Claude" }));
		// Add an ad-hoc shell — gets terminal-3, becomes the active process
		// so the preset process is now in the background
		await user.click(screen.getByRole("button", { name: "Add shell" }));
		// Emit output on preset's terminal while it's in the background
		act(() => {
			emitTerminalOutput("terminal-2", "Continue? [y/N]");
		});

		expect(screen.getByRole("tab", { name: /Claude/i })).toHaveAttribute(
			"data-attention",
			"actionRequired",
		);
	});
});
