import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorktreeList } from "../../../src/features/workspace/components/WorktreeList";
import type { Worktree } from "../../../shared/models/worktree";

const worktrees: Worktree[] = [
	{
		id: "/repo/main",
		repositoryId: "r1",
		branchName: "main",
		path: "/repo/main",
		label: "main",
		isMain: true,
	},
	{
		id: "/repo/.worktrees/feature-a",
		repositoryId: "r1",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		label: "feature-a",
		isMain: false,
	},
];

describe("WorktreeList", () => {
	it("renders worktree labels, branch names, and paths", () => {
		render(
			<WorktreeList
				worktrees={worktrees}
				selectedWorktreeId={null}
				onSelect={vi.fn()}
			/>,
		);

		expect(screen.getByText("main")).toBeInTheDocument();
		expect(screen.getByText("Branch: main")).toBeInTheDocument();
		expect(screen.getByText("/repo/main")).toBeInTheDocument();

		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(screen.getByText("Branch: feature-a")).toBeInTheDocument();
		expect(screen.getByText("/repo/.worktrees/feature-a")).toBeInTheDocument();
	});

	it("highlights the selected worktree", () => {
		const { container } = render(
			<WorktreeList
				worktrees={worktrees}
				selectedWorktreeId="/repo/main"
				onSelect={vi.fn()}
			/>,
		);

		const items = container.querySelectorAll("li");
		// Selected item has a visible border (tokenized: var(--border))
		expect(items[0].style.border).toBe("1px solid var(--border)");
		// Non-selected item has transparent border
		expect(items[1].style.border).toBe("1px solid transparent");
	});

	it("calls onSelect when a worktree is clicked", () => {
		const onSelect = vi.fn();
		render(
			<WorktreeList
				worktrees={worktrees}
				selectedWorktreeId={null}
				onSelect={onSelect}
			/>,
		);

		fireEvent.click(screen.getByText("feature-a"));
		expect(onSelect).toHaveBeenCalledWith("/repo/.worktrees/feature-a");
	});

	it("renders empty message when no worktrees", () => {
		render(
			<WorktreeList
				worktrees={[]}
				selectedWorktreeId={null}
				onSelect={vi.fn()}
			/>,
		);

		expect(screen.getByText("No worktrees found.")).toBeInTheDocument();
	});
});
