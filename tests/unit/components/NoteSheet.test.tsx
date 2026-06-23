import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteSheet } from "../../../src/features/workspace/components/NoteSheet";

describe("NoteSheet", () => {
	it("renders textarea with note value when open", () => {
		render(
			<NoteSheet
				open
				note="hello"
				onNoteChange={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(screen.getByRole("textbox", { name: /session note/i })).toHaveValue(
			"hello",
		);
	});

	it("does not render textarea when closed", () => {
		render(
			<NoteSheet
				open={false}
				note="hello"
				onNoteChange={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(
			screen.queryByRole("textbox", { name: /session note/i }),
		).not.toBeInTheDocument();
	});

	it("calls onNoteChange when user types", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<NoteSheet open note="" onNoteChange={spy} onClose={() => {}} />);
		await user.type(
			screen.getByRole("textbox", { name: /session note/i }),
			"ab",
		);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("calls onClose exactly once when Escape is pressed", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<NoteSheet open note="" onNoteChange={() => {}} onClose={spy} />);
		await user.keyboard("{Escape}");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("toggles between editable note text and markdown preview", async () => {
		const user = userEvent.setup();
		render(
			<NoteSheet
				open
				note={"## Finding\n\n- First item"}
				onNoteChange={() => {}}
				onClose={() => {}}
			/>,
		);

		expect(
			screen.getByRole("textbox", { name: /session note/i }),
		).toBeVisible();

		await user.click(screen.getByRole("button", { name: "Preview" }));

		expect(
			screen.queryByRole("textbox", { name: /session note/i }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("region", { name: /session note preview/i }),
		).toBeVisible();
		expect(
			screen.getByRole("heading", { name: "Finding", level: 2 }),
		).toBeInTheDocument();
		expect(screen.getByText("First item")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Edit" }));

		expect(screen.getByRole("textbox", { name: /session note/i })).toHaveValue(
			"## Finding\n\n- First item",
		);
	});

	it("renders exactly one close button", () => {
		render(
			<NoteSheet open note="" onNoteChange={() => {}} onClose={() => {}} />,
		);
		expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);
	});
});
