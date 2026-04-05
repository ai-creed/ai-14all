import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionHeader } from "../../../src/features/workspace/SessionHeader";

describe("SessionHeader", () => {
	it("renders the expanded Session info panel", () => {
		render(
			<SessionHeader
				title="my-worktree"
				worktreePath="/repo"
				branchName="main"
				changedFileCount={0}
				isDirty={false}
				collapsed={false}
				onToggleCollapsed={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText("Session info")).toHaveClass(
			"shell-session-info--framed",
		);
		expect(screen.getByText("Session info")).toBeInTheDocument();
		expect(screen.getByText("/repo")).toBeInTheDocument();
		expect(screen.getByText("my-worktree")).toBeInTheDocument();
		expect(screen.getByText("main")).toBeInTheDocument();
		expect(screen.getByText("Clean")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Collapse session info" })).toBeInTheDocument();
	});

	it("renders Unknown status when gitSummaryError is true", () => {
		render(
			<SessionHeader
				title="feature-a"
				worktreePath="/repo/.worktrees/feature-a"
				branchName="feature-a"
				changedFileCount={0}
				isDirty={false}
				gitSummaryError
				collapsed={false}
				onToggleCollapsed={vi.fn()}
			/>,
		);

		expect(screen.getByText("Unknown")).toBeInTheDocument();
	});

	it("renders a compact collapsed strip without the path block", () => {
		render(
			<SessionHeader
				title="feature-a"
				worktreePath="/repo/.worktrees/feature-a"
				branchName="feat/branch"
				changedFileCount={2}
				isDirty
				collapsed
				onToggleCollapsed={vi.fn()}
			/>,
		);

		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(screen.getByText("Dirty")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.queryByText("Session info")).not.toBeInTheDocument();
		expect(
			screen.queryByText("/repo/.worktrees/feature-a"),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Expand session info" })).toBeInTheDocument();
	});

	it("calls onToggleCollapsed from the toggle button", () => {
		const onToggleCollapsed = vi.fn();

		render(
			<SessionHeader
				title="master"
				worktreePath="/repo"
				branchName="master"
				changedFileCount={0}
				isDirty={false}
				collapsed={false}
				onToggleCollapsed={onToggleCollapsed}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Collapse session info" }));
		expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
	});
});
