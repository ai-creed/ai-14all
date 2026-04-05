import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextPanel } from "../../../src/features/workspace/ContextPanel";

describe("ContextPanel", () => {
	it("renders only the Session note field", () => {
		render(<ContextPanel note="resume here" onNoteChange={vi.fn()} />);

		expect(
			screen.getByRole("complementary", { name: "Session note panel" }),
		).toBeInTheDocument();
		expect(screen.getByText("Session note")).toBeInTheDocument();
		expect(screen.getByLabelText("Session note")).toHaveValue("resume here");
		expect(
			screen.queryByText("/repo/.worktrees/feature-a"),
		).not.toBeInTheDocument();
	});

	it("propagates note changes", () => {
		const onNoteChange = vi.fn();

		render(<ContextPanel note="" onNoteChange={onNoteChange} />);

		fireEvent.change(screen.getByLabelText("Session note"), {
			target: { value: "Check git diff output" },
		});

		expect(onNoteChange).toHaveBeenCalledWith("Check git diff output");
	});

	it("renders the note textarea with current value", () => {
		render(<ContextPanel note="My session note" onNoteChange={vi.fn()} />);
		expect(screen.getByLabelText("Session note")).toHaveValue("My session note");
	});
});
