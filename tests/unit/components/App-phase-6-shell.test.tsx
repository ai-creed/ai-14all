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
const mockReadCommitHistory = vi.hoisted(() => vi.fn());
const mockReadCommitDetail = vi.hoisted(() => vi.fn());

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
		readCommitHistory: mockReadCommitHistory,
		readCommitDetail: mockReadCommitDetail,
	},
	workspace: {
		readRestoreState: readRestoreStateMock,
		writeRestoreState: writeRestoreStateMock,
	},
}));

import { App } from "../../../src/app/App";

describe("App — Phase 6 default shell", () => {
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
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		});
		writeRestoreStateMock.mockResolvedValue(undefined);
		mockReadCommitHistory.mockResolvedValue([]);
		mockReadCommitDetail.mockResolvedValue(null);
	});

	it("creates one default shell when the selected worktree has no processes", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);

		render(<App />);
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
			expect(createMock).toHaveBeenCalledWith("main", "/repo");
		});
	});

	it("loads commit history and opens a stacked commit diff", async () => {
		mockReadCommitHistory.mockResolvedValue({
			mergeTargetRef: "origin/main",
			entries: [
				{ sha: "abc", shortSha: "abc", subject: "feature commit", isMergeTarget: false },
				{ sha: "base", shortSha: "base", subject: "origin/main", isMergeTarget: true },
			],
		});
		mockReadCommitDetail.mockResolvedValue({
			sha: "abc",
			shortSha: "abc",
			subject: "feature commit",
			files: [
				{
					path: "src/index.ts",
					oldPath: null,
					status: "M",
					originalContent: 'export const hello = "world";\n',
					modifiedContent: 'export const hello = "phase-2";\n',
				},
			],
		});

		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);

		render(<App />);
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await userEvent.click(await screen.findByRole("tab", { name: "Commits" }));
		await userEvent.click(await screen.findByRole("button", { name: /feature commit/i }));

		expect(mockReadCommitDetail).toHaveBeenCalledWith("/repo", "abc");
		// "feature commit" appears in both the commit rail (subject) and the diff header
		await waitFor(() => {
			expect(screen.getAllByText("feature commit").length).toBeGreaterThanOrEqual(1);
		});
		expect(screen.getAllByText("src/index.ts").length).toBeGreaterThan(0);
	});

	it("does not create a duplicate default shell on review-mode changes", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);

		render(<App />);
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		fireEvent.click(await screen.findByRole("tab", { name: "Changes" }));
		fireEvent.click(screen.getByRole("tab", { name: "Files" }));

		expect(createMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the terminal panel body visible when a restored shell has no live terminal yet", async () => {
		createMock.mockImplementation(() => new Promise(() => undefined));
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "alwaysRestore",
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
						selectedCommitSha: null,
						selectedCommitFilePath: null,
						activeProcessSessionId: "process-1",
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
			},
		});
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);

		render(<App />);

		expect(await screen.findByRole("tab", { name: "shell 1" })).toBeInTheDocument();
		expect(
			screen.getByText(/no active shell selected/i),
		).toBeInTheDocument();
		expect(document.querySelector(".shell-terminal-section")).not.toBeNull();
	});

	it("renders a compact top band and hides the note panel when collapsed", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		setRootMock.mockResolvedValue({ id: "repo-1", name: "repo", rootPath: "/repo" });
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "master", isMain: true },
		]);

		render(<App />);
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByLabelText("Session info");
		expect(screen.getByLabelText("Session note panel")).toBeInTheDocument();
		expect(screen.queryByText("Active session")).not.toBeInTheDocument();
		expect(document.querySelectorAll(".shell-top-band.shell-panel")).toHaveLength(1);
		expect(screen.getByRole("button", { name: "Collapse top band" })).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Collapse top band" }));

		expect(screen.queryByLabelText("Session note panel")).not.toBeInTheDocument();
		expect(screen.getAllByText("master").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByRole("button", { name: "Expand top band" })).toBeInTheDocument();
	});
});
