import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionChipBar } from "../../../src/features/workspace/SessionChipBar";

const defaults = {
	sessionTitle: "My session",
	worktreeLabel: "feature-x",
	branchName: "feature/x",
	isDirty: false,
	changedFileCount: 0,
	noteNonEmpty: false,
	onRenameClick: vi.fn(),
	onDirtyClick: vi.fn(),
	onFilesClick: vi.fn(),
	onNoteClick: vi.fn(),
};

describe("SessionChipBar", () => {
	it("renders session title", () => {
		render(<SessionChipBar {...defaults} />);
		expect(screen.getByText("My session")).toBeInTheDocument();
	});

	it("renders branch and worktree label", () => {
		render(<SessionChipBar {...defaults} />);
		expect(screen.getByText(/feature\/x/)).toBeInTheDocument();
		expect(screen.getByText(/feature-x/)).toBeInTheDocument();
	});

	it("shows clean indicator when not dirty", () => {
		render(
			<SessionChipBar {...defaults} isDirty={false} changedFileCount={0} />,
		);
		expect(screen.getByTitle(/clean/i)).toBeInTheDocument();
	});

	it("shows dirty chip with count when dirty", () => {
		render(<SessionChipBar {...defaults} isDirty changedFileCount={3} />);
		expect(
			screen.getByRole("button", { name: /3 changed/i }),
		).toBeInTheDocument();
	});

	it("calls onDirtyClick when dirty chip clicked", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(
			<SessionChipBar
				{...defaults}
				isDirty
				changedFileCount={2}
				onDirtyClick={spy}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /2 changed/i }));
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("calls onRenameClick when rename button activated", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<SessionChipBar {...defaults} onRenameClick={spy} />);
		await user.click(screen.getByRole("button", { name: /rename/i }));
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("sets data-indicator true when noteNonEmpty", () => {
		render(<SessionChipBar {...defaults} noteNonEmpty />);
		expect(screen.getByRole("button", { name: /open note/i })).toHaveAttribute(
			"data-indicator",
			"true",
		);
	});

	it("sets data-indicator false when note is empty", () => {
		render(<SessionChipBar {...defaults} noteNonEmpty={false} />);
		expect(screen.getByRole("button", { name: /open note/i })).toHaveAttribute(
			"data-indicator",
			"false",
		);
	});

	it("calls onNoteClick when Note button clicked", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<SessionChipBar {...defaults} onNoteClick={spy} />);
		await user.click(screen.getByRole("button", { name: /open note/i }));
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("hides branch separator when branchName is null", () => {
		render(<SessionChipBar {...defaults} branchName={null} />);
		expect(screen.queryByText("·")).not.toBeInTheDocument();
		expect(screen.queryByText(/feature\/x/)).not.toBeInTheDocument();
	});

	it("calls onFilesClick when Files button clicked", async () => {
		const user = userEvent.setup();
		const spy = vi.fn();
		render(<SessionChipBar {...defaults} onFilesClick={spy} />);
		await user.click(screen.getByRole("button", { name: /open files/i }));
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
