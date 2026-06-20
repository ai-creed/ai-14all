import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditorDirtyBar } from "../../../src/features/viewer/components/EditorDirtyBar";

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("EditorDirtyBar", () => {
	it("renders Save / Discard / hint when shown", () => {
		render(
			<EditorDirtyBar
				currentLength={10}
				pristineLength={10}
				onSave={vi.fn()}
				onDiscard={vi.fn()}
				platform="mac"
			/>,
		);
		expect(screen.getByText(/Unsaved changes/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
		expect(screen.getByText("⌘S")).toBeInTheDocument();
	});

	it("shows the Ctrl hint on non-mac platforms (Windows/Linux)", () => {
		render(
			<EditorDirtyBar
				currentLength={10}
				pristineLength={10}
				onSave={vi.fn()}
				onDiscard={vi.fn()}
				platform="other"
			/>,
		);
		expect(screen.getByText("Ctrl+S")).toBeInTheDocument();
		expect(screen.queryByText("⌘S")).not.toBeInTheDocument();
	});

	it("invokes onSave when Save is clicked", () => {
		const onSave = vi.fn();
		render(
			<EditorDirtyBar
				currentLength={1}
				pristineLength={0}
				onSave={onSave}
				onDiscard={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it("invokes onDiscard immediately when delta is small (no confirm)", () => {
		const onDiscard = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm");
		render(
			<EditorDirtyBar
				currentLength={5}
				pristineLength={0}
				onSave={vi.fn()}
				onDiscard={onDiscard}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(onDiscard).toHaveBeenCalledTimes(1);
	});

	it("prompts confirm when delta exceeds 50 chars; aborts on cancel", () => {
		const onDiscard = vi.fn();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		render(
			<EditorDirtyBar
				currentLength={200}
				pristineLength={0}
				onSave={vi.fn()}
				onDiscard={onDiscard}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(confirmSpy).toHaveBeenCalledTimes(1);
		expect(onDiscard).not.toHaveBeenCalled();
	});

	it("proceeds to onDiscard when confirm returns true", () => {
		const onDiscard = vi.fn();
		vi.spyOn(window, "confirm").mockReturnValue(true);
		render(
			<EditorDirtyBar
				currentLength={200}
				pristineLength={0}
				onSave={vi.fn()}
				onDiscard={onDiscard}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(onDiscard).toHaveBeenCalledTimes(1);
	});
});
