import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock TerminalPane to avoid xterm canvas dependency in jsdom
vi.mock("../../../src/features/terminals/TerminalPane", () => ({
	TerminalPane: () => null,
}));

const createMock = vi.hoisted(() => vi.fn());
const sendInputMock = vi.hoisted(() => vi.fn());
const readRestoreStateMock = vi.hoisted(() => vi.fn());
const writeRestoreStateMock = vi.hoisted(() => vi.fn());
const setRootMock = vi.hoisted(() => vi.fn());
const listWorktreesMock = vi.hoisted(() => vi.fn());
const readSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/lib/desktop-client", () => ({
	repository: {
		setRoot: setRootMock,
		listWorktrees: listWorktreesMock,
	},
	terminals: {
		create: createMock,
		sendInput: sendInputMock,
		resize: vi.fn(),
		stop: vi.fn(),
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	files: {
		list: vi.fn().mockResolvedValue([]),
		listScoped: vi.fn().mockResolvedValue(["src/index.ts"]),
		read: vi.fn().mockResolvedValue({ path: "README.md", content: "" }),
	},
	git: {
		listChanges: vi.fn().mockResolvedValue([]),
		readDiff: vi.fn().mockResolvedValue({
			path: "src/index.ts",
			content: "diff --git a/src/index.ts b/src/index.ts\n",
		}),
		readSummary: readSummaryMock,
	},
	workspace: {
		readRestoreState: readRestoreStateMock,
		writeRestoreState: writeRestoreStateMock,
	},
}));

import { App } from "../../../src/app/App";

describe("App — Phase 5 restore flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createMock.mockImplementation((worktreeId: string, cwd: string) =>
			Promise.resolve({
				id: `terminal-${worktreeId}-${cwd}`,
				worktreeId,
				cwd,
				status: "running",
				exitCode: null,
			}),
		);
		readSummaryMock.mockResolvedValue({
			branchName: "feature-a",
			isDirty: true,
			changedFileCount: 1,
			changedFiles: [{ path: "src/index.ts", status: "M" }],
			recentCommits: [{ sha: "abc", shortSha: "abc", subject: "initial commit" }],
		});
		writeRestoreStateMock.mockResolvedValue(undefined);
	});

	it("shows the restore prompt when a promptable snapshot exists", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: {
				repositoryPath: "/repo",
				selectedWorktreeId: "feature-a",
				commandPresets: [],
				worktreeSessions: [],
			},
		});

		render(<App />);

		expect(
			await screen.findByRole("button", { name: "Restore previous workspace" }),
		).toBeInTheDocument();
	});

	it("restores the selected worktree, recreates saved shells, and replays commands", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: {
				repositoryPath: "/repo",
				selectedWorktreeId: "feature-a",
				commandPresets: [{ id: "preset-claude", label: "Claude", command: "claude" }],
				worktreeSessions: [
					{
						worktreeId: "feature-a",
						note: "resume here",
						reviewMode: "changes",
						viewerMode: "diff",
						selectedFilePath: null,
						selectedChangedFilePath: "src/index.ts",
						activeProcessSessionId: "process-1",
						nextAdHocNumber: 3,
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
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);

		render(<App />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Restore previous workspace" }),
		);

		await waitFor(() => {
			expect(setRootMock).toHaveBeenCalledWith("/repo");
			expect(createMock).toHaveBeenCalledWith("feature-a", "/repo/.worktrees/feature-a");
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			expect.stringContaining("terminal-feature-a"),
			"claude\n",
		);
		expect(await screen.findByDisplayValue("resume here")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("data-state", "active");
	});

	it("lazily hydrates a saved non-selected worktree only after selection", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "alwaysRestore",
			snapshot: {
				repositoryPath: "/repo",
				selectedWorktreeId: "feature-a",
				commandPresets: [],
				worktreeSessions: [
					{
						worktreeId: "main",
						note: "main note",
						reviewMode: "files",
						viewerMode: "file",
						selectedFilePath: "README.md",
						selectedChangedFilePath: null,
						activeProcessSessionId: "process-main",
						nextAdHocNumber: 2,
						processSessions: [
							{ id: "process-main", origin: "adHoc", presetId: null, label: "shell 1", command: null, pinned: false },
						],
					},
					{
						worktreeId: "feature-a",
						note: "feature note",
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
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);

		render(<App />);

		await waitFor(() => {
			expect(createMock).not.toHaveBeenCalledWith("main", "/repo");
		});

		fireEvent.click(await screen.findByRole("button", { name: /main/i }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledWith("main", "/repo");
		});
		expect(await screen.findByDisplayValue("main note")).toBeInTheDocument();
	});

	it("dispatches worktree selection before awaiting terminal recreation", async () => {
		// A deferred promise so we can hold createMock pending
		let resolveTerminal!: (value: { id: string; worktreeId: string; cwd: string; status: string; exitCode: null }) => void;
		const terminalPending = new Promise<{ id: string; worktreeId: string; cwd: string; status: string; exitCode: null }>(
			(resolve) => {
				resolveTerminal = resolve;
			},
		);
		createMock.mockReturnValueOnce(terminalPending);

		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "alwaysRestore",
			snapshot: {
				repositoryPath: "/repo",
				selectedWorktreeId: "feature-a",
				commandPresets: [],
				worktreeSessions: [
					{
						worktreeId: "main",
						note: "main note",
						reviewMode: "files",
						viewerMode: "file",
						selectedFilePath: null,
						selectedChangedFilePath: null,
						activeProcessSessionId: "process-main",
						nextAdHocNumber: 2,
						processSessions: [
							{ id: "process-main", origin: "adHoc", presetId: null, label: "shell 1", command: null, pinned: false },
						],
					},
					{
						worktreeId: "feature-a",
						note: "feature note",
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
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);

		render(<App />);

		// Wait for the app to finish auto-restoring (feature-a has no processes so createMock isn't called for it)
		const mainButton = await screen.findByRole("button", { name: /main/i });

		// Click main — triggers lazy hydration
		fireEvent.click(mainButton);

		// The sidebar selection should update immediately, before terminal creation resolves
		await waitFor(() => {
			expect(mainButton).toHaveAttribute("data-selected", "true");
		});

		// Resolve terminal creation
		resolveTerminal({ id: "terminal-main-/repo", worktreeId: "main", cwd: "/repo", status: "running", exitCode: null });

		// Eventually createMock was called
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledWith("main", "/repo");
		});
	});
});
