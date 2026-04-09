import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
	it("shows the workspace switcher with the loaded repo after initial load", async () => {
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

		// Workspace switcher with repo-a should appear
		await screen.findByRole("button", { name: "repo-a" });
		expect(screen.getByRole("button", { name: "repo-a" })).toBeInTheDocument();
	});

	it("shows workspace switcher after loading a repository", async () => {
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

		// Workspace switcher with repo-a should appear
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "repo-a" })).toBeInTheDocument();
		});

		// The repo-a switcher button should be in the selected state
		expect(screen.getByRole("button", { name: "repo-a" })).toHaveAttribute("data-selected", "true");
	});

	it("switches active workspace when selecting a different workspace in the switcher", async () => {
		// This test simulates: open ws-a, open workspace picker (via onOpenPicker), load ws-b, switch back to ws-a
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
				{ id: "/repo-b", repositoryId: "repo-b", branchName: "main", path: "/repo-b", label: "main", isMain: true },
			]);

		render(<App />);

		// Load repo-a
		const input = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input, "/repo-a");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		await screen.findByRole("button", { name: "repo-a" });

		// Trigger picker open to load repo-b
		if (onOpenPickerCallback) {
			onOpenPickerCallback();
		}

		const input2 = await screen.findByLabelText(/repository path/i);
		await userEvent.type(input2, "/repo-b");
		await userEvent.click(screen.getByRole("button", { name: "Load" }));

		// Both workspace buttons should appear
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "repo-a" })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "repo-b" })).toBeInTheDocument();
		});

		// repo-b should be active now
		expect(screen.getByRole("button", { name: "repo-b" })).toHaveAttribute("data-selected", "true");
		expect(screen.getByRole("button", { name: "repo-a" })).toHaveAttribute("data-selected", "false");

		// Switch back to repo-a
		await userEvent.click(screen.getByRole("button", { name: "repo-a" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "repo-a" })).toHaveAttribute("data-selected", "true");
			expect(screen.getByRole("button", { name: "repo-b" })).toHaveAttribute("data-selected", "false");
		});
	});
});
