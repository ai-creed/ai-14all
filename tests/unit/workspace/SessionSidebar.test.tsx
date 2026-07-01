import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSidebar } from "../../../src/features/workspace/components/SessionSidebar";
import type { SessionSidebarWorkspace } from "../../../src/features/workspace/components/SessionSidebar";
import type { AgentProvider } from "../../../shared/models/agent-attention";

type RowSpec = {
	id: string;
	label: string;
	state: "actionRequired" | "active" | "idle" | "exited";
	context: string;
	lastActivityAt: number | null;
	hasFailedReason: boolean;
	provider?: AgentProvider | null;
};

function makeWorkspace(rows: RowSpec[]): SessionSidebarWorkspace;
function makeWorkspace(overrides: Partial<SessionSidebarWorkspace>): SessionSidebarWorkspace;
function makeWorkspace(
	arg: RowSpec[] | Partial<SessionSidebarWorkspace> = [],
): SessionSidebarWorkspace {
	const rows = Array.isArray(arg) ? arg : [];
	const overrides = Array.isArray(arg) ? {} : arg;
	return {
		workspaceId: "ws1",
		name: "my-workspace",
		worktrees: [
			{
				id: "wt1",
				repositoryId: "r1",
				branchName: "main",
				path: "/repo/main",
				label: "main",
				isMain: true,
			},
		],
		selectedWorktreeId: "wt1",
		attentionByWorktreeId: { wt1: "idle" },
		processesByWorktreeId: {
			wt1: {
				rows: rows.map((row) => ({ provider: null, ...row })),
				overflowCount: 0,
			},
		},
		titleByWorktreeId: { wt1: "main" },
		active: true,
		hydrated: true,
		collapsedSummary: { sessionCount: 0, attentionTier: null },
		...overrides,
	};
}

function renderSidebar(
	props: { workspaces: SessionSidebarWorkspace[] } & Partial<Parameters<typeof SessionSidebar>[0]>,
) {
	return render(<SessionSidebar {...baseProps} {...props} />);
}

const baseProps = {
	collapsed: false,
	onToggleCollapsed: vi.fn(),
	onLoadWorkspace: vi.fn(),
	onOpenWorkspace: vi.fn(),
	onSelect: vi.fn(),
	onCreateWorktree: vi.fn(),
	onRemoveWorktree: vi.fn(),
	onRemoveWorkspace: vi.fn(),
};

describe("SessionSidebar process rows", () => {
	it("renders Clear failed button when hasFailedReason is true", () => {
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "tests",
				state: "exited",
				context: "failed: tests failed",
				lastActivityAt: 1000,
				hasFailedReason: true,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				onClearFailedReason={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /clear failed for tests/i }),
		).toBeInTheDocument();
	});

	it("does not render Clear failed button when hasFailedReason is false", () => {
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled in 124ms",
				lastActivityAt: 1000,
				hasFailedReason: false,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				onClearFailedReason={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /clear failed/i }),
		).not.toBeInTheDocument();
	});

	it("dispatches sticky clear when Clear failed is clicked", () => {
		const onClearFailedReason = vi.fn();
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "tests",
				state: "exited",
				context: "failed: tests failed",
				lastActivityAt: 1000,
				hasFailedReason: true,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				onClearFailedReason={onClearFailedReason}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: /clear failed for tests/i }),
		);
		expect(onClearFailedReason).toHaveBeenCalledWith("ws1", "wt1", "p1");
	});

	it("does not trigger row selection when Clear failed is clicked", () => {
		const onSelect = vi.fn();
		const onClearFailedReason = vi.fn();
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "tests",
				state: "exited",
				context: "failed: tests failed",
				lastActivityAt: 1000,
				hasFailedReason: true,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				onSelect={onSelect}
				workspaces={[workspace]}
				onClearFailedReason={onClearFailedReason}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: /clear failed for tests/i }),
		);
		expect(onClearFailedReason).toHaveBeenCalledTimes(1);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("calls onSelect callback when row is clicked", () => {
		const onSelect = vi.fn();
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled",
				lastActivityAt: 1000,
				hasFailedReason: false,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				onSelect={onSelect}
				workspaces={[workspace]}
			/>,
		);
		// Click the worktree row button (identified by aria-label)
		fireEvent.click(screen.getByRole("button", { name: "main" }));
		expect(onSelect).toHaveBeenCalledWith("ws1", "wt1");
	});
});

describe("SessionSidebar — global footer actions", () => {
	it("calls onOpenShortcutsHelp when the help button is clicked", () => {
		const onOpenShortcutsHelp = vi.fn();
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[]}
				onOpenShortcutsHelp={onOpenShortcutsHelp}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: /keyboard shortcuts/i }),
		);
		expect(onOpenShortcutsHelp).toHaveBeenCalledTimes(1);
	});

	it("renders and triggers the help button while collapsed", () => {
		const onOpenShortcutsHelp = vi.fn();
		render(
			<SessionSidebar
				{...baseProps}
				collapsed
				workspaces={[]}
				onOpenShortcutsHelp={onOpenShortcutsHelp}
			/>,
		);
		const help = screen.getByRole("button", { name: /keyboard shortcuts/i });
		expect(help).toBeInTheDocument();
		fireEvent.click(help);
		expect(onOpenShortcutsHelp).toHaveBeenCalledTimes(1);
	});
});

describe("SessionSidebar — process list collapse/expand", () => {
	function makeThreeProcessWorkspace() {
		return makeWorkspace([
			{
				id: "p1",
				label: "dev server",
				state: "active",
				context: "listening on :3000",
				lastActivityAt: 1000,
				hasFailedReason: false,
			},
			{
				id: "p2",
				label: "type check",
				state: "idle",
				context: "no errors",
				lastActivityAt: 900,
				hasFailedReason: false,
			},
			{
				id: "p3",
				label: "tests",
				state: "idle",
				context: "12 passed",
				lastActivityAt: 800,
				hasFailedReason: false,
			},
		]);
	}

	it("collapses processes to the top row + a '2 more' control by default", () => {
		const workspace = makeThreeProcessWorkspace();
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				expandedProcessWorktreeIds={[]}
				onToggleProcessExpanded={vi.fn()}
			/>,
		);
		expect(screen.getAllByTestId("process-state-indicator")).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: /2 more/i }),
		).toBeInTheDocument();
	});

	it("expands all processes when the worktree id is in expandedProcessWorktreeIds", () => {
		const workspace = makeThreeProcessWorkspace();
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				expandedProcessWorktreeIds={["wt1"]}
				onToggleProcessExpanded={vi.fn()}
			/>,
		);
		expect(screen.getAllByTestId("process-state-indicator")).toHaveLength(3);
		expect(
			screen.queryByRole("button", { name: /more/i }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /show less/i }),
		).toBeInTheDocument();
	});

	it("calls onToggleProcessExpanded with the worktree id when the 'more' button is clicked", () => {
		const onToggleProcessExpanded = vi.fn();
		const workspace = makeThreeProcessWorkspace();
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				expandedProcessWorktreeIds={[]}
				onToggleProcessExpanded={onToggleProcessExpanded}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /2 more/i }));
		expect(onToggleProcessExpanded).toHaveBeenCalledWith("wt1");
	});

	it("calls onToggleProcessExpanded when 'Show less' is clicked", () => {
		const onToggleProcessExpanded = vi.fn();
		const workspace = makeThreeProcessWorkspace();
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				expandedProcessWorktreeIds={["wt1"]}
				onToggleProcessExpanded={onToggleProcessExpanded}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /show less/i }));
		expect(onToggleProcessExpanded).toHaveBeenCalledWith("wt1");
	});

	it("shows all rows when there is only 1 process (no 'more' control)", () => {
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled",
				lastActivityAt: 1000,
				hasFailedReason: false,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				expandedProcessWorktreeIds={[]}
				onToggleProcessExpanded={vi.fn()}
			/>,
		);
		expect(screen.getAllByTestId("process-state-indicator")).toHaveLength(1);
		expect(
			screen.queryByRole("button", { name: /more/i }),
		).not.toBeInTheDocument();
	});

	it("shows both rows when there are exactly 2 processes (no collapse control)", () => {
		// Collapsing 2 shells to a top row + toggle occupies the same two lines,
		// so the toggle only appears at 3+ shells.
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled",
				lastActivityAt: 1000,
				hasFailedReason: false,
			},
			{
				id: "p2",
				label: "tests",
				state: "idle",
				context: "12 passed",
				lastActivityAt: 900,
				hasFailedReason: false,
			},
		]);
		render(
			<SessionSidebar
				{...baseProps}
				workspaces={[workspace]}
				expandedProcessWorktreeIds={[]}
				onToggleProcessExpanded={vi.fn()}
			/>,
		);
		expect(screen.getAllByTestId("process-state-indicator")).toHaveLength(2);
		expect(
			screen.queryByRole("button", { name: /more|show less/i }),
		).not.toBeInTheDocument();
	});
});

describe("SessionSidebar — task and provider rendering", () => {
	it("renders task line when taskByWorktreeId[worktreeId] is a non-null string", () => {
		const workspace: SessionSidebarWorkspace = {
			...makeWorkspace([
				{
					id: "p1",
					label: "dev",
					state: "active",
					context: "compiled",
					lastActivityAt: 1000,
					hasFailedReason: false,
				},
			]),
			taskByWorktreeId: { wt1: "Implement the sidebar task line" },
		};
		const { container } = render(
			<SessionSidebar {...baseProps} workspaces={[workspace]} />,
		);
		const taskEl = container.querySelector(".shell-sidebar__card-task");
		expect(taskEl).toBeInTheDocument();
		expect(taskEl).toHaveTextContent("Implement the sidebar task line");
		expect(taskEl).toHaveAttribute("title", "Implement the sidebar task line");
	});

	it("does not render task line when taskByWorktreeId[worktreeId] is null", () => {
		const workspace: SessionSidebarWorkspace = {
			...makeWorkspace([
				{
					id: "p1",
					label: "dev",
					state: "active",
					context: "compiled",
					lastActivityAt: 1000,
					hasFailedReason: false,
				},
			]),
			taskByWorktreeId: { wt1: null },
		};
		const { container } = render(
			<SessionSidebar {...baseProps} workspaces={[workspace]} />,
		);
		expect(
			container.querySelector(".shell-sidebar__card-task"),
		).not.toBeInTheDocument();
	});

	it("renders a claude provider badge for a row with provider claude", () => {
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled",
				lastActivityAt: 1000,
				hasFailedReason: false,
				provider: "claude",
			},
		]);
		const { container } = render(
			<SessionSidebar {...baseProps} workspaces={[workspace]} />,
		);
		const badge = container.querySelector(
			'.shell-sidebar__provider-badge[data-provider="claude"]',
		);
		expect(badge).toBeInTheDocument();
		expect(badge).toHaveTextContent("claude");
	});

	it("renders a codex provider badge for a row with provider codex", () => {
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled",
				lastActivityAt: 1000,
				hasFailedReason: false,
				provider: "codex",
			},
		]);
		const { container } = render(
			<SessionSidebar {...baseProps} workspaces={[workspace]} />,
		);
		const badge = container.querySelector(
			'.shell-sidebar__provider-badge[data-provider="codex"]',
		);
		expect(badge).toBeInTheDocument();
		expect(badge).toHaveTextContent("codex");
	});

	it("does not render a provider badge when row.provider is null", () => {
		const workspace = makeWorkspace([
			{
				id: "p1",
				label: "dev",
				state: "active",
				context: "compiled",
				lastActivityAt: 1000,
				hasFailedReason: false,
				provider: null,
			},
		]);
		const { container } = render(
			<SessionSidebar {...baseProps} workspaces={[workspace]} />,
		);
		expect(
			container.querySelector(".shell-sidebar__provider-badge"),
		).not.toBeInTheDocument();
	});
});

describe("SessionSidebar — collapsed workspace rollup", () => {
	it("shows session count and an attention dot on a collapsed workspace row", () => {
		renderSidebar({
			collapsed: true,
			workspaces: [
				makeWorkspace({
					collapsedSummary: { sessionCount: 3, attentionTier: "actionRequired" },
				}),
			],
		});
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByTestId("workspace-rollup-dot")).toHaveAttribute(
			"data-tier",
			"actionRequired",
		);
	});

	it("omits the dot when the workspace is calm", () => {
		renderSidebar({
			collapsed: true,
			workspaces: [
				makeWorkspace({
					collapsedSummary: { sessionCount: 0, attentionTier: null },
				}),
			],
		});
		expect(screen.queryByTestId("workspace-rollup-dot")).toBeNull();
	});
});

describe("SessionSidebar — ready tier dot", () => {
	it("renders a quiet ready dot for a ready worktree row (dot only)", () => {
		renderSidebar({
			workspaces: [makeWorkspace({ attentionByWorktreeId: { wt1: "ready" } })],
		});
		const dot = screen.getByTestId("row-ready-dot");
		expect(dot).toBeInTheDocument();
		expect(dot.closest(".shell-sidebar__item")).toHaveAttribute(
			"data-attention",
			"ready",
		);
	});

	it("does not render the ready dot for idle or actionRequired rows", () => {
		renderSidebar({
			workspaces: [
				makeWorkspace({ attentionByWorktreeId: { wt1: "actionRequired" } }),
			],
		});
		expect(screen.queryByTestId("row-ready-dot")).toBeNull();
	});

	it("renders the ready status inline on the header line with the 'ready:' prefix stripped", () => {
		const { container } = renderSidebar({
			workspaces: [
				makeWorkspace({
					attentionByWorktreeId: { wt1: "ready" },
					attentionContextByWorktreeId: { wt1: "ready: workflow done" },
				}),
			],
		});
		const head = container.querySelector(".shell-sidebar__item-head");
		expect(head).not.toBeNull();
		// Dot + status text share the header line with the title.
		expect(head?.querySelector('[data-testid="row-ready-dot"]')).not.toBeNull();
		expect(head).toHaveTextContent("workflow done");
		// The dot already means "ready" — the redundant prefix is dropped.
		expect(head?.textContent).not.toContain("ready:");
		// The status is NOT left stranded in the processes block below.
		const processes = container.querySelector(".shell-sidebar__processes");
		expect(
			processes?.querySelector(".shell-sidebar__process--session") ?? null,
		).toBeNull();
	});

	it("keeps a non-ready session context below the header (unchanged)", () => {
		const { container } = renderSidebar({
			workspaces: [
				makeWorkspace({
					attentionByWorktreeId: { wt1: "activity" },
					attentionContextByWorktreeId: { wt1: "active: working" },
				}),
			],
		});
		const processes = container.querySelector(".shell-sidebar__processes");
		expect(
			processes?.querySelector(".shell-sidebar__process--session"),
		).not.toBeNull();
		expect(processes).toHaveTextContent("active: working");
		// Not duplicated on the header line, and no ready dot for a non-ready row.
		const head = container.querySelector(".shell-sidebar__item-head");
		expect(head?.textContent).not.toContain("active: working");
		expect(screen.queryByTestId("row-ready-dot")).toBeNull();
	});
});
