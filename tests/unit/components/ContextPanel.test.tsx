import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextPanel } from "../../../src/features/workspace/ContextPanel";

describe("ContextPanel", () => {
	it("renders worktree path", () => {
		render(
			<ContextPanel
				worktreePath="/repo/.worktrees/feature-a"
				note="Investigate flaky diff"
				onNoteChange={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("complementary", { name: "Session context" }),
		).toBeInTheDocument();
		expect(screen.getByText("/repo/.worktrees/feature-a")).toBeInTheDocument();
	});

	it("propagates note changes", () => {
		const onNoteChange = vi.fn();
		render(
			<ContextPanel
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

	it("renders the note textarea with current value", () => {
		render(
			<ContextPanel
				worktreePath="/repo"
				note="My session note"
				onNoteChange={vi.fn()}
			/>,
		);
		expect(screen.getByLabelText("Session note")).toHaveValue("My session note");
	});
});
