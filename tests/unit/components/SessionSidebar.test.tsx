import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionSidebar } from "../../../src/features/workspace/SessionSidebar";
import type { Worktree } from "../../../shared/models/worktree";

const worktrees: Worktree[] = [
	{
		id: "main",
		repositoryId: "r1",
		branchName: "main",
		path: "/repo",
		label: "main",
		isMain: true,
	},
	{
		id: "feature-a",
		repositoryId: "r1",
		branchName: "feature-a",
		path: "/repo/.worktrees/feature-a",
		label: "feature worktree",
		isMain: false,
	},
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

		expect(
			screen.getByRole("navigation", { name: "Worktree sessions" }),
		).toBeInTheDocument();
		// "main" appears as both the label and the branch name
		expect(screen.getAllByText("main")).toHaveLength(2);
		expect(screen.getByText("feature worktree")).toBeInTheDocument();
		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /feature worktree/i }),
		).toHaveAttribute("data-selected", "true");
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

	it("shows worktree attention when a background process needs action", () => {
		render(
			<SessionSidebar
				worktrees={worktrees}
				selectedWorktreeId="main"
				attentionByWorktreeId={{ "feature-a": "actionRequired" }}
				onSelect={() => {}}
			/>,
		);

		expect(
			screen.getByRole("button", { name: /feature worktree/i }),
		).toHaveAttribute("data-attention", "actionRequired");
	});
});
