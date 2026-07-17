import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let terminalIdCounter = 0;

// Mock TerminalPane to avoid xterm canvas dependency in jsdom.
vi.mock("../../../src/features/terminals/components/TerminalPane", () => ({
	TerminalPane: () => null,
}));

// Mock desktop-client before importing App (mirrors App-refresh-changes.test.tsx).
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
				id: `term-${++terminalIdCounter}`,
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
		onOutput: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
		onState: vi.fn(() => vi.fn()),
		onError: vi.fn(() => vi.fn()),
	},
	agentPtys: {
		upsert: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		rebindIntent: vi.fn().mockResolvedValue(undefined),
		rebindCancel: vi.fn().mockResolvedValue(undefined),
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
		// Report an available agent CLI so the default-shell auto-spawn is
		// suppressed (use-default-shell-on-empty-worktree only spawns when NO
		// agent is available) — keeps the "no running terminal" state deterministic.
		agentClis: vi.fn().mockResolvedValue({
			claude: { kind: "available", path: "/usr/bin/claude", version: "1.0.0" },
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
import { detectPlatform } from "../../../src/app/shortcut-registry";
import { MAX_FLOATING_SHELLS } from "../../../src/features/workspace/logic/workspace-state";
import { workspace, repository } from "../../../src/lib/desktop-client";

const mockOpenRepository = vi.mocked(workspace.openRepository);
const mockListWorktrees = vi.mocked(repository.listWorktrees);

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

	render(<App />, { wrapper: CommandRegistryProvider });

	await waitFor(() => {
		expect(screen.getByLabelText("Repository path")).toBeInTheDocument();
	});
	fireEvent.change(screen.getByLabelText("Repository path"), {
		target: { value: "/repo" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Load" }));

	// Main render is reached once the review chip-bar mounts (repository loaded).
	await waitFor(() =>
		expect(screen.getByTestId("review-chipbar")).toBeInTheDocument(),
	);
}

function openCommandPalette() {
	const platform = detectPlatform();
	fireEvent.keyDown(document.body, {
		key: "K",
		code: "KeyK",
		shiftKey: true,
		metaKey: platform === "mac",
		ctrlKey: platform !== "mac",
	});
}

// ⌘⇧T / Ctrl+Shift+T — spawn a floating throwaway shell.
function pressThrowawayShell() {
	const platform = detectPlatform();
	fireEvent.keyDown(document.body, {
		key: "T",
		code: "KeyT",
		shiftKey: true,
		metaKey: platform === "mac",
		ctrlKey: platform !== "mac",
	});
}

describe("App — command palette availability gating", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListWorktrees.mockReset();
		terminalIdCounter = 0;
	});

	it("hides terminal commands that would no-op while still showing worktree-available ones", async () => {
		await loadRepository();

		openCommandPalette();
		expect(await screen.findByTestId("command-palette")).toBeInTheDocument();

		// A worktree is active and no shell is running. Worktree-gated actions are
		// available; "Close terminal" is hidden because there is no active process
		// (its handler would otherwise be a dead, no-op row).
		expect(screen.getByText("New terminal")).toBeInTheDocument();
		expect(screen.getByText("New throwaway shell")).toBeInTheDocument();
		expect(screen.queryByText("Close terminal")).not.toBeInTheDocument();

		// Sanity: an always-available command is present (the palette is open).
		expect(screen.getByText("Show shortcuts")).toBeInTheDocument();
	});

	it("hides New throwaway shell once the floating-shell cap is reached", async () => {
		await loadRepository();

		// Spawn floating shells up to the hard cap; each adds a pill.
		for (let i = 1; i <= MAX_FLOATING_SHELLS; i++) {
			pressThrowawayShell();
			await waitFor(() =>
				expect(
					screen.getAllByTestId(/^floating-shell-pill-close-/),
				).toHaveLength(i),
			);
		}

		openCommandPalette();
		expect(await screen.findByTestId("command-palette")).toBeInTheDocument();

		// At the cap the throwaway-shell action would no-op, so it is hidden.
		expect(screen.queryByText("New throwaway shell")).not.toBeInTheDocument();
		// Other worktree-available commands remain (palette is open and gating is
		// per-command, not all-or-nothing).
		expect(screen.getByText("New terminal")).toBeInTheDocument();
	});
});
