import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionSidebar } from "../../../src/features/workspace/SessionSidebar";
import type { Worktree } from "../../../shared/models/worktree";

const worktrees: Worktree[] = [
  { id: "main", repositoryId: "r1", branchName: "main", path: "/repo", label: "main", isMain: true },
  { id: "feature-a", repositoryId: "r1", branchName: "feature-a", path: "/repo/.worktrees/feature-a", label: "feature worktree", isMain: false },
];

describe("SessionSidebar", () => {
  it("renders worktree labels and branches", () => {
    render(
      <SessionSidebar
        worktrees={worktrees}
        selectedWorktreeId="feature-a"
        onSelect={vi.fn()}
      />,
    );

    // "main" appears as both the label and the branch name
    expect(screen.getAllByText("main")).toHaveLength(2);
    expect(screen.getByText("feature worktree")).toBeInTheDocument();
    expect(screen.getByText("feature-a")).toBeInTheDocument();
  });

  it("calls onSelect when a worktree is clicked", () => {
    const onSelect = vi.fn();
    render(
      <SessionSidebar
        worktrees={worktrees}
        selectedWorktreeId="main"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /feature worktree/i }));
    expect(onSelect).toHaveBeenCalledWith("feature-a");
  });
});
