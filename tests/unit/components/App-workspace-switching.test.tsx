import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

const openRepositoryMock = vi.hoisted(() => vi.fn());
const listWorktreesMock = vi.hoisted(() => vi.fn());
const readRestoreStateMock = vi.hoisted(() => vi.fn());
const writeRestoreStateMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/lib/desktop-client", () => ({
	workspace: {
		openRepository: openRepositoryMock,
		readRestoreState: readRestoreStateMock,
		writeRestoreState: writeRestoreStateMock,
		onOpenPicker: vi.fn(() => () => {}),
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
		stop: vi.fn(),
		sendInput: vi.fn(),
		resize: vi.fn(),
		onOutput: vi.fn(() => () => {}),
		onExit: vi.fn(() => () => {}),
		onState: vi.fn(() => () => {}),
		onError: vi.fn(() => () => {}),
	},
	git: {
		readSummary: vi.fn().mockResolvedValue({
			branchName: "main",
			isDirty: false,
			changedFileCount: 0,
			changedFiles: [],
			recentCommits: [],
		}),
		listChanges: vi.fn().mockResolvedValue([]),
		readDiff: vi.fn(),
		readCommitHistory: vi.fn().mockResolvedValue({ mergeTargetRef: null, entries: [] }),
		readCommitDetail: vi.fn().mockResolvedValue(null),
	},
	files: {
		list: vi.fn().mockResolvedValue([]),
		listScoped: vi.fn().mockResolvedValue([]),
		read: vi.fn(),
	},
}));

import { App } from "../../../src/app/App";

beforeEach(() => {
	vi.clearAllMocks();
	// Reset the once-queues for mocks that use mockResolvedValueOnce to prevent
	// stale queued values from a prior test leaking into the next test.
	openRepositoryMock.mockReset();
	listWorktreesMock.mockReset();
	// Restore persistent implementations after the reset.
	readRestoreStateMock.mockResolvedValue({
		version: 2,
		restorePreference: "alwaysStartClean",
		activeWorkspaceId: null,
		workspaceOrder: [],
		workspaces: [],
	});
	writeRestoreStateMock.mockResolvedValue(undefined);
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
});

describe("workspace switching", () => {
	it("shows the loaded repo as a workspace group in the sessions sidebar", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "ws-a",
			repository: { id: "repo-a", name: "repo-a", rootPath: "/repo-a", repoId: "repo-id-a" },
		});
		listWorktreesMock.mockResolvedValueOnce([
			{ id: "/repo-a", repositoryId: "repo-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
		]);

		render(<App />);

		const input = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input, "/repo-a");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		const group = await within(sidebar).findByRole("group", { name: "repo-a" });
		expect(group).toHaveAttribute("data-active-workspace", "true");
		expect(within(group).getByRole("button", { name: /^main(?:\s+main)?$/i })).toBeInTheDocument();
	});

	it("shows one workspace group per loaded repository", async () => {
		let onOpenPickerCallback: (() => void) | null = null;

		const { workspace: workspaceMock } = await import("../../../src/lib/desktop-client");
		vi.mocked(workspaceMock.onOpenPicker).mockImplementation((cb) => {
			onOpenPickerCallback = cb;
			return () => {};
		});

		openRepositoryMock
			.mockResolvedValueOnce({
				workspaceId: "ws-a",
				repository: { id: "repo-a", name: "repo-a", rootPath: "/repo-a", repoId: "repo-id-a" },
			})
			.mockResolvedValueOnce({
				workspaceId: "ws-b",
				repository: { id: "repo-b", name: "repo-b", rootPath: "/repo-b", repoId: "repo-id-b" },
			});
		listWorktreesMock
			.mockResolvedValueOnce([
				{ id: "/repo-a", repositoryId: "repo-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
			])
			.mockResolvedValueOnce([
				{ id: "/repo-b", repositoryId: "repo-b", branchName: "stable", path: "/repo-b", label: "stable", isMain: true },
			]);

		render(<App />);

		const input = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input, "/repo-a");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		if (onOpenPickerCallback) {
			onOpenPickerCallback();
		}

		const input2 = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input2, "/repo-b");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		await waitFor(() => {
			expect(within(sidebar).getByRole("group", { name: "repo-a" })).toBeInTheDocument();
			expect(within(sidebar).getByRole("group", { name: "repo-b" })).toBeInTheDocument();
		});
	});

	it("marks the first loaded workspace group as active", async () => {
		openRepositoryMock.mockResolvedValueOnce({
			workspaceId: "ws-a",
			repository: { id: "repo-a", name: "repo-a", rootPath: "/repo-a", repoId: "repo-id-a" },
		});
		listWorktreesMock.mockResolvedValueOnce([
			{ id: "/repo-a", repositoryId: "repo-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
		]);

		render(<App />);

		const input = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input, "/repo-a");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		const group = await within(sidebar).findByRole("group", { name: "repo-a" });
		expect(group).toHaveAttribute("data-active-workspace", "true");
	});

	it("switches active workspace when selecting a worktree in another workspace group", async () => {
		let onOpenPickerCallback: (() => void) | null = null;

		const { workspace: workspaceMock } = await import("../../../src/lib/desktop-client");
		vi.mocked(workspaceMock.onOpenPicker).mockImplementation((cb) => {
			onOpenPickerCallback = cb;
			return () => {};
		});

		openRepositoryMock
			.mockResolvedValueOnce({
				workspaceId: "ws-a",
				repository: { id: "repo-a", name: "repo-a", rootPath: "/repo-a", repoId: "repo-id-a" },
			})
			.mockResolvedValueOnce({
				workspaceId: "ws-b",
				repository: { id: "repo-b", name: "repo-b", rootPath: "/repo-b", repoId: "repo-id-b" },
			});
		listWorktreesMock
			.mockResolvedValueOnce([
				{ id: "/repo-a", repositoryId: "repo-a", branchName: "main", path: "/repo-a", label: "main", isMain: true },
			])
			.mockResolvedValueOnce([
				{ id: "/repo-b", repositoryId: "repo-b", branchName: "stable", path: "/repo-b", label: "stable", isMain: true },
			]);

		render(<App />);

		// Load repo-a
		const input = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input, "/repo-a");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByRole("navigation", { name: "Worktree sessions" });

		if (onOpenPickerCallback) {
			onOpenPickerCallback();
		}

		const input2 = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input2, "/repo-b");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		await waitFor(() => {
			const latestSidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
			expect(within(latestSidebar).getByRole("group", { name: "repo-a" })).toBeInTheDocument();
			expect(within(latestSidebar).getByRole("group", { name: "repo-b" })).toBeInTheDocument();
		});

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		const repoAGroup = within(sidebar).getByRole("group", { name: "repo-a" });
		const repoBGroup = within(sidebar).getByRole("group", { name: "repo-b" });
		expect(repoBGroup).toHaveAttribute("data-active-workspace", "true");
		expect(repoAGroup).toHaveAttribute("data-active-workspace", "false");

		await userEvent.click(
			within(repoAGroup).getByRole("button", { name: /^main(?:\s+main)?$/i }),
		);

		await waitFor(() => {
			expect(repoAGroup).toHaveAttribute("data-active-workspace", "true");
			expect(repoBGroup).toHaveAttribute("data-active-workspace", "false");
		});
	});

	it("unregisters a non-active workspace from the sidebar", async () => {
		// Workspace removal with live terminals requires confirmation; auto-confirm in this test.
		vi.spyOn(window, "confirm").mockReturnValue(true);

		let onOpenPickerCallback: (() => void) | null = null;

		const { workspace: workspaceMock } = await import("../../../src/lib/desktop-client");
		vi.mocked(workspaceMock.onOpenPicker).mockImplementation((cb) => {
			onOpenPickerCallback = cb;
			return () => {};
		});

		openRepositoryMock
			.mockResolvedValueOnce({
				workspaceId: "ws-a",
				repository: { id: "repo-a", name: "repo-a", rootPath: "/repo-a", repoId: "repo-id-a" },
			})
			.mockResolvedValueOnce({
				workspaceId: "ws-b",
				repository: { id: "repo-b", name: "repo-b", rootPath: "/repo-b", repoId: "repo-id-b" },
			});
		listWorktreesMock
			.mockResolvedValueOnce([{ id: "/repo-a", repositoryId: "repo-a", branchName: "main", path: "/repo-a", label: "main", isMain: true }])
			.mockResolvedValueOnce([{ id: "/repo-b", repositoryId: "repo-b", branchName: "main", path: "/repo-b", label: "main", isMain: true }]);

		render(<App />);

		// Load repo-a
		await userEvent.type(await screen.findByLabelText(/repository path/i), "/repo-a");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));
		await screen.findByRole("group", { name: "repo-a" });

		// Open picker to load repo-b
		if (onOpenPickerCallback) {
			onOpenPickerCallback();
		}
		await userEvent.type(await screen.findByLabelText(/repository path/i), "/repo-b");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		await within(sidebar).findByRole("group", { name: "repo-b" });
		expect(within(sidebar).getByRole("group", { name: "repo-a" })).toBeInTheDocument();

		await userEvent.click(within(sidebar).getByRole("button", { name: /remove repo-a/i }));
		expect(within(sidebar).queryByRole("group", { name: "repo-a" })).not.toBeInTheDocument();
		expect(within(sidebar).getByRole("group", { name: "repo-b" })).toBeInTheDocument();
	});
});
