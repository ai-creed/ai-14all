import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSidebar } from "../../../src/features/workspace/components/SessionSidebar";
import type { SessionSidebarWorkspace } from "../../../src/features/workspace/components/SessionSidebar";

function makeWorkspace(
	rows: Array<{
		id: string;
		label: string;
		state: "actionRequired" | "active" | "idle" | "exited";
		context: string;
		lastActivityAt: number | null;
		hasFailedReason: boolean;
	}>,
): SessionSidebarWorkspace {
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
			wt1: { rows, overflowCount: 0 },
		},
		titleByWorktreeId: { wt1: "main" },
		active: true,
		hydrated: true,
	};
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
		expect(screen.getByRole("button", { name: /clear failed for tests/i })).toBeInTheDocument();
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
		expect(screen.queryByRole("button", { name: /clear failed/i })).not.toBeInTheDocument();
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
		fireEvent.click(screen.getByRole("button", { name: /clear failed for tests/i }));
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
		fireEvent.click(screen.getByRole("button", { name: /clear failed for tests/i }));
		expect(onClearFailedReason).toHaveBeenCalledTimes(1);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("dispatches non-sticky clear on row click (via onSelect)", () => {
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
