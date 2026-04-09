import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../src/features/terminals/TerminalPane", () => ({
	TerminalPane: () => null,
}));

vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		setRoot: vi.fn(),
		listWorktrees: vi.fn(),
		previewCreateWorktree: vi.fn(),
		createWorktree: vi.fn(),
		previewRemoveWorktree: vi.fn(),
		removeWorktree: vi.fn(),
	},
	terminals: {
		create: vi.fn((workspaceId: string, worktreeId: string, cwd: string) =>
			Promise.resolve({
				id: `terminal-${worktreeId}-${Date.now()}`,
				workspaceId,
				worktreeId,
				cwd,
				status: "running",
				exitCode: null,
			}),
		),
		sendInput: vi.fn(),
		resize: vi.fn(),
		stop: vi.fn(),
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
		readDiff: vi.fn(),
		readSummary: vi.fn().mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		}),
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
		onOpenPicker: vi.fn(() => vi.fn()),
	},
}));

import { App } from "../../../src/app/App";
import { repository, terminals } from "../../../src/lib/desktop-client";

const mockSetRoot = vi.mocked(repository.setRoot);
const mockListWorktrees = vi.mocked(repository.listWorktrees);
const mockPreviewCreateWorktree = vi.mocked(repository.previewCreateWorktree);
const mockCreateWorktree = vi.mocked(repository.createWorktree);
const mockPreviewRemoveWorktree = vi.mocked(repository.previewRemoveWorktree);
const mockRemoveWorktree = vi.mocked(repository.removeWorktree);
const mockStop = vi.mocked(terminals.stop);

const initialWorktrees = [
	{
		id: "main",
		repositoryId: "r1",
		branchName: "main",
		path: "/repo",
		label: "main",
		isMain: true,
	},
	{
		id: "feature-a",
		repositoryId: "r1",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		label: "feature-a",
		isMain: false,
	},
];

async function loadRepository() {
	mockSetRoot.mockResolvedValueOnce({
		id: "r1",
		name: "repo",
		rootPath: "/repo",
		repoId: "repo-id-123",
	});

	render(<App />);

	await screen.findByLabelText("Repository path");
	fireEvent.change(screen.getByLabelText("Repository path"), {
		target: { value: "/repo" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Load" }));

	await waitFor(() => {
		expect(screen.getByRole("button", { name: "feature-a" })).toBeInTheDocument();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	// mockResolvedValueOnce queues survive vi.clearAllMocks(); reset the queue on
	// the most-overloaded mock to prevent leakage into subsequent tests.
	mockListWorktrees.mockReset();
});

it("previews and creates a new worktree from the sidebar modal", async () => {
	mockListWorktrees
		.mockResolvedValueOnce(initialWorktrees)
		.mockResolvedValueOnce([
			...initialWorktrees,
			{
				id: "feature-b",
				repositoryId: "r1",
				branchName: "feature-b",
				path: "/repo/.worktrees/feature-b",
				label: "feature-b",
				isMain: false,
			},
		]);
	mockPreviewCreateWorktree.mockResolvedValue({
		name: "Feature B",
		branchName: "feature-b",
		path: "/repo/.worktrees/feature-b",
		baseRef: "origin/master",
		baseCommit: {
			sha: "abc123456789",
			shortSha: "abc1234",
			subject: "initial commit",
		},
	});
	mockCreateWorktree.mockResolvedValue({
		id: "feature-b",
		repositoryId: "r1",
		branchName: "feature-b",
		path: "/repo/.worktrees/feature-b",
		label: "feature-b",
		isMain: false,
	});

	await loadRepository();

	await userEvent.click(screen.getByRole("button", { name: "New worktree" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Feature B");

	expect(
		await screen.findByText("This will create a new branch and linked worktree."),
	).toBeInTheDocument();
	expect(await screen.findByText("/repo/.worktrees/feature-b")).toBeInTheDocument();
	expect(screen.getByText("origin/master")).toBeInTheDocument();
	expect(screen.getByText("abc1234 initial commit")).toBeInTheDocument();

	await userEvent.click(screen.getByRole("button", { name: "Create worktree" }));

	expect(mockCreateWorktree).toHaveBeenCalledWith("Feature B");
	expect(await screen.findByRole("button", { name: "feature-b" })).toBeInTheDocument();
});

it("creates a default shell for a worktree recreated after removal with the same id", async () => {
	// Bug: closeProcessesForWorktree never removes the worktree id from
	// defaultShellEnsuredByWorktreeRef, so a recreated worktree with the same id
	// gets no default shell (the Set still contains it from the first visit).
	mockListWorktrees
		.mockResolvedValueOnce(initialWorktrees) // initial load
		.mockResolvedValueOnce([initialWorktrees[0]]) // after remove
		.mockResolvedValueOnce([...initialWorktrees]); // after recreate

	mockPreviewRemoveWorktree.mockResolvedValue({
		worktreeId: "feature-a",
		label: "feature-a",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		isMain: false,
		isDirty: false,
	});
	mockRemoveWorktree.mockResolvedValue(undefined);

	mockPreviewCreateWorktree.mockResolvedValue({
		name: "feature-a",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		baseRef: "origin/master",
		baseCommit: { sha: "abc123456789", shortSha: "abc1234", subject: "initial commit" },
	});
	mockCreateWorktree.mockResolvedValue({
		id: "feature-a",
		repositoryId: "r1",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		label: "feature-a",
		isMain: false,
	});

	await loadRepository();

	// Select feature-a — default shell is auto-created on first visit
	await userEvent.click(screen.getByRole("button", { name: "feature-a" }));
	await waitFor(() => {
		expect(screen.getByRole("tab", { name: /shell 1/i })).toBeInTheDocument();
	});

	const createsBefore = vi.mocked(terminals.create).mock.calls.filter(
		(c) => c[1] === "feature-a",
	).length;
	expect(createsBefore).toBe(1);

	// Remove feature-a (isDirty:false — no confirmation checkbox required)
	fireEvent.contextMenu(screen.getByRole("button", { name: "feature-a" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Remove worktree" }));
	await screen.findByText("Dirty worktree: no");
	await userEvent.click(screen.getByRole("button", { name: "Remove worktree" }));
	await waitFor(() => {
		expect(screen.queryByRole("button", { name: "feature-a" })).not.toBeInTheDocument();
	});

	// Recreate feature-a with the same id/path
	await userEvent.click(screen.getByRole("button", { name: "New worktree" }));
	await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "feature-a");
	// Wait for preview to load (350ms debounce + async mock) before clicking
	await screen.findByText("origin/master");
	await userEvent.click(screen.getByRole("button", { name: "Create worktree" }));
	await waitFor(() => {
		expect(screen.getByRole("button", { name: "feature-a" })).toBeInTheDocument();
	});

	// A default shell must be created for the recreated worktree
	await waitFor(() => {
		const createsAfter = vi.mocked(terminals.create).mock.calls.filter(
			(c) => c[1] === "feature-a",
		).length;
		expect(createsAfter).toBe(2);
	});
});

it("warns about dirty state and running sessions before removing a worktree", async () => {
	mockListWorktrees
		.mockResolvedValueOnce(initialWorktrees)
		.mockResolvedValueOnce([initialWorktrees[0]]);
	mockPreviewRemoveWorktree.mockResolvedValue({
		worktreeId: "feature-a",
		label: "feature-a",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		isMain: false,
		isDirty: true,
	});
	mockRemoveWorktree.mockResolvedValue(undefined);

	await loadRepository();
	await userEvent.click(screen.getByRole("button", { name: "feature-a" }));

	await waitFor(() => {
		expect(screen.getByRole("tab", { name: /shell 1/i })).toBeInTheDocument();
	});

	// Right-click the worktree to open the context menu, then click "Remove worktree"
	fireEvent.contextMenu(screen.getByRole("button", { name: "feature-a" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Remove worktree" }));

	expect(await screen.findByText("Dirty worktree: yes")).toBeInTheDocument();
	expect(screen.getByText("Running app sessions: shell 1")).toBeInTheDocument();

	await userEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
	await userEvent.click(screen.getByRole("button", { name: "Remove worktree" }));

	await waitFor(() => {
		expect(mockStop).toHaveBeenCalled();
	});
	expect(mockRemoveWorktree).toHaveBeenCalledWith("feature-a");
	await waitFor(() => {
		expect(screen.queryByRole("button", { name: "feature-a" })).not.toBeInTheDocument();
	});
});
