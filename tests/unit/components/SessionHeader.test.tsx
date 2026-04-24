import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
			/>,
		);

		expect(screen.getByLabelText("Session info")).toHaveClass(
			"shell-session-info",
		);
		expect(screen.getByText("Session info")).toBeInTheDocument();
		expect(screen.getByText("/repo")).toBeInTheDocument();
		expect(screen.getByText("my-worktree")).toBeInTheDocument();
		expect(screen.getByText("main")).toBeInTheDocument();
		expect(screen.getByText("Clean")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /collapse/i }),
		).not.toBeInTheDocument();
	});

	it("renders a concise ahead or behind line only for dirty worktrees", () => {
		const { rerender } = render(
			<SessionHeader
				title="feature-a"
				worktreePath="/repo/.worktrees/feature-a"
				branchName="feature-a"
				changedFileCount={2}
				isDirty
				mergeTargetRef="origin/main"
				aheadCount={1}
				behindCount={0}
				collapsed={false}
			/>,
		);

		expect(screen.getByText("1 ahead of origin/main")).toBeInTheDocument();

		rerender(
			<SessionHeader
				title="main"
				worktreePath="/repo"
				branchName="main"
				changedFileCount={0}
				isDirty={false}
				mergeTargetRef="origin/main"
				aheadCount={0}
				behindCount={0}
				collapsed={false}
			/>,
		);

		expect(screen.queryByText(/origin\/main/)).not.toBeInTheDocument();
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
			/>,
		);

		expect(screen.getByText("Unknown")).toBeInTheDocument();
	});

	it("renders a stale status label when git summary is stale", () => {
		render(
			<SessionHeader
				title="main"
				worktreePath="/repo"
				branchName="main"
				changedFileCount={1}
				isDirty
				gitSummaryStale
				collapsed={false}
			/>,
		);

		expect(screen.getByText("Dirty (stale)")).toBeInTheDocument();
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
			/>,
		);

		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(screen.getByText("Dirty")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.queryByText("Session info")).not.toBeInTheDocument();
		expect(
			screen.queryByText("/repo/.worktrees/feature-a"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /expand/i }),
		).not.toBeInTheDocument();
	});
});
