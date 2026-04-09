import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const workspaces = [
	{
		workspaceId: "ws-a",
		name: "repo-a",
		worktrees,
		selectedWorktreeId: "feature-a",
		attentionByWorktreeId: {},
		active: true,
		hydrated: true,
	},
];

describe("SessionSidebar", () => {
	it("renders worktree labels and branches", () => {
		render(
			<SessionSidebar
				workspaces={workspaces}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
			/>,
		);

		const sidebar = screen.getByRole("navigation", { name: "Worktree sessions" });
		const group = within(sidebar).getByRole("group", { name: "repo-a" });
		// When branchName equals label (e.g. the "main" worktree), the branch <div>
		// is intentionally hidden to avoid redundancy — only the <strong> label is shown.
		expect(within(group).getByRole("button", { name: "repo-a" })).toHaveAttribute("data-selected", "true");
		expect(within(group).getAllByText("main")).toHaveLength(1);
		expect(within(group).getByText("feature worktree")).toBeInTheDocument();
		// "feature-a" branch is shown because it differs from the label "feature worktree"
		expect(within(group).getByText("feature-a")).toBeInTheDocument();
		expect(
			within(group).getByRole("button", { name: "feature worktree feature-a" }),
		).toHaveAttribute("data-selected", "true");
	});

	it("calls onSelect when a worktree is clicked", () => {
		const onSelect = vi.fn();
		render(
			<SessionSidebar
				workspaces={[{ ...workspaces[0], selectedWorktreeId: "main" }]}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={onSelect}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "feature worktree feature-a" }));
		expect(onSelect).toHaveBeenCalledWith("ws-a", "feature-a");
	});

	it("shows worktree attention when a background process needs action", () => {
		render(
			<SessionSidebar
				workspaces={[{ ...workspaces[0], selectedWorktreeId: "main", attentionByWorktreeId: { "feature-a": "actionRequired" } }]}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={() => {}}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "feature worktree feature-a" }),
		).toHaveAttribute("data-attention", "actionRequired");
	});

	it("renders the collapsed rail with initial-letter markers and no labels", () => {
		render(
			<SessionSidebar
				workspaces={[{ ...workspaces[0], selectedWorktreeId: "main" }]}
				collapsed={true}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("navigation", { name: "Worktree sessions" }),
		).toHaveAttribute("data-collapsed", "true");

		// Full worktree labels must NOT be rendered as <strong> elements
		expect(screen.queryByText("feature worktree")).not.toBeInTheDocument();

		// Group badge plus worktree markers should still be visible when collapsed.
		expect(screen.getByRole("button", { name: "repo-a" })).toBeInTheDocument();
		expect(screen.getByText("M")).toBeInTheDocument();
		expect(screen.getByText("F")).toBeInTheDocument();

		// Toggle button must signal expansion intent
		expect(
			screen.getByRole("button", { name: "Expand sidebar" }),
		).toBeInTheDocument();
	});

	it("shows active workspace controls in the group header/footer", () => {
		render(
			<SessionSidebar
				workspaces={[{ ...workspaces[0], selectedWorktreeId: "main" }]}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
			/>,
		);

		const newButton = screen.getByRole("button", { name: "New worktree" });
		expect(newButton).toBeInTheDocument();
		expect(newButton.textContent).toBe("+ New worktree");
		expect(screen.getByRole("button", { name: "repo-a" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remove repo-a" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Remove worktree" })).not.toBeInTheDocument();
	});

	it("only marks the selected worktree inside the active workspace group", () => {
		render(
			<SessionSidebar
				workspaces={[
					{ ...workspaces[0], selectedWorktreeId: "feature-a", active: true, name: "repo-a" },
					{
						...workspaces[0],
						workspaceId: "ws-b",
						name: "repo-b",
						selectedWorktreeId: "feature-a",
						active: false,
					},
				]}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
			/>,
		);

		const activeGroup = screen.getByRole("group", { name: "repo-a" });
		const inactiveGroup = screen.getByRole("group", { name: "repo-b" });

		expect(
			within(activeGroup).getByRole("button", { name: "feature worktree feature-a" }),
		).toHaveAttribute("data-selected", "true");
		expect(
			within(inactiveGroup).getByRole("button", { name: "feature worktree feature-a" }),
		).toHaveAttribute("data-selected", "false");
	});
});
