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
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("navigation", { name: "Worktree sessions" }),
		).toBeInTheDocument();
		// When branchName equals label (e.g. the "main" worktree), the branch <div>
		// is intentionally hidden to avoid redundancy — only the <strong> label is shown.
		expect(screen.getAllByText("main")).toHaveLength(1);
		expect(screen.getByText("feature worktree")).toBeInTheDocument();
		// "feature-a" branch is shown because it differs from the label "feature worktree"
		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "feature worktree feature-a" }),
		).toHaveAttribute("data-selected", "true");
	});

	it("calls onSelect when a worktree is clicked", () => {
		const onSelect = vi.fn();
		render(
			<SessionSidebar
				worktrees={worktrees}
				selectedWorktreeId="main"
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onSelect={onSelect}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "feature worktree feature-a" }));
		expect(onSelect).toHaveBeenCalledWith("feature-a");
	});

	it("shows worktree attention when a background process needs action", () => {
		render(
			<SessionSidebar
				worktrees={worktrees}
				selectedWorktreeId="main"
				attentionByWorktreeId={{ "feature-a": "actionRequired" }}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onSelect={() => {}}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "feature worktree feature-a" }),
		).toHaveAttribute("data-attention", "actionRequired");
	});

	it("renders the collapsed rail with initial-letter markers and no labels", () => {
		render(
			<SessionSidebar
				worktrees={worktrees}
				selectedWorktreeId="main"
				collapsed={true}
				onToggleCollapsed={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("navigation", { name: "Worktree sessions" }),
		).toHaveAttribute("data-collapsed", "true");

		// Full worktree labels must NOT be rendered as <strong> elements
		expect(screen.queryByText("feature worktree")).not.toBeInTheDocument();

		// Initial-letter markers must be visible (first char uppercased)
		// "main" → "M", "feature worktree" → "F"
		expect(screen.getByText("M")).toBeInTheDocument();
		expect(screen.getByText("F")).toBeInTheDocument();

		// Toggle button must signal expansion intent
		expect(
			screen.getByRole("button", { name: "Expand sidebar" }),
		).toBeInTheDocument();
	});

	it("shows a bottom New worktree button with a plus prefix and no inline remove buttons", () => {
		render(
			<SessionSidebar
				worktrees={worktrees}
				selectedWorktreeId="main"
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
			/>,
		);

		const newButton = screen.getByRole("button", { name: "New worktree" });
		expect(newButton).toBeInTheDocument();
		expect(newButton.textContent).toBe("+ New worktree");

		// Remove action is in a context menu, not an inline button
		expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
	});
});
