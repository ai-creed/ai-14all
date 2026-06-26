import { describe, it, expect, vi, beforeEach } from "vitest";
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
	TerminalPane: ({
		session,
		visible,
		onActivate,
	}: {
		session: { id: string };
		visible: boolean;
		onActivate?: () => void;
	}) => (
		<section
			aria-hidden={!visible}
			className="shell-panel shell-terminal-pane"
			data-terminal-session-id={session.id}
			data-testid={`terminal-pane-${session.id}`}
			onMouseDown={onActivate}
			style={{ display: visible ? "block" : "none" }}
		/>
	),
}));

const createMock = vi.hoisted(() => vi.fn());
const sendInputMock = vi.hoisted(() => vi.fn());
const readRestoreStateMock = vi.hoisted(() => vi.fn());
const writeRestoreStateMock = vi.hoisted(() => vi.fn());
const openRepositoryMock = vi.hoisted(() => vi.fn());
const listWorktreesMock = vi.hoisted(() => vi.fn());
const readSummaryMock = vi.hoisted(() => vi.fn());
const mockReadCommitHistory = vi.hoisted(() => vi.fn());
const mockReadCommitDetail = vi.hoisted(() => vi.fn());
const outputListenersRef = vi.hoisted(() => ({
	current: [] as Array<(event: { sessionId: string; data: string }) => void>,
}));
const openPickerListenerRef = vi.hoisted(() => ({
	current: null as null | (() => void),
}));
const onOpenPickerMock = vi.hoisted(() =>
	vi.fn((listener: () => void) => {
		openPickerListenerRef.current = listener;
		return () => {
			if (openPickerListenerRef.current === listener) {
				openPickerListenerRef.current = null;
			}
		};
	}),
);

vi.mock("../../../src/lib/desktop-client", () => ({
	workspace: {
		openRepository: openRepositoryMock,
		readRestoreState: readRestoreStateMock,
		writeRestoreState: writeRestoreStateMock,
		onOpenPicker: onOpenPickerMock,
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
		onOutput: vi.fn(
			(listener: (event: { sessionId: string; data: string }) => void) => {
				outputListenersRef.current.push(listener);
				return () => {
					outputListenersRef.current = outputListenersRef.current.filter(
						(current) => current !== listener,
					);
				};
			},
		),
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
		readCommitHistory: mockReadCommitHistory,
		readCommitDetail: mockReadCommitDetail,
		readCommitFileDiff: vi.fn(
			async (
				_w,
				_wt,
				_sha,
				file: { path: string; oldPath: string | null; status: string },
			) => ({
				path: file.path,
				oldPath: file.oldPath,
				status: file.status,
				originalContent: "original\n",
				modifiedContent: "modified\n",
			}),
		),
		getRemoteStatus: vi
			.fn()
			.mockResolvedValue({ hasRemote: false, ahead: 0, behind: 0 }),
	},
	diagnostics: {
		logShellEvent: vi.fn(() => Promise.resolve()),
		logAttentionEvent: vi.fn(),
		getAgentAttentionStatus: vi.fn(() =>
			Promise.resolve({ mode: "off", logsDir: "" }),
		),
	},
	system: {
		onUpdateAvailable: vi.fn(() => vi.fn()),
		onUpdateDownloaded: vi.fn(() => vi.fn()),
		onUpdateError: vi.fn(() => vi.fn()),
		installUpdate: vi.fn(() => Promise.resolve()),
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
	app: {
		setEditorDirty: vi.fn(),
		confirmClose: vi.fn(),
		onRequestClose: vi.fn(() => () => {}),
	},
	plugins: {
		list: vi.fn().mockResolvedValue([]),
		setEnabled: vi.fn().mockResolvedValue([]),
		reprobe: vi.fn().mockResolvedValue([]),
		agentClis: vi.fn().mockResolvedValue({
			claude: { kind: "not-found" },
			codex: { kind: "not-found" },
			ezio: { kind: "not-found" },
		}),
		runWhisperCommand: vi.fn(),
		onStateChanged: vi.fn(() => vi.fn()),
		onWhisperStateChanged: vi.fn(() => vi.fn()),
		publishSamanthaSessionState: vi.fn(),
		onSamanthaHealth: vi.fn(() => vi.fn()),
		onSamanthaFocusWorktree: vi.fn(() => vi.fn()),
	},
}));

import { App } from "../../../src/app/App";
import { CommandRegistryProvider } from "../../../src/features/command-palette/components/CommandRegistryProvider";

describe("App — Phase 6 default shell", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		let terminalCount = 0;
		createMock.mockImplementation(
			(workspaceId: string, worktreeId: string, cwd: string) =>
				Promise.resolve({
					id: `terminal-${worktreeId}-${terminalCount++}`,
					workspaceId,
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
		outputListenersRef.current = [];
		openPickerListenerRef.current = null;
	});

	it("creates one default shell when the selected worktree has no processes", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
			expect(createMock).toHaveBeenCalledWith("repo-1", "main", "/repo");
		});
	});

	it("loads commit history and opens a stacked commit diff", async () => {
		mockReadCommitHistory.mockResolvedValue({
			mergeTargetRef: "origin/main",
			entries: [
				{
					sha: "abc",
					shortSha: "abc",
					subject: "feature commit",
					isMergeTarget: false,
				},
				{
					sha: "base",
					shortSha: "base",
					subject: "origin/main",
					isMergeTarget: true,
				},
			],
		});
		mockReadCommitDetail.mockResolvedValue({
			sha: "abc",
			shortSha: "abc",
			subject: "feature commit",
			files: [{ path: "src/index.ts", oldPath: null, status: "M" }],
		});

		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByTestId("review-chipbar");
		ensureReviewOverlayOpen();
		await userEvent.click(await screen.findByRole("tab", { name: "Commits" }));
		await userEvent.click(
			await screen.findByRole("button", { name: /feature commit/i }),
		);

		expect(mockReadCommitDetail).toHaveBeenCalledWith("repo-1", "main", "abc");
		// "feature commit" appears in both the commit rail (subject) and the diff header
		await waitFor(() => {
			expect(
				screen.getAllByText("feature commit").length,
			).toBeGreaterThanOrEqual(1);
		});
		const selectedRow = screen
			.getByRole("button", { name: /feature commit/i })
			.closest(".shell-commit-list__row");
		expect(selectedRow).not.toBeNull();
		await waitFor(() => {
			expect(
				within(selectedRow as HTMLElement).getByRole("button", {
					name: /src\/index\.ts/i,
				}),
			).toBeInTheDocument();
		});
	});

	it("does not create a duplicate default shell on review-mode changes", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		await screen.findByTestId("review-chipbar");
		ensureReviewOverlayOpen();
		fireEvent.click(await screen.findByRole("tab", { name: "Changes" }));
		fireEvent.click(screen.getByRole("tab", { name: "Files" }));

		expect(createMock).toHaveBeenCalledTimes(1);
	});

	it("renders review tabs inside the rail panel and supports temporary resizing", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		readSummaryMock.mockResolvedValue({
			branchName: "main",
			isDirty: true,
			changedFileCount: 1,
			changedFiles: [{ path: "src/index.ts", status: "M" }],
			recentCommits: [],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByTestId("review-chipbar");
		ensureReviewOverlayOpen();
		const reviewRail = await screen.findByTestId("review-rail");
		expect(reviewRail).toContainElement(
			within(reviewRail).getByRole("tablist", { name: "Review mode" }),
		);
		expect(reviewRail).toContainElement(
			within(reviewRail).getByRole("tab", { name: "Files" }),
		);
		// Refresh review uses the shared `ReviewBarButton` (rectangle text)
		// styling, matching the expanded-portal counterpart.
		expect(
			screen.getAllByRole("button", { name: "Refresh review" })[0],
		).toHaveClass("shell-review-chipbar__open-btn");

		const reviewGrid = screen.getByTestId("review-grid");
		const resizeHandle = screen.getByTestId("review-rail-resize-handle");

		expect(reviewGrid).toHaveStyle({
			gridTemplateColumns: "320px 8px minmax(0, 1fr)",
		});

		fireEvent.mouseDown(resizeHandle, { clientX: 320 });
		fireEvent.mouseMove(window, { clientX: 420 });
		fireEvent.mouseUp(window);

		await waitFor(() => {
			expect(reviewGrid).toHaveStyle({
				gridTemplateColumns: "420px 8px minmax(0, 1fr)",
			});
		});

		await userEvent.click(
			within(reviewRail).getByRole("tab", { name: "Commits" }),
		);
		expect(
			screen.getAllByRole("button", { name: "Refresh review" })[0],
		).toHaveClass("shell-review-chipbar__open-btn");
	});

	it("keeps the terminal panel body visible when a restored shell has no live terminal yet", async () => {
		createMock.mockImplementation(() => new Promise(() => undefined));
		readRestoreStateMock.mockResolvedValue({
			version: 2,
			restorePreference: "alwaysRestore",
			activeWorkspaceId: "ws-main",
			workspaceOrder: ["ws-main"],
			workspaces: [
				{
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
				},
			],
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });

		// The restored shell occupies slot 0 even with no live terminal session yet
		// (slot header renders; the xterm pane simply does not mount).
		expect(await screen.findByTestId("slot-0")).toBeInTheDocument();
		expect(screen.getAllByText("shell 1").length).toBeGreaterThan(0);
		expect(document.querySelector(".shell-terminal-section")).not.toBeNull();
	});

	it("ages a sidebar shell from active preview to idle quiet hint", async () => {
		vi.useFakeTimers();

		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		try {
			await act(async () => {
				render(<App />, { wrapper: CommandRegistryProvider });
				await Promise.resolve();
				await Promise.resolve();
			});

			fireEvent.change(screen.getByLabelText("Repository path"), {
				target: { value: "/repo" },
			});

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Load" }));
				await Promise.resolve();
				await Promise.resolve();
			});

			expect(screen.getAllByText("shell 1").length).toBeGreaterThan(0);

			await act(async () => {
				for (const listener of outputListenersRef.current) {
					listener({
						sessionId: "terminal-main-0",
						data: "compiled in 124ms\n",
					});
				}
			});

			expect(screen.getByText("compiled in 124ms")).toBeInTheDocument();

			act(() => {
				vi.advanceTimersByTime(11_000);
			});

			expect(screen.getByText("quiet for 11s")).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders the chip bar and toggles the note sheet", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "master",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByRole("region", { name: "Session" });
		expect(screen.queryByText("Active session")).not.toBeInTheDocument();
		expect(document.querySelectorAll(".shell-chip-bar")).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: "Open note" }),
		).toBeInTheDocument();

		// Note sheet is closed by default
		expect(
			screen.queryByRole("textbox", { name: "Session note" }),
		).not.toBeInTheDocument();

		// Open note sheet
		await userEvent.click(screen.getByRole("button", { name: "Open note" }));
		expect(
			await screen.findByRole("textbox", { name: "Session note" }),
		).toBeInTheDocument();
		expect(screen.getAllByText("master").length).toBeGreaterThanOrEqual(1);
	});

	it("returns to the repository picker when the workspace menu action fires", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "master",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByRole("region", { name: "Session" });
		expect(openPickerListenerRef.current).not.toBeNull();

		openPickerListenerRef.current?.();

		expect(await screen.findByLabelText("Repository path")).toBeInTheDocument();
	});

	it("collapses the sidebar into a thin rail and reopens it", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "feature-a",
				repositoryId: "repo-1",
				branchName: "feature-a",
				path: "/repo/.worktrees/feature-a",
				label: "feature-a",
				isMain: false,
			},
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		const shellLayout = await screen.findByTestId("shell-layout");
		const nav = screen.getByRole("navigation", { name: "Worktree sessions" });
		expect(shellLayout).toHaveStyle({
			gridTemplateColumns: "240px minmax(0, 1fr)",
		});
		expect(within(nav).getByText("feature-a")).toBeInTheDocument();

		await userEvent.click(
			within(nav).getByRole("button", { name: "Collapse sidebar" }),
		);

		expect(shellLayout).toHaveStyle({
			gridTemplateColumns: "68px minmax(0, 1fr)",
		});
		expect(nav).toHaveAttribute("data-collapsed", "true");
		expect(within(nav).queryByText("feature-a")).not.toBeInTheDocument();
		expect(
			within(nav).getByRole("button", { name: "feature-a" }),
		).toHaveTextContent("F");

		await userEvent.click(
			within(nav).getByRole("button", { name: "Expand sidebar" }),
		);

		expect(shellLayout).toHaveStyle({
			gridTemplateColumns: "240px minmax(0, 1fr)",
		});
		expect(nav).toHaveAttribute("data-collapsed", "false");
		expect(within(nav).getByText("feature-a")).toBeInTheDocument();
	});

	it("resizes the sidebar by dragging the resize handle", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		const layout = await screen.findByTestId("shell-layout");
		const resizeHandle = screen.getByTestId("sidebar-resize-handle");

		expect(layout).toHaveStyle({ gridTemplateColumns: "240px minmax(0, 1fr)" });

		fireEvent.mouseDown(resizeHandle, { clientX: 240 });
		fireEvent.mouseMove(window, { clientX: 350 });
		fireEvent.mouseUp(window);

		await waitFor(() => {
			expect(layout).toHaveStyle({
				gridTemplateColumns: "350px minmax(0, 1fr)",
			});
		});
	});

	it("clamps sidebar width to minimum 180px", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		const layout = await screen.findByTestId("shell-layout");
		const resizeHandle = screen.getByTestId("sidebar-resize-handle");

		fireEvent.mouseDown(resizeHandle, { clientX: 240 });
		fireEvent.mouseMove(window, { clientX: 50 });
		fireEvent.mouseUp(window);

		await waitFor(() => {
			expect(layout).toHaveStyle({
				gridTemplateColumns: "180px minmax(0, 1fr)",
			});
		});
	});

	it("clamps sidebar width to maximum 480px", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		const layout = await screen.findByTestId("shell-layout");
		const resizeHandle = screen.getByTestId("sidebar-resize-handle");

		fireEvent.mouseDown(resizeHandle, { clientX: 240 });
		fireEvent.mouseMove(window, { clientX: 900 });
		fireEvent.mouseUp(window);

		await waitFor(() => {
			expect(layout).toHaveStyle({
				gridTemplateColumns: "480px minmax(0, 1fr)",
			});
		});
	});

	it("hides the resize handle when sidebar is collapsed", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		expect(
			await screen.findByTestId("sidebar-resize-handle"),
		).toBeInTheDocument();

		const collapseButton = screen.getByRole("button", {
			name: /collapse sidebar/i,
		});
		await userEvent.click(collapseButton);

		await waitFor(() => {
			expect(
				screen.queryByTestId("sidebar-resize-handle"),
			).not.toBeInTheDocument();
		});

		const layout = screen.getByTestId("shell-layout");
		expect(layout).toHaveStyle({ gridTemplateColumns: "68px minmax(0, 1fr)" });
	});

	it("preserves sidebar width after collapse and expand", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "main",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		const layout = await screen.findByTestId("shell-layout");
		const resizeHandle = screen.getByTestId("sidebar-resize-handle");

		// Widen sidebar to 400px
		fireEvent.mouseDown(resizeHandle, { clientX: 240 });
		fireEvent.mouseMove(window, { clientX: 400 });
		fireEvent.mouseUp(window);

		await waitFor(() => {
			expect(layout).toHaveStyle({
				gridTemplateColumns: "400px minmax(0, 1fr)",
			});
		});

		// Collapse
		const collapseButton = screen.getByRole("button", {
			name: /collapse sidebar/i,
		});
		await userEvent.click(collapseButton);
		await waitFor(() => {
			expect(layout).toHaveStyle({
				gridTemplateColumns: "68px minmax(0, 1fr)",
			});
		});

		// Expand — width should be preserved
		const expandButton = screen.getByRole("button", {
			name: /expand sidebar/i,
		});
		await userEvent.click(expandButton);
		await waitFor(() => {
			expect(layout).toHaveStyle({
				gridTemplateColumns: "400px minmax(0, 1fr)",
			});
		});
	});

	it("keeps the current session state when reloading the same repository from the picker", async () => {
		readRestoreStateMock.mockResolvedValue({
			version: 1,
			restorePreference: "prompt",
			snapshot: null,
		});
		openRepositoryMock.mockResolvedValue({
			workspaceId: "repo-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		listWorktreesMock.mockResolvedValue([
			{
				id: "main",
				repositoryId: "repo-1",
				branchName: "main",
				path: "/repo",
				label: "master",
				isMain: true,
			},
		]);

		render(<App />, { wrapper: CommandRegistryProvider });
		await screen.findByLabelText("Repository path");
		fireEvent.change(screen.getByLabelText("Repository path"), {
			target: { value: "/repo" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// Open the note sheet to access the textarea
		await userEvent.click(
			await screen.findByRole("button", { name: "Open note" }),
		);
		const noteInput = await screen.findByRole("textbox", {
			name: "Session note",
		});
		await userEvent.clear(noteInput);
		await userEvent.type(noteInput, "keep this session");
		await waitFor(() => {
			expect(screen.getByDisplayValue("keep this session")).toBeInTheDocument();
		});

		// Close note sheet before navigating away
		await userEvent.click(
			screen.getByRole("button", { name: "Close note sheet" }),
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("textbox", { name: "Session note" }),
			).not.toBeInTheDocument();
		});

		openPickerListenerRef.current?.();
		const repoInput = await screen.findByLabelText("Repository path");
		fireEvent.change(repoInput, { target: { value: "/repo" } });
		fireEvent.click(screen.getByRole("button", { name: "Load" }));

		// Reopen note sheet to verify state was preserved
		await userEvent.click(
			await screen.findByRole("button", { name: "Open note" }),
		);
		expect(
			await screen.findByDisplayValue("keep this session"),
		).toBeInTheDocument();
		expect(createMock).toHaveBeenCalledTimes(1);
	});
});
