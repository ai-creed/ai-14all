import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
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
		onOutput: vi.fn((listener: (event: { sessionId: string; data: string }) => void) => {
			mockTerminalOutputListeners.push(listener);
			return vi.fn();
		}),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	files: {
		list: vi.fn().mockResolvedValue([]),
		read: vi.fn(),
	},
	git: {
		listChanges: vi.fn().mockResolvedValue([]),
		readDiff: vi.fn(),
	},
}));

import { App } from "../../../src/app/App";
import { repository, git } from "../../../src/lib/desktop-client";

const mockSetRoot = vi.mocked(repository.setRoot);
const mockListWorktrees = vi.mocked(repository.listWorktrees);
const mockListChanges = vi.mocked(git.listChanges);

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
	mockListChanges.mockResolvedValue([{ path: "src/index.ts", status: "M" }]);

	render(<App />);

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

describe("App — refresh changes button", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		terminalIdCounter = 0;
		// Re-setup the default mock for listChanges since clearAllMocks wipes it
		mockListChanges.mockResolvedValue([{ path: "src/index.ts", status: "M" }]);
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

		const callCountBefore = mockListChanges.mock.calls.length;

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

		await waitFor(() => {
			expect(mockListChanges.mock.calls.length).toBeGreaterThan(
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

		fireEvent.change(screen.getByLabelText("Repository path"), {
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
	mockListChanges.mockResolvedValue([]);

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
		mockListChanges.mockResolvedValue([]);
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

	it("marks a background process as action-required from output", async () => {
		render(<App />);
		await loadRepository();
		await createPreset("Claude", "claude");
		// Launch preset — gets terminal-1, becomes active process
		await user.click(screen.getByRole("button", { name: "Launch preset" }));
		await user.click(screen.getByRole("menuitem", { name: "Claude" }));
		// Add an ad-hoc shell — gets terminal-2, becomes the active process
		// so the preset process is now in the background
		await user.click(screen.getByRole("button", { name: "+ Shell" }));
		// Emit output on preset's terminal while it's in the background
		act(() => {
			emitTerminalOutput("terminal-1", "Continue? [y/N]");
		});

		expect(screen.getByRole("tab", { name: /Claude/i })).toHaveAttribute(
			"data-attention",
			"actionRequired",
		);
	});
});
