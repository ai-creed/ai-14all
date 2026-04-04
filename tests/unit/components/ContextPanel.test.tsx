import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextPanel } from "../../../src/features/workspace/ContextPanel";

describe("ContextPanel", () => {
	it("renders branch and worktree path", () => {
		render(
			<ContextPanel
				branchName="feature-a"
				worktreePath="/repo/.worktrees/feature-a"
				note="Investigate flaky diff"
				gitSummary={null}
				onNoteChange={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("complementary", { name: "Session context" }),
		).toBeInTheDocument();
		expect(screen.getByText("Active branch")).toBeInTheDocument();
		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(screen.getByText("/repo/.worktrees/feature-a")).toBeInTheDocument();
	});

	it("propagates note changes", () => {
		const onNoteChange = vi.fn();
		render(
			<ContextPanel
				branchName="feature-a"
				worktreePath="/repo/.worktrees/feature-a"
				note=""
				gitSummary={null}
				onNoteChange={onNoteChange}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Session note"), {
			target: { value: "Check git diff output" },
		});

		expect(onNoteChange).toHaveBeenCalledWith("Check git diff output");
	});

	it("shows error message when gitSummaryError is true", () => {
		render(
			<ContextPanel
				branchName="feature-a"
				worktreePath="/repo"
				note=""
				gitSummary={null}
				gitSummaryError
				onNoteChange={() => {}}
			/>,
		);
		expect(screen.getByText("Unable to load Git data.")).toBeInTheDocument();
		expect(screen.queryByText("Clean")).not.toBeInTheDocument();
	});

	it("renders git status, changed files, and recent commits", () => {
		render(
			<ContextPanel
				branchName="feature-a"
				worktreePath="/repo/.worktrees/feature-a"
				note=""
				gitSummary={{
					branchName: "feature-a",
					isDirty: true,
					changedFileCount: 2,
					changedFiles: [
						{ path: "src/index.ts", status: "M" },
						{ path: "src/new-file.ts", status: "??" },
					],
					recentCommits: [
						{ sha: "abc123", shortSha: "abc123", subject: "initial commit" },
					],
				}}
				onNoteChange={() => {}}
			/>,
		);

		expect(screen.getByText("Dirty")).toBeInTheDocument();
		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByText("initial commit")).toBeInTheDocument();
	});
});
