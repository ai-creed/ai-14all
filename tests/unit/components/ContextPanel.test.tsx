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
				onNoteChange={vi.fn()}
			/>,
		);

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
				onNoteChange={onNoteChange}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Session note"), {
			target: { value: "Check git diff output" },
		});

		expect(onNoteChange).toHaveBeenCalledWith("Check git diff output");
	});
});
