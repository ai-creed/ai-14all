import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockTerminalOutputListeners: Array<
	(event: { sessionId: string; data: string }) => void
> = [];

let terminalIdCounter = 0;

// Mock TerminalPane to avoid xterm canvas dependency in jsdom
vi.mock("../../../src/features/terminals/TerminalPane", () => ({
	TerminalPane: () => null,
}));

// Mock desktop-client before importing App
vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		setRoot: vi.fn(),
		listWorktrees: vi.fn(),
	},
	terminals: {
		create: vi.fn(() =>
			Promise.resolve({
				id: `terminal-${++terminalIdCounter}`,
				worktreeId: "wt1",
				cwd: "/repo",
				status: "running",
				exitCode: null,
			}),
		),
		sendInput: vi.fn(),
		resize: vi.fn(),
		stop: vi.fn(),
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
		readCommitHistory: vi.fn().mockResolvedValue({ mergeTargetRef: null, entries: [] }),
		readCommitDetail: vi.fn().mockResolvedValue(null),
	},
	workspace: {
		readRestoreState: vi.fn().mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		}),
		writeRestoreState: vi.fn(),
	},
}));

import { App } from "../../../src/app/App";
import { repository, git, workspace } from "../../../src/lib/desktop-client";

const mockSetRoot = vi.mocked(repository.setRoot);
const mockListWorktrees = vi.mocked(repository.listWorktrees);
const mockReadSummary = vi.mocked(git.readSummary);
const mockReadDiff = vi.mocked(git.readDiff);
const mockReadRestoreState = vi.mocked(workspace.readRestoreState);

async function loadRepoAndSwitchToChanges() {
	mockSetRoot.mockResolvedValueOnce({
		id: "r1",
		name: "test-repo",
		rootPath: "/repo",
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

	// Wait for the workspace to appear
	await waitFor(() => {
		expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
	});

	// Switch to "changes" review mode
	fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
}

async function loadRepositoryWithTwoWorktrees() {
	mockSetRoot.mockResolvedValueOnce({
		id: "r1",
		name: "test-repo",
		rootPath: "/repo",
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
			screen.getByRole("button", { name: /feature-a/i }),
		).toBeInTheDocument();
	});
}

describe("App — refresh changes button", () => {
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
		});
		mockReadRestoreState.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
	});

	it("shows a Refresh button when review mode is 'changes'", async () => {
		await loadRepoAndSwitchToChanges();

		expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
	});

	it("does not show a Refresh button when review mode is 'files'", async () => {
		await loadRepoAndSwitchToChanges();

		// Switch back to files
		fireEvent.click(screen.getByRole("tab", { name: "Files" }));

		expect(
			screen.queryByRole("button", { name: "Refresh" }),
		).not.toBeInTheDocument();
	});

	it("clicking Refresh re-fetches git changes", async () => {
		await loadRepoAndSwitchToChanges();

		const callCountBefore = mockReadSummary.mock.calls.length;

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

		await waitFor(() => {
			expect(mockReadSummary.mock.calls.length).toBeGreaterThan(
				callCountBefore,
			);
		});
	});

	it("supports keyboard review-mode switching", async () => {
		mockSetRoot.mockResolvedValueOnce({
			id: "r1",
			name: "test-repo",
			rootPath: "/repo",
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

		const filesTab = await screen.findByRole("tab", { name: "Files" });
		filesTab.focus();
		fireEvent.keyDown(filesTab, { key: "ArrowRight" });

		expect(
			await screen.findByRole("button", { name: "Refresh" }),
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
		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

		await waitFor(() => {
			expect(mockReadSummary.mock.calls.length).toBeGreaterThan(before);
		});
	});

	it("dispatches gitSummaryError when readSummary rejects", async () => {
		mockReadSummary.mockRejectedValueOnce(new Error("git error"));

		await loadRepoAndSwitchToChanges();

		expect(screen.getByText("Unknown")).toBeInTheDocument();
	});

	it("restores per-worktree review selections when switching sessions", async () => {
		mockReadSummary
			.mockResolvedValueOnce({
				branchName: "main",
				isDirty: false,
				changedFileCount: 0,
				changedFiles: [],
				recentCommits: [
					{ sha: "main1", shortSha: "main1", subject: "main commit" },
				],
			})
			.mockResolvedValueOnce({
				branchName: "feature-a",
				isDirty: true,
				changedFileCount: 2,
				changedFiles: [
					{ path: "src/index.ts", status: "M" },
					{ path: "src/new-file.ts", status: "??" },
				],
				recentCommits: [
					{ sha: "feat1", shortSha: "feat1", subject: "feature commit" },
				],
			})
			.mockResolvedValueOnce({
				branchName: "main",
				isDirty: false,
				changedFileCount: 0,
				changedFiles: [],
				recentCommits: [
					{ sha: "main1", shortSha: "main1", subject: "main commit" },
				],
			})
			.mockResolvedValueOnce({
				branchName: "feature-a",
				isDirty: true,
				changedFileCount: 2,
				changedFiles: [
					{ path: "src/index.ts", status: "M" },
					{ path: "src/new-file.ts", status: "??" },
				],
				recentCommits: [
					{ sha: "feat1", shortSha: "feat1", subject: "feature commit" },
				],
			});

		await loadRepositoryWithTwoWorktrees();

		await user.click(screen.getByRole("button", { name: /feature-a/i }));
		await user.click(screen.getByRole("tab", { name: "Changes" }));

		const changedFile = await screen.findByRole("button", {
			name: /src\/index\.ts/,
		});
		await user.click(changedFile);
		expect(changedFile).toHaveAttribute("data-selected", "true");

		await user.click(
			screen.getByRole("button", { name: /^main(?:\s+main)?$/i }),
		);
		await user.click(screen.getByRole("button", { name: /feature-a/i }));

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
	mockSetRoot.mockResolvedValueOnce({
		id: "r1",
		name: "test-repo",
		rootPath: "/repo",
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

	await waitFor(() => {
		expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
	});
}

async function createPreset(label: string, command: string) {
	await user.click(screen.getByRole("button", { name: "Manage presets" }));
	await user.type(screen.getByLabelText("Preset label"), label);
	await user.type(screen.getByLabelText("Preset command"), command);
	await user.click(screen.getByRole("button", { name: "Save preset" }));
	await user.click(screen.getByRole("button", { name: "Close dialog" }));
}

function emitTerminalOutput(sessionId: string, data: string) {
	mockTerminalOutputListeners.forEach((listener) =>
		listener({ sessionId, data }),
	);
}

describe("App — process lifecycle", () => {
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
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
	});

	it("launches a preset and pins the new process by default", async () => {
		render(<App />);
		await loadRepository();
		await createPreset("Claude", "claude");
		await user.click(screen.getByRole("button", { name: "Launch preset" }));
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
		await user.click(screen.getByRole("button", { name: "+ Shell" }));
		// Then launch a preset (pinned) — gets terminal-2
		await createPreset("Claude", "claude");
		await user.click(screen.getByRole("button", { name: "Launch preset" }));
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
		await user.click(screen.getByRole("button", { name: "Launch preset" }));
		await user.click(screen.getByRole("menuitem", { name: "Claude" }));
		// Add an ad-hoc shell — gets terminal-3, becomes the active process
		// so the preset process is now in the background
		await user.click(screen.getByRole("button", { name: "+ Shell" }));
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
