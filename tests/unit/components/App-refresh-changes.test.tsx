import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock desktop-client before importing App
vi.mock("../../../src/lib/desktop-client", () => ({
  repository: {
    setRoot: vi.fn(),
    listWorktrees: vi.fn(),
  },
  terminals: {
    create: vi.fn(),
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
  mockListChanges.mockResolvedValue([
    { path: "src/index.ts", status: "M" },
  ]);

  render(<App />);

  // Load the repository
  fireEvent.change(screen.getByLabelText("Repository path"), {
    target: { value: "/repo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load" }));

  // Wait for the workspace to appear
  await waitFor(() => {
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  // Switch to "changes" review mode
  fireEvent.click(screen.getByRole("button", { name: "Changes" }));
}

describe("App — refresh changes button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup the default mock for listChanges since clearAllMocks wipes it
    mockListChanges.mockResolvedValue([
      { path: "src/index.ts", status: "M" },
    ]);
  });

  it("shows a Refresh button when review mode is 'changes'", async () => {
    await loadRepoAndSwitchToChanges();

    expect(
      screen.getByRole("button", { name: "Refresh" }),
    ).toBeInTheDocument();
  });

  it("does not show a Refresh button when review mode is 'files'", async () => {
    await loadRepoAndSwitchToChanges();

    // Switch back to files
    fireEvent.click(screen.getByRole("button", { name: "Files" }));

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
});
