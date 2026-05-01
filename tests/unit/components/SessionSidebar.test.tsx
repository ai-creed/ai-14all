import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SessionSidebar } from "../../../src/features/workspace/components/SessionSidebar";
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

		const sidebar = screen.getByRole("navigation", {
			name: "Worktree sessions",
		});
		const group = within(sidebar).getByRole("group", { name: "repo-a" });
		// When branchName equals label (e.g. the "main" worktree), the branch <div>
		// is intentionally hidden to avoid redundancy — only the <strong> label is shown.
		expect(
			within(group).getByRole("button", { name: "repo-a" }),
		).toHaveAttribute("data-selected", "true");
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

		fireEvent.click(
			screen.getByRole("button", { name: "feature worktree feature-a" }),
		);
		expect(onSelect).toHaveBeenCalledWith("ws-a", "feature-a");
	});

	it("shows worktree attention when a background process needs action", () => {
		render(
			<SessionSidebar
				workspaces={[
					{
						...workspaces[0],
						selectedWorktreeId: "main",
						attentionByWorktreeId: { "feature-a": "actionRequired" },
					},
				]}
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

		const newButton = screen.getByRole("button", { name: "New session" });
		expect(newButton).toBeInTheDocument();
		expect(newButton.textContent).toBe("+ New session");
		expect(screen.getByRole("button", { name: "repo-a" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Remove repo-a" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Remove worktree" }),
		).not.toBeInTheDocument();
	});

	it("shows shell summary rows with state dots and context text", () => {
		render(
			<SessionSidebar
				workspaces={[
					{
						...workspaces[0],
						selectedWorktreeId: "main",
						processesByWorktreeId: {
							main: {
								rows: [
									{
										id: "process-1",
										label: "claude",
										state: "actionRequired",
										context: "Continue? [y/N]",
										lastActivityAt: 19_000, hasFailedReason: false,
									},
									{
										id: "process-2",
										label: "npm run dev",
										state: "idle",
										context: "quiet for 18s",
										lastActivityAt: 2_000,
										hasFailedReason: false,
									},
								],
								overflowCount: 1,
							},
						},
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

		const group = screen.getByRole("group", { name: "repo-a" });
		expect(within(group).getByText("claude")).toBeInTheDocument();
		expect(within(group).getByText("npm run dev")).toBeInTheDocument();
		expect(within(group).getByText("Continue? [y/N]")).toBeInTheDocument();
		expect(within(group).getByText("quiet for 18s")).toBeInTheDocument();
		expect(within(group).getByText("1 more shell")).toBeInTheDocument();
		const indicators = within(group).getAllByTestId("process-state-indicator");
		expect(indicators).toHaveLength(2);
		expect(indicators[0]).toHaveAttribute("data-state", "actionRequired");
		expect(indicators[1]).toHaveAttribute("data-state", "idle");
	});

	it("shows overflow shell count when greater than zero", () => {
		render(
			<SessionSidebar
				workspaces={[
					{
						...workspaces[0],
						selectedWorktreeId: "main",
						processesByWorktreeId: {
							main: {
								rows: [
									{
										id: "process-1",
										label: "claude",
										state: "active",
										context: "compiled in 124ms",
										lastActivityAt: 19_000, hasFailedReason: false,
									},
								],
								overflowCount: 3,
							},
						},
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

		const group = screen.getByRole("group", { name: "repo-a" });
		expect(within(group).getByText("3 more shells")).toBeInTheDocument();
	});

	it("hides overflow shell line when count is zero", () => {
		render(
			<SessionSidebar
				workspaces={[
					{
						...workspaces[0],
						selectedWorktreeId: "main",
						processesByWorktreeId: {
							main: {
								rows: [
									{
										id: "process-1",
										label: "claude",
										state: "active",
										context: "compiled in 124ms",
										lastActivityAt: 19_000, hasFailedReason: false,
									},
								],
								overflowCount: 0,
							},
						},
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

		const group = screen.getByRole("group", { name: "repo-a" });
		expect(within(group).queryByText(/more shell/)).not.toBeInTheDocument();
	});

	it("does not show process details in collapsed mode", () => {
		render(
			<SessionSidebar
				workspaces={[
					{
						...workspaces[0],
						selectedWorktreeId: "main",
						processesByWorktreeId: {
							main: {
								rows: [
									{
										id: "process-1",
										label: "claude",
										state: "active",
										context: "compiled in 124ms",
										lastActivityAt: 19_000, hasFailedReason: false,
									},
								],
								overflowCount: 2,
							},
						},
					},
				]}
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

		expect(screen.queryByText("claude")).not.toBeInTheDocument();
		expect(screen.queryByText(/more shell/)).not.toBeInTheDocument();
	});

	it("only marks the selected worktree inside the active workspace group", () => {
		render(
			<SessionSidebar
				workspaces={[
					{
						...workspaces[0],
						selectedWorktreeId: "feature-a",
						active: true,
						name: "repo-a",
					},
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
			within(activeGroup).getByRole("button", {
				name: "feature worktree feature-a",
			}),
		).toHaveAttribute("data-selected", "true");
		expect(
			within(inactiveGroup).getByRole("button", {
				name: "feature worktree feature-a",
			}),
		).toHaveAttribute("data-selected", "false");
	});
});

import React from "react";

function renderSidebar(
	overrides: Partial<React.ComponentProps<typeof SessionSidebar>> = {},
) {
	const onRenameSession = vi.fn();
	const onRequestExpand = vi.fn();
	const props: React.ComponentProps<typeof SessionSidebar> = {
		workspaces: [
			{
				...workspaces[0],
				titleByWorktreeId: { "feature-a": "", main: "" },
			},
		],
		collapsed: false,
		onToggleCollapsed: vi.fn(),
		onLoadWorkspace: vi.fn(),
		onOpenWorkspace: vi.fn(),
		onSelect: vi.fn(),
		onCreateWorktree: vi.fn(),
		onRemoveWorktree: vi.fn(),
		onRemoveWorkspace: vi.fn(),
		onRenameSession,
		onRequestExpand,
		...overrides,
	};
	const utils = render(<SessionSidebar {...props} />);
	return { onRenameSession, onRequestExpand, ...utils };
}

describe("SessionSidebar display title", () => {
	it("shows session title as primary label and worktree label as subordinate", () => {
		const titled = {
			...workspaces[0],
			titleByWorktreeId: { "feature-a": "Auth rewrite", main: "" },
		};
		render(
			<SessionSidebar
				workspaces={[titled]}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
				onLoadWorkspace={vi.fn()}
				onOpenWorkspace={vi.fn()}
				onSelect={vi.fn()}
				onCreateWorktree={vi.fn()}
				onRemoveWorktree={vi.fn()}
				onRemoveWorkspace={vi.fn()}
				onRenameSession={vi.fn()}
				onRequestExpand={vi.fn()}
			/>,
		);
		const group = screen.getByRole("group", { name: "repo-a" });
		// Custom title on feature-a
		expect(within(group).getByText("Auth rewrite")).toBeInTheDocument();
		// Worktree label shown as subordinate
		expect(within(group).getByText("feature worktree")).toBeInTheDocument();
		// "main" has no custom title: single label, no redundant subordinate
		expect(within(group).getAllByText("main")).toHaveLength(1);
	});
});

describe("SessionSidebar rename", () => {
	it("enters rename on double-click and commits trimmed value on Enter", () => {
		const { onRenameSession } = renderSidebar();
		fireEvent.doubleClick(screen.getByText("feature worktree"));
		const input = screen.getByRole("textbox", { name: /rename session/i });
		fireEvent.change(input, { target: { value: "  Auth rewrite  " } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onRenameSession).toHaveBeenCalledWith(
			"ws-a",
			"feature-a",
			"Auth rewrite",
		);
	});

	it("cancels rename on Esc without dispatching", () => {
		const { onRenameSession } = renderSidebar();
		fireEvent.doubleClick(screen.getByText("feature worktree"));
		const input = screen.getByRole("textbox", { name: /rename session/i });
		fireEvent.change(input, { target: { value: "abandoned" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onRenameSession).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("commits trimmed value on blur", () => {
		const { onRenameSession } = renderSidebar();
		fireEvent.doubleClick(screen.getByText("feature worktree"));
		const input = screen.getByRole("textbox", { name: /rename session/i });
		fireEvent.change(input, { target: { value: "  New name  " } });
		fireEvent.blur(input);
		expect(onRenameSession).toHaveBeenCalledWith(
			"ws-a",
			"feature-a",
			"New name",
		);
	});

	it("empty input clears the custom title", () => {
		const { onRenameSession } = renderSidebar({
			workspaces: [
				{
					...workspaces[0],
					titleByWorktreeId: { "feature-a": "Auth rewrite", main: "" },
				},
			],
		});
		fireEvent.doubleClick(screen.getByText("Auth rewrite"));
		const input = screen.getByRole("textbox", { name: /rename session/i });
		fireEvent.change(input, { target: { value: "   " } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onRenameSession).toHaveBeenCalledWith("ws-a", "feature-a", "");
	});

	it("F2 on a focused row starts rename", () => {
		const { onRenameSession } = renderSidebar();
		const row = screen.getByRole("button", { name: /feature worktree/ });
		row.focus();
		fireEvent.keyDown(row, { key: "F2" });
		const input = screen.getByRole("textbox", { name: /rename session/i });
		fireEvent.change(input, { target: { value: "Quick rename" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onRenameSession).toHaveBeenCalledWith(
			"ws-a",
			"feature-a",
			"Quick rename",
		);
	});

	it("context menu rename item exists on a non-main row and not Remove worktree alongside it", async () => {
		renderSidebar();
		const row = screen.getByRole("button", { name: /feature worktree/ });
		fireEvent.contextMenu(row);
		const rename = await screen.findByRole("menuitem", {
			name: /rename session/i,
		});
		expect(rename).toBeInTheDocument();
		const remove = await screen.findByRole("menuitem", {
			name: /remove worktree/i,
		});
		expect(remove).toBeInTheDocument();
	});

	it("context menu on the main row shows Rename session but NOT Remove worktree", async () => {
		renderSidebar();
		const row = screen.getByRole("button", { name: "main" });
		fireEvent.contextMenu(row);
		const rename = await screen.findByRole("menuitem", {
			name: /rename session/i,
		});
		expect(rename).toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: /remove worktree/i }),
		).toBeNull();
	});

	it("does not clobber the rename input when workspaces re-renders mid-edit", () => {
		const initialWorkspace = {
			...workspaces[0],
			titleByWorktreeId: { "feature-a": "Auth rewrite", main: "" },
		};
		const pendingRename = { workspaceId: "ws-a", worktreeId: "feature-a" };
		const props = {
			workspaces: [initialWorkspace],
			collapsed: false,
			onToggleCollapsed: vi.fn(),
			onLoadWorkspace: vi.fn(),
			onOpenWorkspace: vi.fn(),
			onSelect: vi.fn(),
			onCreateWorktree: vi.fn(),
			onRemoveWorktree: vi.fn(),
			onRemoveWorkspace: vi.fn(),
			onRenameSession: vi.fn(),
			pendingRename,
		};

		const { rerender } = render(<SessionSidebar {...props} />);
		const input = screen.getByRole("textbox", { name: /rename session/i });
		fireEvent.change(input, { target: { value: "User typed" } });
		expect((input as HTMLInputElement).value).toBe("User typed");

		// Simulate an unrelated workspaces update (new identity, same data) —
		// e.g. attention/state polling — while pendingRename is still set.
		rerender(
			<SessionSidebar
				{...props}
				workspaces={[{ ...initialWorkspace }]}
			/>,
		);

		const inputAfter = screen.getByRole("textbox", { name: /rename session/i });
		expect((inputAfter as HTMLInputElement).value).toBe("User typed");
	});

	it("when collapsed, F2 calls onRequestExpand instead of opening rename locally", () => {
		const { onRequestExpand, onRenameSession } = renderSidebar({
			collapsed: true,
		});
		const marker = screen
			.getAllByRole("button")
			.find((el) => el.classList.contains("shell-sidebar__item"));
		expect(marker).toBeTruthy();
		marker!.focus();
		fireEvent.keyDown(marker!, { key: "F2" });
		expect(onRequestExpand).toHaveBeenCalledWith("ws-a", expect.any(String));
		expect(onRenameSession).not.toHaveBeenCalled();
	});
});

describe("SessionSidebar footer label", () => {
	it("labels the footer action '+ New session'", () => {
		renderSidebar();
		const btn = screen.getByRole("button", { name: /new session/i });
		expect(btn).toBeInTheDocument();
		expect(btn.textContent).toBe("+ New session");
	});
});
