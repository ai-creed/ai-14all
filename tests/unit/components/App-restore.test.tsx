import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock TerminalPane to avoid xterm canvas dependency in jsdom
vi.mock("../../../src/features/terminals/TerminalPane", () => ({
	TerminalPane: ({
		session,
		visible,
	}: {
		session: { id: string };
		visible: boolean;
	}) => (
		<section
			aria-hidden={!visible}
			className="shell-panel shell-terminal-pane"
			data-terminal-session-id={session.id}
			data-testid={`terminal-pane-${session.id}`}
			style={{ display: visible ? "block" : "none" }}
		/>
	),
}));

const createMock = vi.hoisted(() => vi.fn());
const sendInputMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const readRestoreStateMock = vi.hoisted(() => vi.fn());
const writeRestoreStateMock = vi.hoisted(() => vi.fn());
const openRepositoryMock = vi.hoisted(() => vi.fn());
const listWorktreesMock = vi.hoisted(() => vi.fn());
const readSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/lib/desktop-client", () => ({
	workspace: {
		openRepository: openRepositoryMock,
		readRestoreState: readRestoreStateMock,
		writeRestoreState: writeRestoreStateMock,
		onOpenPicker: vi.fn(() => vi.fn()),
	},
	repository: {
		listWorktrees: listWorktreesMock,
		pickRoot: vi.fn(),
		previewCreateWorktree: vi.fn(),
		createWorktree: vi.fn(),
		previewRemoveWorktree: vi.fn(),
		removeWorktree: vi.fn(),
	},
	terminals: {
		create: createMock,
		sendInput: sendInputMock,
		resize: vi.fn(),
		stop: vi.fn(),
		list: listMock,
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
			originalContent: 'export const hello = "world";\n',
			modifiedContent: 'export const hello = "phase-2";\n',
		}),
		readSummary: readSummaryMock,
		readCommitHistory: vi.fn().mockResolvedValue({ mergeTargetRef: null, entries: [] }),
		readCommitDetail: vi.fn().mockResolvedValue(null),
		getRemoteStatus: vi.fn().mockResolvedValue({ hasRemote: false, ahead: 0, behind: 0 }),
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
	},
}));

import { App } from "../../../src/app/App";

describe("App — Phase 5 restore flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset once-queues so that any unconsumed mockResolvedValueOnce entries
		// from a previous test do not bleed into the next test.
		openRepositoryMock.mockReset();
		listWorktreesMock.mockReset();
		createMock.mockImplementation((workspaceId: string, worktreeId: string, cwd: string) =>
			Promise.resolve({
				id: `terminal-${worktreeId}-${cwd}`,
				workspaceId,
				worktreeId,
				cwd,
				status: "running",
				exitCode: null,
			}),
		);
		listMock.mockResolvedValue([]);
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
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/repo",
					selectedWorktreeId: "feature-a",
					commandPresets: [],
					worktreeSessions: [],
				},
			}],
		});

		render(<App />);

		expect(
			await screen.findByRole("button", { name: "Restore previous workspace" }),
		).toBeInTheDocument();
	});

	it("auto-restores on renderer reload when live terminal sessions still exist", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
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
									command: "claude",
									pinned: false,
									terminalSessionId: "live-term-1",
								},
							],
						},
					],
				},
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "ws-main",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);
		listMock.mockResolvedValue([
			{
				id: "live-term-1",
				workspaceId: "ws-main",
				worktreeId: "feature-a",
				cwd: "/repo/.worktrees/feature-a",
				status: "running",
				exitCode: null,
			},
		]);

		render(<App />);

		await waitFor(() => {
			expect(openRepositoryMock).toHaveBeenCalledWith("/repo");
			expect(listMock).toHaveBeenCalledWith("ws-main");
		});
		expect(
			screen.queryByRole("button", { name: "Restore previous workspace" }),
		).not.toBeInTheDocument();
	});

	it("restores the selected worktree, recreates saved shells, and replays commands", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
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
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);

		render(<App />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Restore previous workspace" }),
		);

		await waitFor(() => {
			expect(openRepositoryMock).toHaveBeenCalledWith("/repo");
			expect(createMock).toHaveBeenCalledWith("repo-1", "feature-a", "/repo/.worktrees/feature-a");
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			expect.stringContaining("terminal-feature-a"),
			"claude\n",
		);
		// Open note sheet to verify restored note, then close before checking tabs
		await userEvent.click(await screen.findByRole("button", { name: "Open note" }));
		expect(await screen.findByDisplayValue("resume here")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Close note sheet" }));
		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "Session note" })).not.toBeInTheDocument();
		});
		expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("data-state", "active");
	});

	it("restores saved split-shell layout and clears stale split slots", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/repo",
					selectedWorktreeId: "feature-a",
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: "feature-a",
							note: "resume here",
							reviewMode: "files",
							viewerMode: "file",
							selectedFilePath: null,
							selectedChangedFilePath: null,
							selectedCommitSha: null,
							selectedCommitFilePath: null,
							activeProcessSessionId: "process-1",
							terminalLayoutMode: "split",
							splitLeftProcessId: "process-1",
							splitRightProcessId: "missing-process",
							nextAdHocNumber: 3,
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
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);

		render(<App />);

		expect(await screen.findByRole("button", { name: "Disable split shells" })).toBeInTheDocument();
		expect(screen.getByText(/No shell assigned to this split pane/i)).toBeInTheDocument();
		expect(document.querySelectorAll('.shell-terminal-pane[aria-hidden="false"]')).toHaveLength(1);
	});

	it("reconnects to a live backend session instead of creating a new one", async () => {
		const liveTerminalId = "live-terminal-abc";

		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
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
									command: "claude",
									pinned: false,
									terminalSessionId: liveTerminalId,
								},
							],
						},
					],
				},
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);
		listMock.mockResolvedValue([
			{
				id: liveTerminalId,
				workspaceId: "repo-1",
				worktreeId: "feature-a",
				cwd: "/repo/.worktrees/feature-a",
				status: "running",
				exitCode: null,
			},
		]);

		render(<App />);

		await waitFor(() => {
			expect(createMock).not.toHaveBeenCalled();
			expect(listMock).toHaveBeenCalledWith("repo-1");
		});

		expect(
			document.querySelector(`[data-terminal-session-id="${liveTerminalId}"]`),
		).toBeInTheDocument();
		expect(sendInputMock).not.toHaveBeenCalled();
	});

	it("falls back to fresh creation when persisted terminal session is no longer alive", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
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
									command: "claude",
									pinned: false,
									terminalSessionId: "dead-terminal-xyz",
								},
							],
						},
					],
				},
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);
		listMock.mockResolvedValue([]);

		render(<App />);

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledWith("repo-1", "feature-a", "/repo/.worktrees/feature-a");
		});
		expect(sendInputMock).toHaveBeenCalledWith(
			expect.stringContaining("terminal-feature-a"),
			"claude\n",
		);
	});

	it("lazily hydrates a saved non-selected worktree only after selection", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
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
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
			{ id: "feature-a", repositoryId: "repo-1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature-a", isMain: false },
		]);

		render(<App />);

		await waitFor(() => {
			expect(createMock).not.toHaveBeenCalledWith("repo-1", "main", "/repo");
		});

		fireEvent.click(await screen.findByRole("button", { name: /main/i }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledWith("repo-1", "main", "/repo");
		});
		// Open note sheet to verify restored note
		await userEvent.click(await screen.findByRole("button", { name: "Open note" }));
		expect(await screen.findByDisplayValue("main note")).toBeInTheDocument();
	});

	it("preserves the snapshot when the user chooses start clean", async () => {
		const snapshot = {
			repositoryPath: "/repo",
			selectedWorktreeId: "feature-a",
			commandPresets: [],
			worktreeSessions: [],
		};
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{ workspaceId: "ws-main", repositoryPath: "/repo", repoId: null, snapshot }],
		});

		render(<App />);

		await userEvent.click(
			await screen.findByRole("button", { name: "Start clean" }),
		);

		// The snapshot must survive "start clean" so the user can recover it on
		// a future launch by switching back to prompt or alwaysRestore.
		// With v2 state, it's persisted in workspaces array.
		await waitFor(() => {
			expect(writeRestoreStateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					version: 2,
					workspaces: expect.arrayContaining([
						expect.objectContaining({
							snapshot: expect.objectContaining({
								repositoryPath: "/repo",
							}),
						}),
					]),
				}),
			);
		});
	});

	it("shows a warning, loads the workspace, and preserves the missing session in the next persist write", async () => {
		const missingSession = {
			worktreeId: "missing-worktree",
			note: "saved note for missing worktree",
			reviewMode: "files" as const,
			viewerMode: "file" as const,
			selectedFilePath: null,
			selectedChangedFilePath: null,
			activeProcessSessionId: null,
			nextAdHocNumber: 1,
			processSessions: [],
		};
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/repo",
					selectedWorktreeId: "missing-worktree",
					commandPresets: [],
					worktreeSessions: [missingSession],
				},
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);

		render(<App />);

		// Workspace should load — the repo was found even though the worktree wasn't
		await screen.findByRole("navigation", { name: "Worktree sessions" });

		// A non-blocking status banner must explain what happened
		expect(screen.getByRole("status")).toHaveTextContent(
			/previously selected worktree is no longer available/i,
		);

		// The missing session must survive in the next persist write so it is
		// not permanently lost from the saved state
		await waitFor(() => {
			expect(writeRestoreStateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					version: 2,
					workspaces: expect.arrayContaining([
						expect.objectContaining({
							snapshot: expect.objectContaining({
								worktreeSessions: expect.arrayContaining([
									expect.objectContaining({ worktreeId: "missing-worktree" }),
								]),
							}),
						}),
					]),
				}),
			);
		});

		// Dismissing the banner removes it
		await userEvent.click(screen.getByRole("button", { name: "Dismiss warning" }));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("preserves the snapshot and resets to prompt when alwaysRestore fails", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/deleted-repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/deleted-repo",
					selectedWorktreeId: null,
					commandPresets: [],
					worktreeSessions: [],
				},
			}],
		});
		openRepositoryMock.mockRejectedValue(new Error("No such file or directory"));

		render(<App />);

		await screen.findByRole("button", { name: "Load" });

		await waitFor(() => {
			expect(writeRestoreStateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					restorePreference: "prompt",
					workspaces: expect.arrayContaining([
						expect.objectContaining({
							snapshot: expect.objectContaining({ repositoryPath: "/deleted-repo" }),
						}),
					]),
				}),
			);
		});
	});

	it("preserves the snapshot when restore fails because the saved path is stale", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/old-repo",
				repoId: "repo-id-123",
				snapshot: {
					repositoryPath: "/old-repo",
					repoId: "repo-id-123",
					selectedWorktreeId: null,
					commandPresets: [],
					worktreeSessions: [],
				},
			}],
		});
		openRepositoryMock.mockRejectedValue(new Error("No such file or directory"));

		render(<App />);

		await screen.findByRole("button", { name: "Load" });

		await waitFor(() => {
			expect(writeRestoreStateMock).not.toHaveBeenCalledWith(
				expect.objectContaining({ workspaces: [] }),
			);
		});
	});

	it("silently reattaches a preserved snapshot when the same repo is reopened manually", async () => {
		// Snapshot uses old paths — rebaseSnapshotPaths must rewrite them to match
		// the new worktree IDs returned by listWorktrees.
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/old-repo",
				repoId: "repo-id-123",
				snapshot: {
					repositoryPath: "/old-repo",
					repoId: "repo-id-123",
					selectedWorktreeId: "/old-repo/.worktrees/feature-a",
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: "/old-repo/.worktrees/feature-a",
							note: "resume here",
							reviewMode: "files",
							viewerMode: "file",
							selectedFilePath: null,
							selectedChangedFilePath: null,
							selectedCommitSha: null,
							selectedCommitFilePath: null,
							activeProcessSessionId: null,
							nextAdHocNumber: 1,
							processSessions: [],
						},
					],
				},
			}],
		});

		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/new-repo",
				repoId: "repo-id-123",
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "/new-repo/.worktrees/feature-a",
				repositoryId: "repo-1",
				branchName: "feature-a",
				path: "/new-repo/.worktrees/feature-a",
				label: "feature-a",
				isMain: false,
			},
		]);

		render(<App />);

		// With restorePreference "prompt" the app shows the RestorePrompt.
		// The user clicks "Start clean" to reach the RepositoryInput while
		// keeping the snapshot in restoreState for reattachment.
		await userEvent.click(
			await screen.findByRole("button", { name: "Start clean" }),
		);

		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/new-repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// Open note sheet to verify restored note, then close before checking status
		await userEvent.click(await screen.findByRole("button", { name: "Open note" }));
		expect(await screen.findByDisplayValue("resume here")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Close note sheet" }));
		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "Session note" })).not.toBeInTheDocument();
		});
		expect(screen.getByRole("status")).toHaveTextContent(/recovered/i);
	});

	it("dispatches worktree selection before awaiting terminal recreation", async () => {
		// A deferred promise so we can hold createMock pending
		let resolveTerminal!: (value: { id: string; workspaceId: string; worktreeId: string; cwd: string; status: string; exitCode: null }) => void;
		const terminalPending = new Promise<{ id: string; workspaceId: string; worktreeId: string; cwd: string; status: string; exitCode: null }>(
			(resolve) => {
				resolveTerminal = resolve;
			},
		);
		createMock.mockReturnValueOnce(terminalPending);

		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
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
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
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
		resolveTerminal({ id: "terminal-main-/repo", workspaceId: "repo-1", worktreeId: "main", cwd: "/repo", status: "running", exitCode: null });

		// Eventually createMock was called
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledWith("repo-1", "main", "/repo");
		});
	});

	it("does not reattach when only one side has a repoId", async () => {
		// Snapshot has repoId but loaded repo does not → strict identity fails,
		// basename fallback is suppressed → no reattachment, normal fresh load.
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/old-repo",
				repoId: "repo-id-123",
				snapshot: {
					repositoryPath: "/old-repo",
					repoId: "repo-id-123",
					selectedWorktreeId: "/old-repo/.worktrees/feature-a",
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: "/old-repo/.worktrees/feature-a",
							note: "should not appear",
							reviewMode: "files",
							viewerMode: "file",
							selectedFilePath: null,
							selectedChangedFilePath: null,
							selectedCommitSha: null,
							selectedCommitFilePath: null,
							activeProcessSessionId: null,
							nextAdHocNumber: 1,
							processSessions: [],
						},
					],
				},
			}],
		});

		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "old-repo",
				rootPath: "/new-path/old-repo",
				repoId: null, // repo identity resolution failed
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "/new-path/old-repo",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/new-path/old-repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Start clean" }),
		);
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/new-path/old-repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// Should NOT recover the old note — this is a fresh load
		await screen.findByRole("navigation", { name: "Worktree sessions" });
		expect(screen.queryByDisplayValue("should not appear")).not.toBeInTheDocument();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("appends degraded identity warning when repo.repoId is null during reattachment", async () => {
		// Both sides lack repoId → basename fallback triggers reattachment,
		// but the warning should note that future recovery is degraded.
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/old-path/my-repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/old-path/my-repo",
					repoId: null,
					selectedWorktreeId: "/old-path/my-repo",
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: "/old-path/my-repo",
							note: "degraded note",
							reviewMode: "files",
							viewerMode: "file",
							selectedFilePath: null,
							selectedChangedFilePath: null,
							selectedCommitSha: null,
							selectedCommitFilePath: null,
							activeProcessSessionId: null,
							nextAdHocNumber: 1,
							processSessions: [],
						},
					],
				},
			}],
		});

		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "my-repo",
				rootPath: "/new-path/my-repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "/new-path/my-repo",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/new-path/my-repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Start clean" }),
		);
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/new-path/my-repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// Open note sheet to verify restored note, then close before checking status
		await userEvent.click(await screen.findByRole("button", { name: "Open note" }));
		expect(await screen.findByDisplayValue("degraded note")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Close note sheet" }));
		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "Session note" })).not.toBeInTheDocument();
		});
		expect(screen.getByRole("status")).toHaveTextContent(/folder name matching/i);
	});

	it("reattaches valid sessions while preserving missing worktrees during recovery", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/old-repo",
				repoId: "repo-id-123",
				snapshot: {
					repositoryPath: "/old-repo",
					repoId: "repo-id-123",
					selectedWorktreeId: "missing-worktree",
					commandPresets: [],
					worktreeSessions: [
						{
							worktreeId: "missing-worktree",
							note: "saved note for missing worktree",
							reviewMode: "files" as const,
							viewerMode: "file" as const,
							selectedFilePath: null,
							selectedChangedFilePath: null,
							selectedCommitSha: null,
							selectedCommitFilePath: null,
							activeProcessSessionId: null,
							nextAdHocNumber: 1,
							processSessions: [],
						},
					],
				},
			}],
		});

		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/new-repo",
				repoId: "repo-id-123",
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/new-repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />);
		// Navigate past RestorePrompt (restorePreference: "prompt")
		await userEvent.click(
			await screen.findByRole("button", { name: "Start clean" }),
		);
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/new-repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// App should load (main worktree is available)
		await screen.findByRole("navigation", { name: "Worktree sessions" });

		// The missing worktree session must survive in the next persist write
		await waitFor(() => {
			expect(writeRestoreStateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					version: 2,
					workspaces: expect.arrayContaining([
						expect.objectContaining({
							snapshot: expect.objectContaining({
								worktreeSessions: expect.arrayContaining([
									expect.objectContaining({ worktreeId: "missing-worktree" }),
								]),
							}),
						}),
					]),
				}),
			);
		});

		// A warning banner must explain what happened
		expect(screen.getByRole("status")).toHaveTextContent(/worktree/i);
	});

	it("shows restore failure copy in the blocking setup screen", async () => {
		readRestoreStateMock.mockResolvedValueOnce({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/missing",
				repoId: "repo-1",
				snapshot: {
					repositoryPath: "/missing",
					repoId: "repo-1",
					selectedWorktreeId: null,
					worktreeSessions: [],
				},
			}],
		});
		openRepositoryMock.mockRejectedValueOnce(
			new Error("ENOENT: no such file or directory, realpath '/missing'"),
		);

		render(<App />);

		expect(
			await screen.findByText(/could not reopen the previous workspace/i),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
	});

	it("restores and shows the chip bar with note sheet closed by default", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [{
				workspaceId: "ws-main",
				repositoryPath: "/repo",
				repoId: null,
				snapshot: {
					repositoryPath: "/repo",
					selectedWorktreeId: "main",
					commandPresets: [],
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
							activeProcessSessionId: null,
							nextAdHocNumber: 1,
							processSessions: [],
						},
					],
				},
			}],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: { id: "repo-1", name: "repo", rootPath: "/repo", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main", repositoryId: "repo-1", branchName: "main", path: "/repo", label: "main", isMain: true },
		]);

		render(<App />);

		// Chip bar renders; note sheet is closed by default
		await screen.findByRole("region", { name: "Session" });
		expect(screen.queryByRole("textbox", { name: "Session note" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Open note" })).toBeInTheDocument();
	});

	it("registers non-active saved workspaces as dormant sidebar groups on alwaysRestore", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a", "ws-b"],
			workspaces: [
				{
					workspaceId: "ws-a",
					repositoryPath: "/repo-a",
					repoId: null,
					snapshot: {
						repositoryPath: "/repo-a",
						selectedWorktreeId: "main-a",
						commandPresets: [],
						worktreeSessions: [
							{
								worktreeId: "main-a",
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
				},
				{
					workspaceId: "ws-b",
					repositoryPath: "/repo-b",
					repoId: null,
					snapshot: {
						repositoryPath: "/repo-b",
						selectedWorktreeId: null,
						commandPresets: [],
						worktreeSessions: [],
					},
				},
			],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "ws-a",
			repository: { id: "ws-a", name: "repo-a", rootPath: "/repo-a", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main-a", repositoryId: "ws-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
		]);

		render(<App />);

		const sidebar = await screen.findByRole("navigation", { name: "Worktree sessions" });
		await waitFor(() => {
			expect(within(sidebar).getByRole("group", { name: "repo-a" })).toBeInTheDocument();
			expect(within(sidebar).getByRole("group", { name: "repo-b" })).toBeInTheDocument();
		});

		expect(within(sidebar).getByRole("group", { name: "repo-a" })).toHaveAttribute("data-active-workspace", "true");
		expect(within(sidebar).getByRole("group", { name: "repo-b" })).toHaveAttribute("data-active-workspace", "false");
	});

	it("hydrates a dormant restored workspace on first selection", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a", "ws-b"],
			workspaces: [
				{
					workspaceId: "ws-a",
					repositoryPath: "/repo-a",
					repoId: "repo-id-a",
					snapshot: { repositoryPath: "/repo-a", repoId: "repo-id-a", selectedWorktreeId: null, commandPresets: [], worktreeSessions: [] },
				},
				{
					workspaceId: "ws-b",
					repositoryPath: "/repo-b",
					repoId: "repo-id-b",
					snapshot: { repositoryPath: "/repo-b", repoId: "repo-id-b", selectedWorktreeId: null, commandPresets: [], worktreeSessions: [] },
				},
			],
		});

		openRepositoryMock.mockResolvedValue({
			workspaceId: "ws-a",
			repository: { id: "repo-a", name: "repo-a", rootPath: "/repo-a", repoId: "repo-id-a" },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "/repo-a", repositoryId: "repo-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
		]);

		render(<App />);

		// Wait for initial restore to complete
		await screen.findByRole("group", { name: "repo-b" });

		// Now clicking repo-b should trigger openRepository for /repo-b
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "ws-b",
			repository: { id: "repo-b", name: "repo-b", rootPath: "/repo-b", repoId: "repo-id-b" },
		});
		listWorktreesMock.mockResolvedValueOnce([
			{ id: "/repo-b", repositoryId: "repo-b", branchName: "main", path: "/repo-b", label: "main", isMain: true },
		]);

		await userEvent.click(screen.getByRole("button", { name: "repo-b" }));
		expect(openRepositoryMock).toHaveBeenCalledWith("/repo-b");
	});

	it("registers non-active saved workspaces as dormant sidebar groups after user confirms restore", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "prompt",
			activeWorkspaceId: "ws-a",
			workspaceOrder: ["ws-a", "ws-b"],
			workspaces: [
				{
					workspaceId: "ws-a",
					repositoryPath: "/repo-a",
					repoId: null,
					snapshot: {
						repositoryPath: "/repo-a",
						selectedWorktreeId: "main-a",
						commandPresets: [],
						worktreeSessions: [
							{
								worktreeId: "main-a",
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
				},
				{
					workspaceId: "ws-b",
					repositoryPath: "/repo-b",
					repoId: null,
					snapshot: {
						repositoryPath: "/repo-b",
						selectedWorktreeId: null,
						commandPresets: [],
						worktreeSessions: [],
					},
				},
			],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "ws-a",
			repository: { id: "ws-a", name: "repo-a", rootPath: "/repo-a", repoId: null },
		});
		listWorktreesMock.mockResolvedValue([
			{ id: "main-a", repositoryId: "ws-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
		]);

		render(<App />);

		// Confirm restore via the prompt
		await userEvent.click(
			await screen.findByRole("button", { name: "Restore previous workspace" }),
		);

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		await waitFor(() => {
			expect(within(sidebar).getByRole("group", { name: "repo-a" })).toBeInTheDocument();
			expect(within(sidebar).getByRole("group", { name: "repo-b" })).toBeInTheDocument();
		});

		expect(within(sidebar).getByRole("group", { name: "repo-a" })).toHaveAttribute("data-active-workspace", "true");
		expect(within(sidebar).getByRole("group", { name: "repo-b" })).toHaveAttribute("data-active-workspace", "false");
	});
});
