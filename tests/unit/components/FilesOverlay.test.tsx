import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: (options: { count: number }) => ({
		getTotalSize: () => options.count * 28,
		getVirtualItems: () =>
			Array.from({ length: options.count }, (_, i) => ({
				index: i,
				start: i * 28,
				size: 28,
				key: String(i),
			})),
		scrollToIndex: () => {},
		measureElement: () => 0,
	}),
}));

import { FilesOverlay } from "../../../src/features/files/FilesOverlay";

const noop = () => {};

const defaults = {
	isOpen: true,
	onClose: noop,
	trackedFilesLoader: async () => [] as string[],
	gitStatusMap: new Map<string, "M" | "A" | "D" | "R" | "??">(),
	onViewFile: noop,
	onEditFile: noop,
	isEditable: () => false,
};

describe("FilesOverlay scaffold", () => {
	it("renders nothing when closed", () => {
		render(<FilesOverlay {...defaults} isOpen={false} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("renders a dialog when open", () => {
		render(<FilesOverlay {...defaults} />);
		expect(screen.getByRole("dialog", { name: /files/i })).toBeInTheDocument();
	});

	it("exposes data-testid for e2e targeting", () => {
		render(<FilesOverlay {...defaults} />);
		expect(screen.getByTestId("files-overlay")).toBeInTheDocument();
	});

	it("calls onClose when Escape is pressed", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<FilesOverlay {...defaults} onClose={onClose} />);
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("FilesOverlay — chip-bar wiring contract", () => {
	it("renders the Files title region in the dialog header so the chip-bar handler can aim at it", () => {
		render(<FilesOverlay {...defaults} />);
		const dialog = screen.getByRole("dialog", { name: /files/i });
		expect(dialog).toHaveAttribute("data-testid", "files-overlay");
	});

	it("closes via onOpenChange(false) when parent sets isOpen=false via re-render", () => {
		const { rerender } = render(<FilesOverlay {...defaults} />);
		expect(screen.getByTestId("files-overlay")).toBeInTheDocument();
		rerender(<FilesOverlay {...defaults} isOpen={false} />);
		expect(screen.queryByTestId("files-overlay")).not.toBeInTheDocument();
	});
});

describe("FilesOverlay — tracked-file list", () => {
	it("calls trackedFilesLoader when it opens", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
	});

	it("does not call trackedFilesLoader when closed", () => {
		const loader = vi.fn().mockResolvedValue([]);
		render(<FilesOverlay {...defaults} isOpen={false} trackedFilesLoader={loader} />);
		expect(loader).not.toHaveBeenCalled();
	});

	it("renders each tracked path as a row", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		expect(await screen.findByText("a.ts")).toBeInTheDocument();
		expect(await screen.findByText("b.ts")).toBeInTheDocument();
	});

	it("renders Git status for a file that has one", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts"]);
		const statusMap = new Map<string, "M" | "A" | "D" | "R" | "??">([["src/a.ts", "M"]]);
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				gitStatusMap={statusMap}
			/>,
		);
		expect(await screen.findByTestId("files-overlay-row-status-src/a.ts")).toHaveTextContent("M");
	});

	it("shows an empty-state message when the worktree has no tracked files", async () => {
		const loader = vi.fn().mockResolvedValue([]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		expect(await screen.findByText(/no files/i)).toBeInTheDocument();
	});

	it("renders an error message when the loader rejects", async () => {
		const loader = vi.fn().mockRejectedValue(new Error("ipc down"));
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		expect(await screen.findByText(/couldn't load files/i)).toBeInTheDocument();
	});

	it("re-loads when the overlay is closed and re-opened", async () => {
		const loader = vi.fn().mockResolvedValue([]);
		const { rerender } = render(
			<FilesOverlay {...defaults} trackedFilesLoader={loader} />,
		);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
		rerender(<FilesOverlay {...defaults} isOpen={false} trackedFilesLoader={loader} />);
		rerender(<FilesOverlay {...defaults} isOpen={true} trackedFilesLoader={loader} />);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
	});
});

describe("FilesOverlay — search", () => {
	it("renders a search input that is auto-focused on open", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		const input = await screen.findByPlaceholderText(/search files/i);
		expect(input).toBe(document.activeElement);
	});

	it("filters the list as the user types", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/foo.ts", "src/bar.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("foo.ts");
		const input = screen.getByPlaceholderText(/search files/i);
		await user.type(input, "foo");
		expect(screen.getByText("foo.ts")).toBeInTheDocument();
		expect(screen.queryByText("bar.ts")).not.toBeInTheDocument();
	});

	it("shows an empty-results message when search matches nothing", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/foo.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("foo.ts");
		const input = screen.getByPlaceholderText(/search files/i);
		await user.type(input, "xyz");
		expect(screen.getByText(/no files match/i)).toBeInTheDocument();
	});

	it("restores the full list when the query is cleared", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/foo.ts", "src/bar.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("foo.ts");
		const input = screen.getByPlaceholderText(/search files/i);
		await user.type(input, "foo");
		expect(screen.queryByText("bar.ts")).not.toBeInTheDocument();
		await user.clear(input);
		expect(screen.getByText("bar.ts")).toBeInTheDocument();
	});

	it("resets the query to empty when the overlay is re-opened", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/foo.ts"]);
		const { rerender } = render(
			<FilesOverlay {...defaults} trackedFilesLoader={loader} />,
		);
		const input = await screen.findByPlaceholderText(/search files/i);
		await user.type(input, "foo");
		rerender(<FilesOverlay {...defaults} isOpen={false} trackedFilesLoader={loader} />);
		rerender(<FilesOverlay {...defaults} isOpen={true} trackedFilesLoader={loader} />);
		const reopenedInput = await screen.findByPlaceholderText(/search files/i);
		expect((reopenedInput as HTMLInputElement).value).toBe("");
	});
});

describe("FilesOverlay — keyboard navigation", () => {
	it("defaults selection to the first row", async () => {
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("a.ts");
		expect(screen.getByTestId("files-overlay-row-src/a.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("moves selection on ArrowDown", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("a.ts");
		await user.keyboard("{ArrowDown}");
		expect(screen.getByTestId("files-overlay-row-src/b.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("does not advance past the last row on ArrowDown", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("a.ts");
		await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
		expect(screen.getByTestId("files-overlay-row-src/b.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("moves selection on ArrowUp", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("a.ts");
		await user.keyboard("{ArrowDown}{ArrowUp}");
		expect(screen.getByTestId("files-overlay-row-src/a.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("jumps to first row on Home", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts", "src/c.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("a.ts");
		await user.keyboard("{ArrowDown}{ArrowDown}");
		await user.keyboard("{Home}");
		expect(screen.getByTestId("files-overlay-row-src/a.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("jumps to last row on End", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts", "src/c.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("a.ts");
		await user.keyboard("{End}");
		expect(screen.getByTestId("files-overlay-row-src/c.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("resets selection to first row when the query narrows the list", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/alpha.ts", "src/beta.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		await screen.findByText("alpha.ts");
		await user.keyboard("{ArrowDown}");
		const input = screen.getByPlaceholderText(/search files/i);
		await user.type(input, "alp");
		expect(screen.getByTestId("files-overlay-row-src/alpha.ts")).toHaveAttribute(
			"data-selected",
			"true",
		);
	});

	it("keeps focus in the search input while arrow keys navigate", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		render(<FilesOverlay {...defaults} trackedFilesLoader={loader} />);
		const input = await screen.findByPlaceholderText(/search files/i);
		expect(input).toBe(document.activeElement);
		await user.keyboard("{ArrowDown}");
		expect(input).toBe(document.activeElement);
	});
});

describe("FilesOverlay — view action", () => {
	it("invokes onViewFile with the selected path on Enter", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]);
		const onViewFile = vi.fn();
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				onViewFile={onViewFile}
			/>,
		);
		await screen.findByText("a.ts");
		await user.keyboard("{ArrowDown}{Enter}");
		expect(onViewFile).toHaveBeenCalledWith("src/b.ts");
	});

	it("invokes onViewFile on row click", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(["src/a.ts"]);
		const onViewFile = vi.fn();
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				onViewFile={onViewFile}
			/>,
		);
		await screen.findByText("a.ts");
		await user.click(screen.getByTestId("files-overlay-row-src/a.ts"));
		expect(onViewFile).toHaveBeenCalledWith("src/a.ts");
	});

	it("does nothing on Enter when the list is empty", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue([]);
		const onViewFile = vi.fn();
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				onViewFile={onViewFile}
			/>,
		);
		await screen.findByText(/no files/i);
		await user.keyboard("{Enter}");
		expect(onViewFile).not.toHaveBeenCalled();
	});
});

describe("FilesOverlay — edit action", () => {
	const paths = ["src/a.ts", "src/image.png"];

	it("invokes onEditFile on Cmd+Enter when the selected file is editable", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(paths);
		const onEditFile = vi.fn();
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				onEditFile={onEditFile}
				isEditable={(basename) => basename.endsWith(".ts")}
			/>,
		);
		await screen.findByText("a.ts");
		await user.keyboard("{Meta>}{Enter}{/Meta}");
		expect(onEditFile).toHaveBeenCalledWith("src/a.ts");
	});

	it("invokes onEditFile on Ctrl+Enter when the selected file is editable", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(paths);
		const onEditFile = vi.fn();
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				onEditFile={onEditFile}
				isEditable={(basename) => basename.endsWith(".ts")}
			/>,
		);
		await screen.findByText("a.ts");
		await user.keyboard("{Control>}{Enter}{/Control}");
		expect(onEditFile).toHaveBeenCalledWith("src/a.ts");
	});

	it("does not invoke onEditFile for a non-editable selection", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(paths);
		const onEditFile = vi.fn();
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				onEditFile={onEditFile}
				isEditable={(basename) => basename.endsWith(".ts")}
			/>,
		);
		await screen.findByText("a.ts");
		await user.keyboard("{ArrowDown}");
		await user.keyboard("{Meta>}{Enter}{/Meta}");
		expect(onEditFile).not.toHaveBeenCalled();
	});

	it("footer hint shows Edit availability for the current selection", async () => {
		const user = userEvent.setup();
		const loader = vi.fn().mockResolvedValue(paths);
		render(
			<FilesOverlay
				{...defaults}
				trackedFilesLoader={loader}
				isEditable={(basename) => basename.endsWith(".ts")}
			/>,
		);
		await screen.findByText("a.ts");
		const footer = screen.getByTestId("files-overlay-footer");
		expect(footer).toHaveAttribute("data-edit-available", "true");
		await user.keyboard("{ArrowDown}");
		expect(footer).toHaveAttribute("data-edit-available", "false");
	});
});
